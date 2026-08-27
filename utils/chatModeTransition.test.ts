import { describe, expect, it } from 'vitest';

import type { Message } from '../types';
import { appendRecentCallEndBoundary, buildChatRequestPayload } from './chatRequestPayload';
import { detectChatModeTransition } from './chatPrompts';

const message = (
    id: number,
    role: Message['role'],
    source?: string,
    metadata: Record<string, unknown> = {},
): Message => ({
    id,
    charId: 'char-return',
    role,
    type: role === 'system' ? 'system' : 'text',
    content: `message-${id}`,
    timestamp: id,
    metadata: source ? { source, ...metadata } : metadata,
} as Message);

describe('detectChatModeTransition', () => {
    it.each([
        ['call', message(2, 'assistant', 'call'), 'call'],
        ['video', message(2, 'assistant', 'call', { callMode: 'video' }), 'video'],
        ['date', message(2, 'assistant', 'date'), 'date'],
        ['story', message(2, 'assistant', 'story_theater_memory'), 'story'],
    ] as const)('识别从 %s 回到 ChatApp 的第一轮', (_label, modeMessage, expected) => {
        expect(detectChatModeTransition([
            message(1, 'assistant'),
            modeMessage,
            message(3, 'user'),
        ])).toBe(expected);
    });

    it('用户连续发送多个气泡时仍能越过它们找到刚结束的模式', () => {
        expect(detectChatModeTransition([
            message(1, 'assistant'),
            message(2, 'assistant', 'date'),
            message(3, 'system'),
            message(4, 'user'),
            message(5, 'user'),
        ])).toBe('date');
    });

    it('已经产生普通 ChatApp assistant 回复后不再重复提醒', () => {
        expect(detectChatModeTransition([
            message(1, 'assistant', 'story_theater_memory'),
            message(2, 'user'),
            message(3, 'assistant'),
            message(4, 'user'),
        ])).toBeNull();
    });

    it('特殊模式之后还没有新的 ChatApp 用户输入时不误报', () => {
        expect(detectChatModeTransition([
            message(1, 'assistant'),
            message(2, 'assistant', 'call'),
            message(3, 'system', 'call-end-popup'),
        ])).toBeNull();
    });

    it('突然挂断后直接点生成回复时仍提醒角色承接一次', () => {
        expect(detectChatModeTransition([
            message(1, 'assistant', 'call'),
            message(2, 'system', 'call-end-popup', { callEndedAbruptly: true }),
        ])).toBe('call');
    });

    it('结束卡后的迟到通话气泡也不能遮掉突然挂断提醒', () => {
        expect(detectChatModeTransition([
            message(1, 'assistant', 'call'),
            message(2, 'system', 'call-end-popup', { callEndedAbruptly: true }),
            message(3, 'assistant', 'call'),
        ])).toBe('call');
    });

    it('通话结束卡片后的迟到通话气泡不能遮掉已挂断边界', () => {
        expect(detectChatModeTransition([
            message(1, 'assistant', 'call'),
            message(2, 'system', 'call-end-popup'),
            message(3, 'assistant', 'call'),
            message(4, 'user'),
        ])).toBe('call');
    });

    it('自适应水位线裁掉结束卡时，把最近的边界补回当前聊天历史', () => {
        const now = Date.now();
        const boundary = message(2, 'system', 'call-end-popup', {
            callEnded: true,
            endedAt: now - 1_000,
        });
        const history = [message(4, 'user')];
        const recovered = appendRecentCallEndBoundary(history, [boundary], now);
        expect(recovered.map(item => item.id)).toEqual([2, 4]);
        expect(detectChatModeTransition(recovered)).toBe('call');
    });

    it('直接生成回复且窗口末尾是通话气泡时也能补回结束卡', () => {
        const now = Date.now();
        const boundary = message(2, 'system', 'call-end-popup', {
            callEnded: true,
            callEndedAbruptly: true,
            endedAt: now - 1_000,
        });
        const history = [message(3, 'assistant', 'call')];
        const recovered = appendRecentCallEndBoundary(history, [boundary], now);
        expect(recovered.map(item => item.id)).toEqual([2, 3]);
        expect(detectChatModeTransition(recovered)).toBe('call');
    });
});

