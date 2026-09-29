/**
 * 请角色在放映室里说一句。
 *
 * 上下文 = 正常私聊那一整套（人设、记忆、关系、最近聊天）+ 影院说明 + 这一场的对话。
 * 此刻的画面贴在最后一条用户消息上（跟通话的「每轮快照」同一个做法）；
 * 模型不支持看图时自动退回只发文字。
 *
 * 放映室里的每句话由 CinemaApp 存进私聊消息库（source: 'cinema'，私聊界面不显示），
 * 照通话的做法说一句进一句。这里准备上下文时要把**这一场**的那几条排除掉——
 * 这一场的对话由 session.lines 接在后面，不排除就会重复两遍。
 *
 * 快：私聊那一整套（读全部聊天、记忆宫殿召回……）**一场只准备一次**，缓存 10 分钟；
 * 每句话只在后面接上这一场的对话。进放映室时就提前准备（warmCinemaContext），
 * 第一句也不用等。私聊历史只带最近 CINEMA_HISTORY_LIMIT 条，太长的上下文会拖慢首字。
 * 心声在影院里关掉（提示词里不要求，回复里漏出来的也会被 cleanCinemaReply 删掉）。
 */
import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import { DB } from '../db';
import { buildChatRequestPayload } from '../chatRequestPayload';
import { loadCharacterContextMessages } from '../chatContextRange';
import { safeFetchJson } from '../safeApi';
import { attachSnapshotToLatestUserMessage, isVisionInputUnsupportedError } from '../userCameraSnapshot';
import {
    buildCinemaInstruction, buildProactiveNudge, cleanCinemaReply, isSilentReply, sessionLinesToApiMessages,
    type CinemaSession, type CinemaStatus, type ProactiveReason,
} from './cinema';

/** 私聊最近多少条带进放映室。够认出你们最近聊了什么，又不至于拖慢。 */
export const CINEMA_HISTORY_LIMIT = 40;
/** 准备好的上下文用多久。过了就重新准备一次（时间、记忆召回会更新）。 */
export const CINEMA_CONTEXT_TTL_MS = 10 * 60 * 1000;

export interface CinemaContextInput {
    char: CharacterProfile;
    /** 这一场的 id：私聊库里属于这一场的消息不进缓存的历史（由 session.lines 接上） */
    sessionId?: string;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
}

interface PreparedContext {
    systemPrompt: string;
    history: any[];
    at: number;
}

const contextCache = new Map<string, Promise<PreparedContext>>();
const cacheAt = new Map<string, number>();

async function buildContext(input: CinemaContextInput): Promise<PreparedContext> {
    // 心声关掉：影院里要的是短短一两句，心声那一长串既拖慢又会露出来
    const char: CharacterProfile = { ...input.char, xinshengEnabled: false };
    const historyMsgs = (await loadCharacterContextMessages(char))
        .filter(message => !input.sessionId || message.metadata?.cinemaSessionId !== input.sessionId);
    const payload = await buildChatRequestPayload({
        char, userProfile: input.userProfile, groups: input.groups,
        emojis: await DB.getEmojis(), categories: await DB.getEmojiCategories(),
        historyMsgs, contextLimit: Math.max(1, historyMsgs.length),
        realtimeConfig: input.realtimeConfig,
        stripImages: true,
    });
    let history = payload.cleanedApiMessages.slice(-CINEMA_HISTORY_LIMIT);
    // 截断后开头如果是角色的话，前面缺了上下文，去掉那一条免得有的接口不认
    while (history.length && history[0]?.role !== 'user') history = history.slice(1);
    return { systemPrompt: payload.systemPrompt, history, at: Date.now() };
}

/** 取准备好的上下文；没有或过期了就准备一份。同一时间只准备一次。 */
export function getCinemaContext(input: CinemaContextInput, now = Date.now()): Promise<PreparedContext> {
    const key = `${input.char.id}:${input.sessionId || ''}`;
    const at = cacheAt.get(key);
    const cached = contextCache.get(key);
    if (cached && at !== undefined && now - at < CINEMA_CONTEXT_TTL_MS) return cached;
    const pending = buildContext(input);
    contextCache.set(key, pending);
    cacheAt.set(key, now);
    // 准备失败别留在缓存里，下次重试
    pending.catch(() => { if (contextCache.get(key) === pending) { contextCache.delete(key); cacheAt.delete(key); } });
    return pending;
}

