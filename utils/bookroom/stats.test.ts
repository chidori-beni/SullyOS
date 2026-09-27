import { describe, expect, it } from 'vitest';
import { buildReadingTogetherNote, emptyRecord, type BookroomRecord } from './bookroom';
import { pickReadingTogether } from './readingTogether';
import { dateKey, emptyMeta, monthGrid, parseRatedReview, parseRecommendation, readingDays, streakDays, yearSummary } from './stats';

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('打卡', () => {
    const rec: BookroomRecord = {
        ...emptyRecord('n1'),
        history: [
            { segIdx: 1, via: 'chapter', at: day(2026, 9, 24) },
            { segIdx: 2, via: 'chapter', at: day(2026, 9, 25, 23) },
        ],
    };

    it('报进度、手动打卡都算读过的日子', () => {
        const days = readingDays([rec], { ...emptyMeta(), checkins: ['2026-09-26'] });
        expect([...days].sort()).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    });

    it('连续天数：今天没读不算断，从昨天往回数；中间断一天就停', () => {
        const days = new Set(['2026-09-24', '2026-09-25', '2026-09-26']);
        expect(streakDays(days, day(2026, 9, 26))).toBe(3);
        expect(streakDays(days, day(2026, 9, 27))).toBe(3);
        expect(streakDays(days, day(2026, 9, 28))).toBe(0);
        expect(streakDays(new Set(['2026-09-24', '2026-09-26']), day(2026, 9, 26))).toBe(1);
    });

    it('月历：周一开头，2026 年 9 月 1 日是周二', () => {
        const grid = monthGrid(2026, 8);
        expect(grid.slice(0, 2)).toEqual([null, 1]);
        expect(grid.filter(Boolean)).toHaveLength(30);
        expect(dateKey(day(2026, 1, 5))).toBe('2026-01-05');
    });
});

describe('年度书单', () => {
    it('今年读完的书按读完时间排，带我的评分；往年读完的不算', () => {
        const a: BookroomRecord = {
            ...emptyRecord('a'), title: '甲', segCount: 10, companionIds: ['c1'],
            history: [{ segIdx: 3, via: 'chapter', at: day(2026, 3, 1) }, { segIdx: 9, via: 'chapter', at: day(2026, 5, 1) }],
            reviews: { user: { text: '好', rating: 5, at: day(2026, 5, 2) } },
            notes: [{ id: 'x', chapter: '', quote: 'q', at: day(2026, 4, 1), source: 'reeden' }],
        };
        const b: BookroomRecord = { ...emptyRecord('b'), title: '乙', segCount: 10, history: [{ segIdx: 9, via: 'chapter', at: day(2026, 2, 1) }] };
        const old: BookroomRecord = { ...emptyRecord('c'), title: '丙', segCount: 10, history: [{ segIdx: 9, via: 'chapter', at: day(2025, 12, 1) }] };
        const reading: BookroomRecord = { ...emptyRecord('d'), title: '丁', segCount: 10, history: [{ segIdx: 2, via: 'chapter', at: day(2026, 6, 1) }] };
        const s = yearSummary([a, b, old, reading], emptyMeta(), 2026);
        expect(s.finished.map(f => [f.title, f.rating])).toEqual([['乙', undefined], ['甲', 5]]);
        expect(s.touched).toBe(3);
        expect(s.reports).toBe(4);
        expect(s.notes).toBe(1);
        expect(s.companions).toEqual({ c1: 1 });
    });
});

describe('解析角色输出', () => {
    it('书评：取出评分行', () => {
        expect(parseRatedReview('评分：4/5\n写得很克制。')).toEqual({ rating: 4, text: '写得很克制。' });
        expect(parseRatedReview('评分: 5 星\n好')).toEqual({ rating: 5, text: '好' });
        expect(parseRatedReview('没打分的书评')).toEqual({ text: '没打分的书评' });
    });

    it('荐书：按格式解析；只给了书名号也能认', () => {
        expect(parseRecommendation('书名：《长夜难明》\n作者：紫金陈\n理由：你会喜欢\n这种克制。')).toEqual({ title: '长夜难明', author: '紫金陈', reason: '你会喜欢\n这种克制。' });
        expect(parseRecommendation('我想推荐《小王子》，因为……')).toEqual({ title: '小王子', reason: '我想推荐《小王子》，因为……' });
        expect(parseRecommendation('随便看看吧')).toBeNull();
    });
});

describe('读书提醒', () => {
    it('三天以上没报进度：标出天数，并允许角色轻轻问一句', () => {
        const now = day(2026, 9, 27);
        const rec: BookroomRecord = { ...emptyRecord('n1'), title: '雨', segCount: 20, companionIds: ['c1'], progress: { segIdx: 3, via: 'chapter', at: now - 4 * 86400000 } };
        const note = buildReadingTogetherNote('千夜', pickReadingTogether({ id: 'c1' }, [rec], now));
        expect(note).toContain('千夜已经 4 天没说读到哪了');
        expect(note).toContain('只问一次，不催');
        const fresh = buildReadingTogetherNote('千夜', pickReadingTogether({ id: 'c1' }, [{ ...rec, progress: { ...rec.progress!, at: now - 3600000 } }], now));
        expect(fresh).not.toContain('没说读到哪了');
        expect(fresh).not.toContain('不催');
    });
});
