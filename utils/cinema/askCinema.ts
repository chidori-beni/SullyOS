/**
 * 请角色在放映室里说一句。
 *
 * 上下文 = 正常私聊那一整套（人设、记忆、关系、最近聊天）+ 影院说明 + 这一场的对话。
 * 此刻的画面贴在最后一条用户消息上（跟通话的「每轮快照」同一个做法）；
 * 模型不支持看图时自动退回只发文字。
 *
 * 放映室里的对话**不写进私聊**：一部片子边看边聊几十句，会把聊天记录冲掉。
 * 这一场记在影院自己的记录里（cinemaDb），以后再做「看完写进记忆」。
 */
import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import { DB } from '../db';
import { buildChatRequestPayload } from '../chatRequestPayload';
import { loadCharacterContextMessages } from '../chatContextRange';
import { safeFetchJson } from '../safeApi';
import { attachSnapshotToLatestUserMessage, isVisionInputUnsupportedError } from '../userCameraSnapshot';
import { buildCinemaInstruction, cleanCinemaReply, sessionLinesToApiMessages, type CinemaSession, type CinemaStatus } from './cinema';

export interface AskCinemaInput {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    apiConfig: APIConfig;
    realtimeConfig?: RealtimeConfig;
    /** 已经包含用户刚发的那句 */
    session: CinemaSession;
    status?: CinemaStatus | null;
    frameDataUrl?: string;
}

export interface AskCinemaResult {
    lines: string[];
    /** 这次真的把画面发给模型了（模型不支持看图时是 false） */
    sawFrame: boolean;
}

export async function askCharacterInCinema(input: AskCinemaInput): Promise<AskCinemaResult> {
    const { char, userProfile, apiConfig, session } = input;
    if (!apiConfig.baseUrl) throw new Error('还没有配置聊天 API');
    const userName = userProfile?.name || '用户';

    const historyMsgs = await loadCharacterContextMessages(char);
    const payload = await buildChatRequestPayload({
        char, userProfile, groups: input.groups,
        emojis: await DB.getEmojis(), categories: await DB.getEmojiCategories(),
        historyMsgs, contextLimit: Math.max(1, historyMsgs.length),
        realtimeConfig: input.realtimeConfig,
        stripImages: true,
    });
    const sessionMessages = sessionLinesToApiMessages(session.lines);
    const textMessages = [...payload.cleanedApiMessages, ...sessionMessages];
    const frame = input.frameDataUrl && input.frameDataUrl.startsWith('data:image/') ? input.frameDataUrl : '';

    const send = (messages: any[], hasFrame: boolean, retries: number) => {
        const system = payload.systemPrompt + buildCinemaInstruction({
            userName, charName: char.name, session, status: input.status, hasFrame,
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
        }, retries, 0, { appName: '影院', charId: char.id, charName: char.name, purpose: hasFrame ? '一起看·带画面' : '一起看' });
    };

    let data: any;
    let sawFrame = !!frame;
    if (frame) {
        try {
            // 带图那次只试一次：被拒的大图没必要重发三遍
            data = await send(attachSnapshotToLatestUserMessage(textMessages, frame), true, 0);
        } catch (error) {
            if (!isVisionInputUnsupportedError(error)) throw error;
            console.warn('[cinema] 模型不收图片，这一轮改为只发文字', error);
            sawFrame = false;
            data = await send(textMessages, false, 2);
        }
    } else {
        data = await send(textMessages, false, 2);
    }
    const lines = cleanCinemaReply(data?.choices?.[0]?.message?.content || '');
    if (!lines.length) throw new Error('角色这次没有回复内容（模型返回为空）');
    return { lines, sawFrame };
}
