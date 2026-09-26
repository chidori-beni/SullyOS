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

export async function askCharacterAboutHighlight(input: {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    apiConfig: APIConfig;
    realtimeConfig?: RealtimeConfig;
    memoryPalaceConfig?: MemoryConfigLike;
    novelId: string;
    message: string;
}): Promise<string> {
    const { char, userProfile, apiConfig } = input;
    if (!apiConfig.baseUrl) throw new Error('还没有配置聊天 API');
    const userName = userProfile?.name || '用户';
    await DB.saveMessage({
        charId: char.id, role: 'user', type: 'text', content: input.message,
        metadata: { source: 'bookroom', bookroomKind: 'highlight', bookroomNovelId: input.novelId },
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
            messages: [{ role: 'system', content: payload.systemPrompt + MARGIN_INSTRUCTION(userName) }, ...payload.cleanedApiMessages],
            temperature: 0.9, stream: false,
        }),
    }, 2, 0, { appName: '书房', charId: char.id, charName: char.name, purpose: '划线回应' });
    const reply = cleanMarginReply(data?.choices?.[0]?.message?.content || '');
    if (!reply) throw new Error('角色这次没有回复内容（模型返回为空）');
    await DB.saveMessage({
        charId: char.id, role: 'assistant', type: 'text', content: reply,
        metadata: { source: 'bookroom', bookroomKind: 'highlight-reply', bookroomNovelId: input.novelId },
    });
    void triggerMemoryPipeline(char, apiConfig, input.memoryPalaceConfig, userName);
    return reply;
}