describe('buildChatRequestPayload 模式切换接线', () => {
    it('即使 recentMsgsHint 已过滤通话记录，也按完整 API 历史注入视频转文字提醒', async () => {
        const historyMsgs = [
            message(1, 'assistant'),
            message(2, 'assistant', 'call', { callMode: 'video' }),
            message(3, 'system', 'call-end-popup', { callMode: 'video' }),
            message(4, 'user'),
        ];
        const payload = await buildChatRequestPayload({
            char: {
                id: 'char-return',
                name: '阿一',
                timeAwarenessEnabled: false,
                scheduleFeatureEnabled: false,
            } as any,
            userProfile: { name: '小明' } as any,
            groups: [],
            emojis: [],
            categories: [],
            historyMsgs,
            // 模拟 Chat.tsx 的可见消息：call / call-end-popup 均不在这份 React state 中。
            recentMsgsHint: [message(1, 'assistant'), message(4, 'user')],
            contextLimit: 20,
            realtimeConfig: { weatherEnabled: false, newsEnabled: false } as any,
        });

        const joined = payload.fullMessages.map(item => String(item.content || '')).join('\n');
        expect(joined).toContain('系统提示｜模式切换（最高优先级）');
        expect(joined).toContain('刚刚结束了视频通话');
        expect(joined).toContain('现在已经回到 ChatApp 的文字聊天界面');
        expect(joined).toContain('如果 ChatApp 当前开启了语音消息，仍可遵守它自己的语音消息格式');
        expect(joined).toContain('当前没有一条仍然接通的语音线路');
        expect(joined).toContain('这通视频通话已经明确挂断');
    });

    it('没有新用户文字、直接生成回复时提示突然挂断的承接方式', async () => {
        const historyMsgs = [
            message(1, 'assistant', 'call'),
            message(2, 'system', 'call-end-popup', { callEndedAbruptly: true, callEnded: true }),
        ];
        const payload = await buildChatRequestPayload({
            char: {
                id: 'char-return',
                name: '阿一',
                timeAwarenessEnabled: false,
                scheduleFeatureEnabled: false,
            } as any,
            userProfile: { name: '小明' } as any,
            groups: [],
            emojis: [],
            categories: [],
            historyMsgs,
            recentMsgsHint: historyMsgs,
            contextLimit: 20,
            recallEntryPoint: 'chat_app',
            realtimeConfig: { weatherEnabled: false, newsEnabled: false } as any,
        });

        const joined = payload.fullMessages.map(item => String(item.content || '')).join('\n');
        expect(joined).toContain('没有检测到用户明确告别');
        expect(joined).toContain('自然问一句刚才是否出了什么事');
    });

    it('进行中的见面里发手机消息时不注入“刚结束见面”，并保留一次面对面手机来源标记', async () => {
        const historyMsgs = [
            message(1, 'assistant'),
            message(2, 'assistant', 'date', { dateEncounterId: 'enc-1' }),
            message(3, 'user', 'chat [面对面手机消息] 仍在同一地点', { datePhoneMessage: true, dateEncounterId: 'enc-1' }),
        ];
        const payload = await buildChatRequestPayload({
            char: {
                id: 'char-return',
                name: '阿一',
                timeAwarenessEnabled: false,
                scheduleFeatureEnabled: false,
                activeDateEncounter: { encounterId: 'enc-1', startedAt: 1, status: 'active', updatedAt: 2 },
            } as any,
            userProfile: { name: '小明' } as any,
            groups: [],
            emojis: [],
            categories: [],
            historyMsgs,
            recentMsgsHint: historyMsgs,
            contextLimit: 20,
            realtimeConfig: { weatherEnabled: false, newsEnabled: false } as any,
        });

        const joined = payload.fullMessages.map(item => String(item.content || '')).join('\n');
        expect(joined).toContain('仍在同一地点面对面');
        expect(joined).not.toContain('刚刚结束了线下见面');
        expect(joined).toContain('⟦SRC:FACE_PHONE⟧');
        expect(joined).not.toContain('[面对面手机消息]');
    });
});
