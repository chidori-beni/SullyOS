/**
 * 划线给 ta 看：把用户划的一句（和想法）发进私聊，让角色像在书页边写批注那样回一句。
 *
 * 两条都是普通可见的聊天消息（用户那条 + 角色回的那条），进上下文也进记忆宫殿；
 * 角色的回应同时挂回书房里那条笔记旁边。每点一次调用一次主 API，只在用户主动点时发生。
 */
import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import { DB } from '../db';
import { buildChatRequestPayload } from '../chatRequestPayload';
import { loadCharacterContextMessages } from '../chatContextRange';
import { safeFetchJson } from '../safeApi';
import { triggerMemoryPipeline, type MemoryConfigLike } from './bookroomDb';
import { isScheduleFeatureOn } from '../scheduleFeature';
import { getDailyScheduleForChar } from '../dailySchedule';
import { createScheduleContextSnapshot, type ScheduleContextSnapshot } from '../scheduleContext';
import { normalizeBusyLevel } from '../busyAutoReply';

export function buildHighlightMessage(input: { bookTitle: string; chapter?: string; quote: string; comment?: string }): string {
    const where = input.chapter ? `《${input.bookTitle}》「${input.chapter.length > 24 ? `${input.chapter.slice(0, 24)}…` : input.chapter}」` : `《${input.bookTitle}》`;
    const lines = [`【书房 · 划线】我在${where}划了一句给你看：`, `「${input.quote.trim()}」`];
    if (input.comment?.trim()) lines.push(input.comment.trim());
    return lines.join('\n');
}

/** 回复清洗：去掉思考块、聊天指令（[[...]]）和多余空行。 */
export function cleanMarginReply(raw: string): string {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[\[[^\]]*\]\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 600);
}

const MARGIN_INSTRUCTION = (userName: string) => `

【书房 · 划线】${userName}刚在书里划了一句给你看（就是最后那条消息）。像在书页边上写批注那样回${userName}：
- 1~3 句，口语，就回这句话本身和${userName}的想法，可以有你自己的感受、联想或不同意见；
- 遵守上面「你们在一起读的书」的约定：不剧透${userName}还没读到的内容，你没读到的部分不要编；
- 只输出回复正文，不要写动作描写、不要加引号或标题。`;

/**
 * 角色此刻按日程在忙 / 在睡：这次先不回，什么都没发出去。
 * 划线和书评由调用方记进「等回复」队列（pendingReplies.ts），ta 有空了再认真回；荐书 / 年度寄语就请用户晚点再来。
 */
export class BookroomBusyError extends Error {
    /** 「萧逸 这会儿在忙「开会」」这半句，界面拼自己的说明用 */
    readonly brief: string;
    constructor(brief: string, readonly activity: string, readonly level: 'busy' | 'sleep') {
        super(`${brief}，等 ta 有空再来吧。`);
        this.brief = brief;
        this.name = 'BookroomBusyError';
    }
}

/** 读角色此刻的日程时段。日程没开、读不到都返回 null（当作有空）。 */
async function readScheduleNow(char: CharacterProfile): Promise<ScheduleContextSnapshot | null> {
    if (!isScheduleFeatureOn(char)) return null;
    try {
        const instant = new Date();
        const schedule = await getDailyScheduleForChar(char, instant);
        if (!schedule) return null;
        return createScheduleContextSnapshot(char, schedule, instant);
    } catch (e) {
        console.warn('[Bookroom] 读日程失败，当作有空', e);
        return null;
    }
}

/**
 * 角色此刻有没有空认真回书房的东西。忙（busy）和睡（sleep）算没空；
 * 「边忙边能看手机」（light）算有空——那个提示词本身就要求别刻意缩短该认真回的内容。
 */
export async function checkCharBusy(char: CharacterProfile): Promise<{ level: 'busy' | 'sleep'; activity: string } | null> {
    const now = await readScheduleNow(char);
    const slot = now?.current ?? null;
    const level = normalizeBusyLevel(slot);
    if (!slot || (level !== 'busy' && level !== 'sleep')) return null;
    return { level, activity: slot.activity?.trim() || (level === 'sleep' ? '睡觉' : '忙') };
}

export const busyMessage = (charName: string, busy: { level: 'busy' | 'sleep'; activity: string }) =>
    busy.level === 'sleep' ? `${charName} 这会儿在睡觉` : `${charName} 这会儿在忙「${busy.activity}」`;

