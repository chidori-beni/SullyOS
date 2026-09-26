import { describe, expect, it } from 'vitest';
import { chunkNovelText } from '../vrWorld/novel';
import {
    applyProgress, buildArchive, buildProgressMessage, chapterIndexAt, detectChapters, emptyRecord,
    fallbackSections, findArchivedByTitle, isChapterHeading, locateSentence, progressRatio, unfinishedReaders,
} from './bookroom';
import type { VRWorldNovel } from '../../types';

const filler = (n: number) => '他站在窗边看雨，想了很久也没有说话。'.repeat(n);
const raw = [
    '序章 雨夜', filler(30),
    '第一章 重逢', filler(30), '她终于开口说：“你回来了。”', filler(30),
    '第二章 告别', filler(30),
    '尾声', filler(5),
].join('\n');
const segments = chunkNovelText(raw);
const novel: VRWorldNovel = { id: 'n1', title: '雨', segments, totalChars: raw.length, createdAt: 0, updatedAt: 0 };

describe('目录识别', () => {
    it('认出常见章节标题，不把正文句子当标题', () => {
        expect(isChapterHeading('第十二章 重逢')).toBe(true);
        expect(isChapterHeading('第12回')).toBe(true);
        expect(isChapterHeading('Chapter 3')).toBe(true);
        expect(isChapterHeading('番外：夏天')).toBe(true);
        expect(isChapterHeading('[2026-09-20 01:50:54] 剧场正文')).toBe(true);
        expect(isChapterHeading('第一章的时候他就说过这件事了。')).toBe(false);
        expect(isChapterHeading('他说：“序章而已。”')).toBe(false);
        expect(isChapterHeading('序列号')).toBe(false);
    });

    it('按顺序列出整本书的章节和所在段落', () => {
        const chapters = detectChapters(segments);
        expect(chapters.map(c => c.title)).toEqual(['序章 雨夜', '第一章 重逢', '第二章 告别', '尾声']);
        for (let i = 1; i < chapters.length; i++) expect(chapters[i].segIdx).toBeGreaterThanOrEqual(chapters[i - 1].segIdx);
        expect(chapterIndexAt(chapters, chapters[2].segIdx)).toBe(2);
        expect(chapterIndexAt([], 3)).toBe(-1);
    });

    it('认不出目录时按位置兜底', () => {
        expect(fallbackSections(0)).toEqual([]);
        expect(fallbackSections(3)).toHaveLength(3);
        expect(fallbackSections(100)).toHaveLength(20);
    });
});

describe('按一句原文找位置', () => {
    it('空格、引号写法不同也能对上', () => {
        const hits = locateSentence(segments, '她终于开口说: "你回来了。"');
        expect(hits).toHaveLength(1);
        expect(hits[0].exact).toBe(true);
        expect(segments[hits[0].segIdx].text).toContain('你回来了');
        // 预览片段要落在这句话附近，而不是段落开头
        expect(hits[0].context).toContain('她终于开口说：“你回来了。”');
    });

    it('多带了几个字时靠开头一截找到', () => {
        const hits = locateSentence(segments, '她终于开口说：“你回来了。”然后转身走进了雨里再也没回头');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].exact).toBe(false);
        expect(segments[hits[0].segIdx].text).toContain('你回来了');
    });

    it('太短或找不到返回空', () => {
        expect(locateSentence(segments, '你回来')).toEqual([]);
        expect(locateSentence(segments, '这句话书里根本没有出现过呢')).toEqual([]);
    });

    it('重复出现的句子给出多个候选，同一段只算一次', () => {
        const hits = locateSentence(segments, '他站在窗边看雨，想了很久也没有说话。');
        expect(hits.length).toBeGreaterThan(1);
        expect(new Set(hits.map(h => h.segIdx)).size).toBe(hits.length);
    });
});

describe('进度与归档', () => {
    it('进度消息用第一人称，读完时换说法', () => {
        const msg = buildProgressMessage({ bookTitle: '雨', chapterTitle: '第一章 重逢', ratio: 0.42, finished: false, thought: '好虐' });
        expect(msg).toContain('我《雨》读到了「第一章 重逢」（全书约 42%）');
        expect(msg).toContain('感想：好虐');
        expect(buildProgressMessage({ bookTitle: '雨', ratio: 1, finished: true })).toContain('我读完了《雨》');
        expect(progressRatio(0, 0)).toBe(0);
        expect(progressRatio(9, 10)).toBe(1);
    });

    it('记进度同时留历史', () => {
        let r = emptyRecord('n1');
        r = applyProgress(r, { segIdx: 3, via: 'chapter', at: 1 });
        r = applyProgress(r, { segIdx: 5, via: 'sentence', sentence: 'x', at: 2 });
        expect(r.progress?.segIdx).toBe(5);
        expect(r.history).toHaveLength(2);
    });

    it('归档前找出没读完的人', () => {
        const rec = applyProgress(emptyRecord('n1'), { segIdx: 1, via: 'chapter', at: 1 });
        const chars = [
            { id: 'a', name: '萧逸', vrState: { novelBookmarks: { n1: 2 } } },
            { id: 'b', name: '读完的', vrState: { novelBookmarks: { n1: segments.length } } },
            { id: 'c', name: '没翻过', vrState: {} },
        ];
        expect(unfinishedReaders(novel, rec, chars)).toEqual(['你', '萧逸']);
    });

    it('归档保留批注对应的原文开头，同名书能找回旧记录', () => {
        const archive = buildArchive(novel, [{ id: 'x', novelId: 'n1', segIdx: 0, authorId: 'a', authorName: '萧逸', content: '好', createdAt: 0 }]);
        expect(archive.annotationQuotes.x).toContain('序章');
        expect(archive.segCount).toBe(segments.length);
        const rec = { ...emptyRecord('n1'), archived: archive };
        expect(findArchivedByTitle([rec], ' 雨 ')?.novelId).toBe('n1');
        expect(findArchivedByTitle([emptyRecord('n2')], '雨')).toBeUndefined();
    });
});
