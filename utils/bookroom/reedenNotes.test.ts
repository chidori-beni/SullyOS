import { describe, expect, it } from 'vitest';
import { chunkNovelText } from '../vrWorld/novel';
import { buildReadingTogetherNote, detectChapters, emptyRecord, type BookroomRecord } from './bookroom';
import { mergeNotes, parseCsv, parseReedenNotes, placeNotes, suggestProgressFromNotes, titleFromCsvName } from './reedenNotes';
import { pickReadingTogether } from './readingTogether';

// 用户 2026-09-26 给的真实导出样本（原文截短）
const SAMPLE = '﻿章节名称,笔记内容,备注,创建时间,笔记类型,高亮颜色,笔记标签,回跳链接,章节索引,时间戳\n'
    + '[2026-09-20 01:50:54] 剧场正文,"你没有再回答他。甚至连继续侧过头去打量他那副狼狈模样的念头都被疲惫一并碾碎。",测试,2026年9月26日 19:50,underline,#3b82f6,,reeden://open_note?noteId=01a0dd56-9aa5-7d95-b189-337f84d8b063,11,1790419835000\n';

describe('Reeden CSV', () => {
    it('解析引号、逗号、换行和 "" 转义', () => {
        expect(parseCsv('a,"b,c","d\n e","f ""g"""\r\n1,2,3,4\n')).toEqual([['a', 'b,c', 'd\n e', 'f "g"'], ['1', '2', '3', '4']]);
    });

    it('读出真实样本的每一列', () => {
        const [n] = parseReedenNotes(SAMPLE);
        expect(n).toMatchObject({
            id: '01a0dd56-9aa5-7d95-b189-337f84d8b063',
            chapter: '[2026-09-20 01:50:54] 剧场正文',
            note: '测试',
            type: 'underline',
            color: '#3b82f6',
            link: 'reeden://open_note?noteId=01a0dd56-9aa5-7d95-b189-337f84d8b063',
            at: 1790419835000,
            source: 'reeden',
        });
        expect(n.quote.startsWith('你没有再回答他。')).toBe(true);
        expect(n.tags).toBeUndefined();
    });

    it('不是 Reeden 的文件给出看得懂的错误', () => {
        expect(() => parseReedenNotes('a,b\n1,2')).toThrow(/笔记内容/);
        expect(() => parseReedenNotes('')).toThrow(/空/);
    });

    it('从文件名取书名', () => {
        expect(titleFromCsvName('受伤_剧情记录_2026-09-24_笔记.csv')).toBe('受伤_剧情记录_2026-09-24');
    });
});

const filler = '他站在窗边看雨，想了很久也没有说话。'.repeat(25);
const raw = ['第一章 重逢', filler, '她说：“你回来了。”', filler, '第二章 旧信', filler, '她说：“你回来了。”', filler].join('\n');
const segments = chunkNovelText(raw);
const chapters = detectChapters(segments);

describe('笔记定位与合并', () => {
    it('原文出现多处时，挑落在同名章节里的那处；对不上的留空', () => {
        const base = { source: 'reeden' as const, at: 1 };
        const [a, b, c] = placeNotes(segments, chapters, [
            { ...base, id: 'a', chapter: '第二章 旧信', quote: '她说：“你回来了。”' },
            { ...base, id: 'b', chapter: '第一章 重逢', quote: '她说：“你回来了。”' },
            { ...base, id: 'c', chapter: '', quote: '这句书里根本没有出现过' },
        ]);
        expect(a.segIdx).toBeGreaterThanOrEqual(chapters[1].segIdx);
        expect(b.segIdx).toBeLessThan(chapters[1].segIdx);
        expect(c.segIdx).toBeUndefined();
    });

    it('重复导入不重复，保留角色已写的回应', () => {
        const old = [{ id: 'x', chapter: '', quote: '旧', at: 1, source: 'reeden' as const, replies: [{ charId: 'c', charName: '萧逸', content: '嗯', at: 2 }] }];
        const { notes, added, updated } = mergeNotes(old, [
            { id: 'x', chapter: '', quote: '旧', note: '补了想法', at: 1, source: 'reeden' },
            { id: 'y', chapter: '', quote: '新', at: 3, source: 'reeden' },
        ]);
        expect([added, updated]).toEqual([1, 1]);
        expect(notes.find(n => n.id === 'x')).toMatchObject({ note: '补了想法', replies: [{ content: '嗯' }] });
    });

    it('建议进度：最新一条、且比当前靠后才提', () => {
        const notes = [
            { id: 'a', chapter: '', quote: '', at: 1, segIdx: 9, source: 'reeden' as const },
            { id: 'b', chapter: '', quote: '', at: 5, segIdx: 6, source: 'reeden' as const },
            { id: 'c', chapter: '', quote: '', at: 9, source: 'reeden' as const },
        ];
        expect(suggestProgressFromNotes(notes, 2)?.id).toBe('b');
        expect(suggestProgressFromNotes(notes, 7)).toBeUndefined();
        expect(suggestProgressFromNotes(notes, undefined)?.id).toBe('b');
    });
});

describe('一起读：防剧透提醒', () => {
    const now = 1_800_000_000_000;
    const rec = (over: Partial<BookroomRecord>): BookroomRecord => ({
        ...emptyRecord('n1'), title: '雨', segCount: 20,
        chapters: [{ title: '第一章', segIdx: 0 }, { title: '第二章', segIdx: 10 }],
        progress: { segIdx: 3, via: 'chapter', at: now - 1000 }, ...over,
    });

    it('角色读得靠前：写明双方位置，并要求不剧透', () => {
        const books = pickReadingTogether({ id: 'c1', vrState: { enabled: true, intervalMinutes: 120, novelBookmarks: { n1: 15 } } }, [rec({})], now);
        expect(books).toEqual([expect.objectContaining({ title: '雨', userChapter: '第一章', charChapter: '第二章', charFinished: false })]);
        const note = buildReadingTogetherNote('千夜', books);
        expect(note).toContain('千夜读到「第一章」');
        expect(note).toContain('你在《彼方》里读到「第二章」，比千夜靠前');
        expect(note).toContain('一个字都不能透露');
    });

    it('一起读的人里有 ta、但 ta 没在彼方读过：说明没读过、别编', () => {
        const books = pickReadingTogether({ id: 'c1' }, [rec({ companionIds: ['c1'] })], now);
        expect(buildReadingTogetherNote('千夜', books)).toContain('你还没读过这本');
    });

    it('无关的书、太久没动的书、没报过进度的书都不提', () => {
        expect(pickReadingTogether({ id: 'c1' }, [rec({})], now)).toEqual([]);
        expect(pickReadingTogether({ id: 'c1' }, [rec({ companionIds: ['c1'], progress: { segIdx: 1, via: 'chapter', at: now - 90 * 86400000 } })], now)).toEqual([]);
        expect(pickReadingTogether({ id: 'c1' }, [rec({ companionIds: ['c1'], progress: undefined })], now)).toEqual([]);
        expect(buildReadingTogetherNote('千夜', [])).toBe('');
    });

    it('没有章节名时用百分比说位置', () => {
        const books = pickReadingTogether({ id: 'c1', vrState: { enabled: true, intervalMinutes: 120, novelBookmarks: { n1: 15 } } }, [rec({ chapters: undefined })], now);
        const note = buildReadingTogetherNote('千夜', books);
        expect(note).toContain('千夜读到全书约 15% 处');
        expect(note).toContain('你在《彼方》里读到全书约 75% 处');
    });
});
