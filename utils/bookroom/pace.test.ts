import { describe, expect, it } from 'vitest';
import { emptyRecord, type BookroomRecord } from './bookroom';
import { buildPaceCaps, clampWindow, companionCap, readingPaceOf, READING_PACE_CHARS, withoutCaughtUp } from './pace';
import type { VRWorldNovel } from '../../types';

const rec = (over: Partial<BookroomRecord> = {}): BookroomRecord => ({
    ...emptyRecord('n1'), segCount: 100, companionIds: ['c1'],
    chapters: [{ title: '一', segIdx: 0 }, { title: '二', segIdx: 30 }, { title: '三', segIdx: 60 }],
    progress: { segIdx: 35, via: 'chapter', at: 1 }, ...over,
});
const novel = (id: string, n = 100): VRWorldNovel => ({ id, title: id, segments: Array.from({ length: n }, (_, idx) => ({ idx, text: 'x', chars: 400 })), totalChars: n * 400, createdAt: 0, updatedAt: 0 });

describe('陪读节奏', () => {
    it('最多读到用户当前那一章的结尾', () => {
        expect(companionCap(rec(), 'c1')).toBe(60);
        expect(companionCap(rec({ progress: { segIdx: 70, via: 'chapter', at: 1 } }), 'c1')).toBe(100); // 最后一章：读到书尾
    });

    it('不是一起读的人、用户没报过进度、用户已读完：都不限', () => {
        expect(companionCap(rec(), 'other')).toBeUndefined();
        expect(companionCap(rec({ progress: undefined }), 'c1')).toBeUndefined();
        expect(companionCap(rec({ progress: { segIdx: 99, via: 'chapter', at: 1 } }), 'c1')).toBeUndefined();
    });

    it('没有目录时最多多读 10 段', () => {
        expect(companionCap(rec({ chapters: undefined }), 'c1')).toBe(45);
    });

    it('追上用户的陪读书这一轮不给读，别的书照常', () => {
        const caps = buildPaceCaps([rec()], 'c1');
        const books = [novel('n1'), novel('n2')];
        const vr = (bm: number) => ({ vrState: { enabled: true, intervalMinutes: 120, novelBookmarks: { n1: bm } } });
        expect(withoutCaughtUp(books, vr(59), caps).map(n => n.id)).toEqual(['n1', 'n2']);
        expect(withoutCaughtUp(books, vr(60), caps).map(n => n.id)).toEqual(['n2']);
        expect(withoutCaughtUp(books, vr(80), caps).map(n => n.id)).toEqual(['n2']);
    });

    it('阅读窗口截到上限', () => {
        const win = { from: 50, to: 90, segments: Array.from({ length: 40 }, (_, i) => ({ idx: 50 + i, text: 'x', chars: 400 })), reachedEnd: false };
        const clamped = clampWindow(win, 60);
        expect([clamped.from, clamped.to, clamped.segments.length, clamped.reachedEnd]).toEqual([50, 60, 10, false]);
        expect(clampWindow(win, undefined)).toBe(win);
        expect(clampWindow(win, 95)).toBe(win);
    });
});

describe('阅读速度', () => {
    it('默认正常 1.5 万字；可选细读 / 快读', () => {
        expect(readingPaceOf({})).toBe('normal');
        expect(READING_PACE_CHARS[readingPaceOf({})]).toBe(15000);
        expect(READING_PACE_CHARS[readingPaceOf({ vrState: { enabled: true, intervalMinutes: 120, readingPace: 'slow' } })]).toBe(5000);
    });
});