const pad2 = (n: number) => String(n).padStart(2, '0');
const DEFERRED_NOTE = (userName: string, since: number, activity?: string) => {
    const d = new Date(since);
    const when = `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return `

（补充：这是${userName}在 ${when} 从书房分享给你的，那时你${activity ? `正在「${activity}」` : '在忙'}，没顾上看。现在你有空了，才认真看。`
        + `可以很自然地带一句刚忙完 / 刚看到，但重点是好好回应内容本身，按上面的要求认真写，不要敷衍、不要缩短。）`;
};

export interface AskCharacterContext {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    apiConfig: APIConfig;
    realtimeConfig?: RealtimeConfig;
    memoryPalaceConfig?: MemoryConfigLike;
}

/**
 * 书房里所有「请角色说点什么」的共用流程：
 * 用户那条消息进私聊 → 按正常聊天的完整上下文（人设/记忆/防剧透提醒）请角色回 → 回复也进私聊 → 触发记忆。
 * 两条都是普通可见消息。调用方用 instruction 说明这一次要 ta 写什么。
 */
export async function askCharacterInBookroom(input: AskCharacterContext & {
    message: string;
    instruction: string;
    kind: string;
    purpose: string;
    novelId?: string;
    /** 书名，存进消息 metadata，聊天卡片右上角显示 */
    bookTitle?: string;
    /** 从「等回复」队列里补回：用户当时是几点分享的、那时角色在忙什么。有这个就不再检查忙不忙 */
    deferred?: { since: number; activity?: string };
    /** 用户那条已经在私聊里了（上次补回时发出去、但模型没回成）：这次不再重复发 */
    skipUserMessage?: boolean;
    /** 用户那条落进私聊后通知一声（补回失败时据此记下「已经发过了」） */
    onUserMessageSaved?: () => void;
}): Promise<string> {
    const { char, userProfile, apiConfig } = input;
    if (!apiConfig.baseUrl) throw new Error('还没有配置聊天 API');
    const userName = userProfile?.name || '用户';

    // ---- 先看日程：忙 / 睡的时候先不回，也什么都不发（调用方决定排队还是请用户晚点再来）----
    if (!input.deferred) {
        const busy = await checkCharBusy(char);
        if (busy) throw new BookroomBusyError(busyMessage(char.name, busy), busy.activity, busy.level);
    }

    const bookroomMeta = {
        source: 'bookroom', bookroomNovelId: input.novelId,
        ...(input.bookTitle ? { bookroomBookTitle: input.bookTitle } : {}),
        ...(input.deferred ? { bookroomDeferredSince: input.deferred.since } : {}),
    };
    if (!input.skipUserMessage) {
        await DB.saveMessage({
            charId: char.id, role: 'user', type: 'text', content: input.message,
            metadata: { ...bookroomMeta, bookroomKind: input.kind },
        });
        input.onUserMessageSaved?.();
    }

    const historyMsgs = await loadCharacterContextMessages(char);
    const payload = await buildChatRequestPayload({
        char, userProfile, groups: input.groups,
        emojis: await DB.getEmojis(), categories: await DB.getEmojiCategories(),
        historyMsgs, contextLimit: Math.max(1, historyMsgs.length),
        realtimeConfig: input.realtimeConfig,
        stripImages: true,
    });
    const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
    const data: any = await safeFetchJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [{ role: 'system', content: payload.systemPrompt + input.instruction + (input.deferred ? DEFERRED_NOTE(userName, input.deferred.since, input.deferred.activity) : '') }, ...payload.cleanedApiMessages],
            temperature: 0.9, stream: false,
        }),
    }, 2, 0, { appName: '书房', charId: char.id, charName: char.name, purpose: input.purpose });
    const reply = cleanMarginReply(data?.choices?.[0]?.message?.content || '');
    if (!reply) throw new Error('角色这次没有回复内容（模型返回为空）');
    await DB.saveMessage({
        charId: char.id, role: 'assistant', type: 'text', content: reply,
        metadata: { ...bookroomMeta, bookroomKind: `${input.kind}-reply` },
    });
    void triggerMemoryPipeline(char, apiConfig, input.memoryPalaceConfig, userName);
    return reply;
}

export function askCharacterAboutHighlight(input: AskCharacterContext & {
    novelId: string; message: string; bookTitle?: string;
    deferred?: { since: number; activity?: string }; skipUserMessage?: boolean; onUserMessageSaved?: () => void;
}): Promise<string> {
    return askCharacterInBookroom({
        ...input,
        instruction: MARGIN_INSTRUCTION(input.userProfile?.name || '用户'),
        kind: 'highlight', purpose: '划线回应',
    });
}

// ---------- 三期：书评 / 荐书 / 年度寄语 ----------

export const buildReviewMessage = (bookTitle: string, mine: { text: string; rating?: number }) =>
    `【书房 · 书评】我读完了《${bookTitle}》${mine.rating ? `，给它 ${mine.rating} 星` : ''}：\n${mine.text}\n\n你也写一篇吧，我们交换看看。`;

export const REVIEW_INSTRUCTION = (userName: string, charHasFinished: boolean, charHasRead: boolean) => `

【书房 · 书评】${userName}读完了这本书，刚把自己的书评发给你（最后那条消息），想和你交换书评。写一篇你自己的：
- 第一行固定写「评分：N/5」（N 是 1~5 的整数，按你自己的真实感受打，不必和${userName}一样）；
- 从第二行开始写书评正文，150~300 字，用你自己的口吻和眼光：喜欢/不喜欢什么、哪里戳到你、哪里你不同意${userName}；
${charHasFinished
        ? '- 你在《彼方》里读完了这本，可以谈具体情节；'
        : charHasRead
            ? '- 你在《彼方》里只读了一部分：老实说你读到哪、后面没读过，只评你读过的，不编后面的情节；'
            : `- 你没读过这本：老实说没读过，就${userName}讲的内容和书评谈你的看法和好奇，不编情节；`}
- 只输出评分行和正文，不要标题、不要动作描写。`;

export const RECOMMEND_INSTRUCTION = (userName: string) => `

【书房 · 荐书】${userName}请你推荐一本书。按你自己的品味和对${userName}的了解（ta 最近读了什么、喜欢什么）选一本：
- 只推荐你确定真实存在的书，书名和作者要准确；不要推荐${userName}书架上已经有的；
- 严格按下面格式输出，不要别的内容：
书名：《…》
作者：…
理由：2~4 句，用你自己的口吻说为什么想让${userName}读它。`;

export const YEAR_LETTER_INSTRUCTION = (userName: string, year: number) => `

【书房 · 年度书单】${userName}把你们 ${year} 年一起读书的总结发给你了（最后那条消息）。给${userName}写几句年度寄语：
- 100~200 字，像写在书单最后一页的留言：回想这一年一起读过的书、你印象最深的时刻，对明年读书的期待；
- 只提总结里真的出现过的书，不编；只输出正文。`;
