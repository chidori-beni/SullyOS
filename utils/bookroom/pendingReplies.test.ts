import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRecord, type BookroomRecord } from './bookroom';

const store = new Map<string, BookroomRecord>();
let busyIds = new Set<string>();
let failNext = '';
const asks: any[] = [];

vi.mock('./bookroomDb', () => ({
    listBookroomRecords: vi.fn(async () => [...store.values()].map(r => structuredClone(r))),
    getBookroomRecord: vi.fn(async (id: string) => structuredClone(store.get(id))),
    saveBookroomRecord: vi.fn(async (r: BookroomRecord) => { store.set(r.novelId, structuredClone(r)); }),
}));
vi.mock('./highlightReply', async () => {
    const actual: any = await vi.importActual('./highlightReply');
    const fake = async (input: any) => {
        asks.push(input);
        if (!input.skipUserMessage) input.onUserMessageSaved?.();
        if (failNext) { const m = failNext; failNext = ''; throw new Error(m); }
        return input.kind === 'review' ? '评分：4/5\n好书' : '我也喜欢这句';
    };
    return {
        ...actual,
        checkCharBusy: vi.fn(async (c: any) => (busyIds.has(c.id) ? { level: 'busy', activity: '开会' } : null)),
        askCharacterAboutHighlight: vi.fn((input: any) => fake({ ...input, kind: 'highlight' })),
        askCharacterInBookroom: vi.fn(fake),
    };
});

import { addNoteWaiting, addReviewWaiting, processPendingReplies } from './pendingReplies';

const xiao: any = { id: 'c1', name: '萧逸' };
const ctx: any = { characters: [xiao], userProfile: { name: '千夜' }, groups: [], apiConfig: { baseUrl: 'http://x' } };
const waiting = { charId: 'c1', charName: '萧逸', since: 1000, activity: '开会' };

beforeEach(() => {
    store.clear(); busyIds = new Set(); failNext = ''; asks.length = 0;
    let rec: BookroomRecord = {
        ...emptyRecord('n1'), title: '雨', segCount: 20,
        notes: [{ id: 'm1', chapter: '第一章', quote: '你回来了。', note: '哭了', at: 1, source: 'manual' }],
        reviews: { user: { text: '写得真好', rating: 5, at: 1 } },
    };
    rec = addNoteWaiting(rec, 'm1', { ...waiting, comment: '哭死' });
    rec = addReviewWaiting(rec, waiting);
    store.set('n1', rec);
});

describe('等回复队列', () => {
    it('ta 还在忙：什么都不做，队列留着', async () => {
        busyIds.add('c1');
        expect(await processPendingReplies(ctx)).toEqual([]);
        expect(asks).toHaveLength(0);
        expect(store.get('n1')!.notes![0].waiting).toHaveLength(1);
    });

    it('ta 有空了：划线回复挂回笔记、书评写好放进书评，队列清掉', async () => {
        const done = await processPendingReplies(ctx);
        expect(done.map(d => d.kind).sort()).toEqual(['highlight', 'review']);
        const rec = store.get('n1')!;
        expect(rec.notes![0].replies).toEqual([expect.objectContaining({ charId: 'c1', content: '我也喜欢这句' })]);
        expect(rec.notes![0].waiting).toEqual([]);
        expect(rec.reviews!.chars).toEqual([expect.objectContaining({ charId: 'c1', rating: 4, text: '好书' })]);
        expect(rec.reviews!.waiting).toEqual([]);
        // 用的是用户当时附的话，带着「几点分享、那时在忙什么」
        const hl = asks.find(a => a.kind === 'highlight');
        expect(hl.message).toContain('哭死');
        expect(hl.deferred).toEqual({ since: 1000, activity: '开会' });
    });

    it('没回成：记下原因，已经发进私聊的那条下次不再发；过一阵才重试', async () => {
        failNext = '网络错误';
        await processPendingReplies(ctx, Date.now(), 1);
        const w = store.get('n1')!.notes![0].waiting![0];
        expect(w).toMatchObject({ lastError: '网络错误', messageSent: true });
        asks.length = 0;
        await processPendingReplies(ctx, Date.now(), 1);   // 刚失败，先不试这条
        expect(asks.every(a => a.kind !== 'highlight')).toBe(true);
        asks.length = 0;
        await processPendingReplies(ctx, Date.now() + 11 * 60 * 1000);
        expect(asks.find(a => a.kind === 'highlight').skipUserMessage).toBe(true);
    });

    it('用户把书评删了 / 角色删了：不等了', async () => {
        const rec = store.get('n1')!;
        store.set('n1', { ...rec, reviews: { ...rec.reviews, user: undefined } });
        await processPendingReplies({ ...ctx, characters: [{ id: 'other', name: '别人' }] });
        expect(store.get('n1')!.notes![0].waiting).toEqual([]);
        expect(store.get('n1')!.reviews!.waiting).toEqual([]);
        expect(asks).toHaveLength(0);
    });
});
