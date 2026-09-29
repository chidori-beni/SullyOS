import { beforeEach, describe, expect, it, vi } from 'vitest';

// 「这一场记不记」：不留痕时把已经存进私聊的删掉；改回记住时按原来的时间补存。
const messages: any[] = [];
const DB = {
    getRecentMessagesByCharIdAndSource: vi.fn(async (charId: string, source: string) =>
        messages.filter(m => m.charId === charId && m.metadata?.source === source)),
    deleteMessages: vi.fn(async (ids: number[]) => {
        for (const id of ids) { const i = messages.findIndex(m => m.id === id); if (i >= 0) messages.splice(i, 1); }
    }),
    saveMessage: vi.fn(async (m: any) => { messages.push({ ...m, id: messages.length + 100 }); return messages.length + 100; }),
};
vi.mock('../db', () => ({ DB, openDB: vi.fn() }));

const { removeSessionFromChat, backfillSessionToChat } = await import('./cinemaDb');
const { newCinemaSession, sessionRemembers } = await import('./cinema');

describe('这一场记不记', () => {
    beforeEach(() => { messages.length = 0; vi.clearAllMocks(); });

    it('默认记住；旧记录没有字段也算记住', () => {
        expect(newCinemaSession({ charId: 'c', title: 'x', spoiler: 'first' }).remember).toBe(true);
        expect(newCinemaSession({ charId: 'c', title: 'x', spoiler: 'first', remember: false }).remember).toBe(false);
        expect(sessionRemembers({})).toBe(true);
        expect(sessionRemembers({ remember: false })).toBe(false);
    });

    it('改成不留痕：只删这一场的话和散场卡，别的场次、普通聊天不动', async () => {
        messages.push(
            { id: 1, charId: 'c', metadata: { source: 'cinema', cinemaSessionId: 's1' } },
            { id: 2, charId: 'c', metadata: { source: 'cinema', cinemaSessionId: 's1' } },
            { id: 3, charId: 'c', metadata: { source: 'cinema-end', cinemaSessionId: 's1' } },
            { id: 4, charId: 'c', metadata: { source: 'cinema', cinemaSessionId: 's0' } },
            { id: 5, charId: 'c', metadata: {} },
        );
        expect(await removeSessionFromChat('c', 's1')).toBe(3);
        expect(messages.map(m => m.id)).toEqual([4, 5]);
    });

    it('这一场本来就没存过，什么都不删', async () => {
        expect(await removeSessionFromChat('c', 'nothing')).toBe(0);
        expect(DB.deleteMessages).not.toHaveBeenCalled();
    });

    it('改回记住：按原来的时间补存，小动作带回括号', async () => {
        const session = {
            ...newCinemaSession({ charId: 'c', title: '钟表馆事件', spoiler: 'first' }),
            id: 's2',
            lines: [
                { role: 'user' as const, text: '好吓人', at: 1000, videoTime: 65 },
                { role: 'char' as const, text: '往你那边靠了靠', at: 2000, kind: 'action' as const },
                { role: 'char' as const, text: '别怕', at: 2001 },
            ],
        };
        expect(await backfillSessionToChat('c', session)).toBe(3);
        expect(messages.map(m => [m.role, m.content, m.timestamp])).toEqual([
            ['user', '好吓人', 1000],
            ['assistant', '（往你那边靠了靠）', 2000],
            ['assistant', '别怕', 2001],
        ]);
        expect(messages[0].metadata).toMatchObject({ source: 'cinema', cinemaSessionId: 's2', cinemaVideoTime: 65 });
    });
});
