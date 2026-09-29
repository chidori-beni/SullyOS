import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildChatRequestPayload = vi.fn();
vi.mock('../chatRequestPayload', () => ({ buildChatRequestPayload: (...args: any[]) => buildChatRequestPayload(...args) }));
vi.mock('../chatContextRange', () => ({ loadCharacterContextMessages: vi.fn(async () => []) }));
vi.mock('../db', () => ({ DB: { getEmojis: vi.fn(async () => []), getEmojiCategories: vi.fn(async () => []) } }));
vi.mock('../safeApi', () => ({ safeFetchJson: vi.fn() }));

const { getCinemaContext, CINEMA_CONTEXT_TTL_MS, CINEMA_HISTORY_LIMIT } = await import('./askCinema');

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
