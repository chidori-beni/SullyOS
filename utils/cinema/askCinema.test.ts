import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildChatRequestPayload = vi.fn();
const safeFetchJson = vi.fn();
vi.mock('../chatRequestPayload', () => ({ buildChatRequestPayload: (...args: any[]) => buildChatRequestPayload(...args) }));
vi.mock('../chatContextRange', () => ({ loadCharacterContextMessages: vi.fn(async () => []) }));
vi.mock('../db', () => ({ DB: { getEmojis: vi.fn(async () => []), getEmojiCategories: vi.fn(async () => []) } }));
vi.mock('../safeApi', () => ({ safeFetchJson: (...args: any[]) => safeFetchJson(...args) }));

const { askCharacterInCinema, getCinemaContext, CINEMA_CONTEXT_TTL_MS, CINEMA_HISTORY_LIMIT } = await import('./askCinema');

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
const input = (id: string) => ({ char: { id, name: '萧逸', xinshengEnabled: true } as any, userProfile: { name: '千夜' } as any, groups: [] });

describe('影院 · 上下文一场只准备一次', () => {
    beforeEach(() => {
        buildChatRequestPayload.mockReset();
        buildChatRequestPayload.mockImplementation(async () => ({ systemPrompt: 'SYS', cleanedApiMessages: msgs(101) }));
    });

    it('10 分钟内反复取只准备一次，过期了重新准备', async () => {
        const t0 = 1_000_000;
        await getCinemaContext(input('a'), t0);
        await getCinemaContext(input('a'), t0 + 60_000);
        expect(buildChatRequestPayload).toHaveBeenCalledTimes(1);
        await getCinemaContext(input('a'), t0 + CINEMA_CONTEXT_TTL_MS + 1);
        expect(buildChatRequestPayload).toHaveBeenCalledTimes(2);
    });

    it('准备时关掉心声，私聊只带最近几十条，并且从用户那条开始', async () => {
        const ctx = await getCinemaContext(input('b'));
        expect(buildChatRequestPayload.mock.calls[0][0].char.xinshengEnabled).toBe(false);
        expect(ctx.history.length).toBeLessThanOrEqual(CINEMA_HISTORY_LIMIT);
        expect(ctx.history[0].role).toBe('user');
    });

    it('准备失败不留在缓存里，下次会重试', async () => {
        buildChatRequestPayload.mockRejectedValueOnce(new Error('boom'));
        await expect(getCinemaContext(input('c'))).rejects.toThrow('boom');
        await getCinemaContext(input('c'));
        expect(buildChatRequestPayload).toHaveBeenCalledTimes(2);
    });
});

describe('影院 · 主动开口', () => {
    const session = (id: string) => ({
        id, charId: 'p', title: '钟表馆事件', spoiler: 'first' as const, startedAt: 0, updatedAt: 0,
        lines: [{ role: 'user' as const, text: '好紧张', at: 1 }, { role: 'char' as const, text: '别怕', at: 2 }],
        notes: [{ at: 3, videoTime: 600, text: '女主推开钟楼的门' }],
    });
    const ask = (id: string, reply: string, frame = 'data:image/jpeg;base64,xx') => {
        safeFetchJson.mockResolvedValueOnce({ choices: [{ message: { content: reply } }] });
        return askCharacterInCinema({
            ...input(`proactive-${id}`), apiConfig: { baseUrl: 'https://api.example', apiKey: 'k', model: 'm' } as any,
            session: session(id), frameDataUrl: frame, proactive: 'scene',
        });
    };

    beforeEach(() => {
        buildChatRequestPayload.mockReset();
        buildChatRequestPayload.mockImplementation(async () => ({ systemPrompt: 'SYS', cleanedApiMessages: msgs(4) }));
        safeFetchJson.mockReset();
    });

    it('末尾临时补一条「没人说话」的提示，画面贴在它上面；系统提示里带着笔记', async () => {
        const result = await ask('a', '门后面肯定有东西');
        expect(result.lines).toEqual(['门后面肯定有东西']);
        const body = JSON.parse(safeFetchJson.mock.calls[0][1].body);
        const last = body.messages[body.messages.length - 1];
        expect(last.role).toBe('user');
        expect(last.content[0].text).toContain('这一轮没有人跟你说话');
        expect(last.content[1].type).toBe('image_url');
        // 用户之前那句还是纯文字，没被贴图
        expect(body.messages.some((m: any) => m.content === '好紧张')).toBe(true);
        expect(body.messages[0].content).toContain('女主推开钟楼的门');
    });

    it('角色回「[安静]」就是这次不说话，不算出错', async () => {
        const result = await ask('b', '[安静]');
        expect(result.lines).toEqual([]);
    });
});
