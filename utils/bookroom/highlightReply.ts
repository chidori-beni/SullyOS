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
}): Promise<string> {
    const { char, userProfile, apiConfig } = input;
    if (!apiConfig.baseUrl) throw new Error('还没有配置聊天 API');
    const userName = userProfile?.name || '用户';
    await DB.saveMessage({
        charId: char.id, role: 'user', type: 'text', content: input.message,
        metadata: { source: 'bookroom', bookroomKind: input.kind, bookroomNovelId: input.novelId },
    });
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
            messages: [{ role: 'system', content: payload.systemPrompt + input.instruction }, ...payload.cleanedApiMessages],
            temperature: 0.9, stream: false,
        }),
    }, 2, 0, { appName: '书房', charId: char.id, charName: char.name, purpose: input.purpose });
    const reply = cleanMarginReply(data?.choices?.[0]?.message?.content || '');
    if (!reply) throw new Error('角色这次没有回复内容（模型返回为空）');
    await DB.saveMessage({
        charId: char.id, role: 'assistant', type: 'text', content: reply,
        metadata: { source: 'bookroom', bookroomKind: `${input.kind}-reply`, bookroomNovelId: input.novelId },
    });
    void triggerMemoryPipeline(char, apiConfig, input.memoryPalaceConfig, userName);
    return reply;
}

export function askCharacterAboutHighlight(input: AskCharacterContext & { novelId: string; message: string }): Promise<string> {
    return askCharacterInBookroom({
        ...input,
        instruction: MARGIN_INSTRUCTION(input.userProfile?.name || '用户'),
        kind: 'highlight', purpose: '划线回应',
    });
}

// ---------- 三期：书评 / 荐书 / 年度寄语 ----------

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
