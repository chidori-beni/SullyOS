import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { backfillXinshengRoundIdForSession, newXinshengRoundId, readRoundId, XINSHENG_ROUND_META_KEY } from './xinshengRound';

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('newXinshengRoundId / readRoundId', () => {
    it('id 带定长时间戳前缀，字典序等于时间序', () => {
        const a = newXinshengRoundId(1756272000000);
        const b = newXinshengRoundId(1756272000001);
        expect(a < b).toBe(true);
        expect(a.startsWith('xs_1756272000000_')).toBe(true);
    });

    it('readRoundId 从 metadata 里取；没有就是 null', () => {
        expect(readRoundId({ metadata: { [XINSHENG_ROUND_META_KEY]: 'xs_1' } })).toBe('xs_1');
        expect(readRoundId({ metadata: {} })).toBeNull();
        expect(readRoundId(null)).toBeNull();
        expect(readRoundId({ metadata: { [XINSHENG_ROUND_META_KEY]: 123 } })).toBeNull(); // 类型不对也不认
    });
});

// ─── 真实故障复现：一条回复被 worker 拆成好几条独立推送 ───────────────────────
//
// 每条推送在客户端各自单独跑一遍 applyAssistantPostProcessing，互不知道彼此；
// 心声 JSON 协议上只挂最后一条推送。只有处理最后一条的那次调用能拿到 roundId，
// 前面几条推送早就各自落库完了，metadata 里压根没有这个字段——用户实测「每条都显示」
// 头像模式下，除最后一条外完全没有按压效果，正是因为它们真的不是可点击状态。
describe('backfillXinshengRoundIdForSession', () => {
    // 极简内存 DB：只实现 backfill 需要的两个方法
    const makeFakeDb = (messages: Array<{ id: number; role: string; metadata?: any }>) => {
        const store = new Map(messages.map(m => [m.id, { ...m }]));
        return {
            store,
            getRecentMessagesByCharId: async (_charId: string, _limit: number) => [...store.values()],
            updateMessageMetadata: async (id: number, updater: (prev: any) => any) => {
                const msg = store.get(id);
                if (!msg) throw new Error('not found');
                msg.metadata = updater(msg.metadata);
            },
        };
    };

    const SESSION = 'sess-abc';

    it('把同 session、还没打 roundId 的早前气泡全部补上；最后一条（已经有）不动', () => {
        const db = makeFakeDb([
            { id: 1, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION } } },
            { id: 2, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION } } },
            { id: 3, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION }, [XINSHENG_ROUND_META_KEY]: 'xs_final' } },
        ]);
        return backfillXinshengRoundIdForSession('char1', SESSION, 'xs_final', db).then((patched) => {
            expect(patched).toBe(2);
            expect(db.store.get(1)!.metadata[XINSHENG_ROUND_META_KEY]).toBe('xs_final');
            expect(db.store.get(2)!.metadata[XINSHENG_ROUND_META_KEY]).toBe('xs_final');
            expect(db.store.get(3)!.metadata[XINSHENG_ROUND_META_KEY]).toBe('xs_final'); // 原本就有，值不变
        });
    });

    it('不同 sessionId 的气泡不会被碰', async () => {
        const db = makeFakeDb([
            { id: 1, role: 'assistant', metadata: { activeMsg2: { sessionId: 'other-session' } } },
            { id: 2, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION } } },
        ]);
        const patched = await backfillXinshengRoundIdForSession('char1', SESSION, 'xs_final', db);
        expect(patched).toBe(1);
        expect(db.store.get(1)!.metadata[XINSHENG_ROUND_META_KEY]).toBeUndefined();
        expect(db.store.get(2)!.metadata[XINSHENG_ROUND_META_KEY]).toBe('xs_final');
    });

    it('用户消息不会被打上 roundId（只处理 assistant）', async () => {
        const db = makeFakeDb([
            { id: 1, role: 'user', metadata: { activeMsg2: { sessionId: SESSION } } },
            { id: 2, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION } } },
        ]);
        const patched = await backfillXinshengRoundIdForSession('char1', SESSION, 'xs_final', db);
        expect(patched).toBe(1);
        expect(db.store.get(1)!.metadata[XINSHENG_ROUND_META_KEY]).toBeUndefined();
    });

    it('没有 sessionId 的气泡（本地生成 / 老消息）不会被误伤', async () => {
        const db = makeFakeDb([
            { id: 1, role: 'assistant', metadata: {} },
            { id: 2, role: 'assistant' },
            { id: 3, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION } } },
        ]);
        const patched = await backfillXinshengRoundIdForSession('char1', SESSION, 'xs_final', db);
        expect(patched).toBe(1);
        expect(db.store.get(1)!.metadata[XINSHENG_ROUND_META_KEY]).toBeUndefined();
        expect(db.store.get(3)!.metadata[XINSHENG_ROUND_META_KEY]).toBe('xs_final');
    });

    it('参数缺一个都不动手，也不抛异常', async () => {
        const db = makeFakeDb([{ id: 1, role: 'assistant', metadata: { activeMsg2: { sessionId: SESSION } } }]);
        expect(await backfillXinshengRoundIdForSession('', SESSION, 'xs_final', db)).toBe(0);
        expect(await backfillXinshengRoundIdForSession('char1', '', 'xs_final', db)).toBe(0);
        expect(await backfillXinshengRoundIdForSession('char1', SESSION, '', db)).toBe(0);
    });

    it('单条查询/更新失败时吞掉警告，不让整个函数抛出去把这一轮回复卡住', async () => {
        const db = {
            getRecentMessagesByCharId: async () => { throw new Error('db down'); },
            updateMessageMetadata: async () => {},
        };
        await expect(backfillXinshengRoundIdForSession('char1', SESSION, 'xs_final', db)).resolves.toBe(0);
    });
});