/** 进放映室时提前准备，第一句话就不用等。失败无所谓，发消息时会再试。 */
export function warmCinemaContext(input: CinemaContextInput): void {
    getCinemaContext(input).catch(error => console.warn('[cinema] 提前准备上下文失败，发消息时再试', error));
}

export interface AskCinemaInput extends CinemaContextInput {
    apiConfig: APIConfig;
    /** 已经包含用户刚发的那句（主动开口时没有新的用户句子） */
    session: CinemaSession;
    status?: CinemaStatus | null;
    frameDataUrl?: string;
    /** 角色自己想开口：不存假的用户消息，只在请求末尾临时补一条「没人说话」的提示 */
    proactive?: ProactiveReason;
    /** 开着「出声」时的语音写法（buildVoiceActingGuide），回复里会带停顿标记和语气声 */
    voiceGuide?: string;
}

export interface AskCinemaResult {
    /** 主动开口时角色选择「[安静]」就是空数组 */
    lines: string[];
    /** 这次真的把画面发给模型了（模型不支持看图时是 false） */
    sawFrame: boolean;
}

export async function askCharacterInCinema(input: AskCinemaInput): Promise<AskCinemaResult> {
    const { char, userProfile, apiConfig, session } = input;
    if (!apiConfig.baseUrl) throw new Error('还没有配置聊天 API');
    const userName = userProfile?.name || '用户';

    const context = await getCinemaContext({ ...input, sessionId: session.id });
    const sessionMessages = sessionLinesToApiMessages(session.lines);
    const frame = input.frameDataUrl && input.frameDataUrl.startsWith('data:image/') ? input.frameDataUrl : '';
    const proactive = input.proactive;
    // 主动开口：接口要求最后一条是 user，图片也要贴在 user 上，所以临时补一条提示（不存、不显示）
    const withNudge = (hasFrame: boolean) => proactive
        ? [...context.history, ...sessionMessages, { role: 'user', content: buildProactiveNudge(proactive, hasFrame) }]
        : [...context.history, ...sessionMessages];
    const textMessages = withNudge(false);

    const send = (messages: any[], hasFrame: boolean, retries: number) => {
        const system = context.systemPrompt + buildCinemaInstruction({
            userName, charName: char.name, session, status: input.status, hasFrame,
            notes: session.notes, proactive, voiceGuide: input.voiceGuide,
        });
        const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
        return safeFetchJson(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'system', content: system }, ...messages],
                temperature: 0.9,
                // Claude 原生接口必填；经 OpenAI→Claude 中转时缺了会被打回（跟通话一致）
                max_tokens: 2000,
                stream: false,
            }),
        }, retries, 0, { appName: '影院', charId: char.id, charName: char.name, purpose: `${proactive ? '一起看·主动开口' : '一起看'}${hasFrame ? '·带画面' : ''}` });
    };

    let data: any;
    let sawFrame = !!frame;
    if (frame) {
        try {
            // 带图那次只试一次：被拒的大图没必要重发三遍
            data = await send(attachSnapshotToLatestUserMessage(withNudge(true), frame), true, 0);
        } catch (error) {
            if (!isVisionInputUnsupportedError(error)) throw error;
            console.warn('[cinema] 模型不收图片，这一轮改为只发文字', error);
            sawFrame = false;
            data = await send(textMessages, false, 2);
        }
    } else {
        data = await send(textMessages, false, 2);
    }
    const raw = data?.choices?.[0]?.message?.content || '';
    if (proactive && isSilentReply(raw)) return { lines: [], sawFrame };
    const lines = cleanCinemaReply(raw).filter(line => !isSilentReply(line));
    if (!lines.length) {
        if (proactive) return { lines: [], sawFrame };
        throw new Error('角色这次没有回复内容（模型返回为空）');
    }
    return { lines, sawFrame };
}
