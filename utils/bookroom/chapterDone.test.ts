import { describe, expect, it } from 'vitest';
import { buildProgressMessage, buildReadingTogetherNote, chapterEndSeg, emptyRecord, type BookroomRecord } from './bookroom';
import { pickReadingTogether } from './readingTogether';
import { companionCap } from './pace';

describe('报进度：读完这章 vs 读到这章', () => {
    const chapters = [{ title: '第一章', segIdx: 0 }, { title: '第二章', segIdx: 10 }];
    const now = 1_800_000_000_000;
    const rec = (over: Partial<BookroomRecord>): BookroomRecord => ({
        ...emptyRecord('n1'), title: '雨', segCount: 20, chapters, companionIds: ['c1'],
        progress: { segIdx: 0, via: 'chapter', at: now - 1000 }, ...over,
    });

    it('读完这章记在这章最后一段；最后一章读完就是全书最后一段', () => {
        expect(chapterEndSeg(chapters, 0, 20)).toBe(9);
        expect(chapterEndSeg(chapters, 1, 20)).toBe(19);
    });

    it('消息里说「读完了」', () => {
        expect(buildProgressMessage({ bookTitle: '雨', chapterTitle: '第一章', ratio: 0.47, finished: false, chapterDone: true }))
            .toContain('我《雨》读完了「第一章」（全书约 47%）');
        expect(buildProgressMessage({ bookTitle: '雨', chapterTitle: '第一章', ratio: 0, finished: false }))
            .toContain('读到了「第一章」');
    });

    it('读完这章后，读到章末的角色不再算「比你靠前」，可以聊这一章', () => {
        const char = { id: 'c1', vrState: { enabled: true, intervalMinutes: 120, novelBookmarks: { n1: 10 } } };
        // 以前：只记在章节标题那段，角色读完这章就被当成「靠前」，不许聊
        const before = buildReadingTogetherNote('千夜', pickReadingTogether(char, [rec({})], now));
        expect(before).toContain('」，比千夜靠前');
        const after = buildReadingTogetherNote('千夜', pickReadingTogether(char, [rec({ progress: { segIdx: 9, via: 'chapter', chapterDone: true, at: now - 1000 } })], now));
        expect(after).toContain('千夜读完了「第一章」');
        expect(after).not.toContain('」，比千夜靠前');
    });

    it('角色陪读上限不变：还是读到这章结尾，不会跑去下一章', () => {
        expect(companionCap(rec({ progress: { segIdx: 9, via: 'chapter', chapterDone: true, at: now } }), 'c1')).toBe(10);
        expect(companionCap(rec({}), 'c1')).toBe(10);
    });
});
