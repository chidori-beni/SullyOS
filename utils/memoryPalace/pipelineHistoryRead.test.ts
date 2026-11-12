import { describe, expect, it, vi } from 'vitest';

// 2026-11-12：通话里每 10 分钟整理一次记忆，以前把角色全部历史（含内联图片）整段读进内存，
// iPhone 直接杀页面。日常路径只读水位线之后的消息。
const dbMock = vi.hoisted(() => ({
    getMessagesByCharId: vi.fn(async () => []),
    getMessagesFromId: vi.fn(async (_charId: string, fromId: number) => ({
        messages: Array.from({ length: 30 }, (_, i) => ({
            id: fromId + i, charId: 'c1', role: i % 2 ? 'assistant' : 'user', type: 'text',
            content: `第${i}句`, timestamp: 1_700_000_000_000 + i,
        })),
        totalCount: 30,
    })),
    getAllCharacters: vi.fn(async () => []),
}));
vi.mock('../db', () => ({ DB: dbMock }));
vi.mock('./highWaterMark', () => ({
    getLocalMemoryPalaceHighWaterMark: () => 100,
    getReliableMemoryPalaceHighWaterMark: vi.fn(async () => 100),
    setReliableMemoryPalaceHighWaterMark: vi.fn(async () => undefined),
}));

describe('processNewMessages 日常路径', () => {
    it('只从水位线之后读，不整段读历史', async () => {
        localStorage.clear();
        const { processNewMessages } = await import('./pipeline');
        const result = await processNewMessages([], 'c1', '角色', {} as any, {} as any);
        expect(dbMock.getMessagesFromId).toHaveBeenCalledWith('c1', 101);
        expect(dbMock.getMessagesByCharId).not.toHaveBeenCalled();
        expect(result).toMatchObject({ stored: 0 });
    });
});
