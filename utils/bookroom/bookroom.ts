/**
 * 「书房」纯逻辑 —— 识别目录、按一句原文找位置、进度与归档记录。
 *
 * 用户在 Reeden 里读，回来手动报进度；书与角色书签沿用彼方书库（vr_novels），
 * 书房自己的记录存在 vr_settings 的 `bookroom-book-<novelId>` 里（全量备份已覆盖该表）。
 */
import type { VRNovelAnnotation, VRNovelSegment, VRWorldNovel } from '../../types';
import type { BookNote } from './reedenNotes';

export const BOOKROOM_RECORD_PREFIX = 'bookroom-book-';
export const bookroomRecordId = (novelId: string) => `${BOOKROOM_RECORD_PREFIX}${novelId}`;

export interface BookChapter {
    title: string;
    /** 章节标题所在的段落块 */
    segIdx: number;
}

export interface BookPosition {
    segIdx: number;
    /** 报进度的方式 */
    via: 'chapter' | 'sentence';
    /** via=sentence 时用户粘贴的原句（截短保存） */
    sentence?: string;
}

export interface BookProgressEntry extends BookPosition {
    at: number;
    /** 这次一起写的感想 */
    thought?: string;
}

/** 正文被删掉、只留记录的书。 */
export interface BookArchive {
    at: number;
    title: string;
    author?: string;
    totalChars: number;
    segCount: number;
    /** 角色批注 id → 被批注那段的开头原文，正文删了也能看出批在哪 */
    annotationQuotes: Record<string, string>;
}

export interface BookroomRecord {
    id: string;
    novelId: string;
    /** 一起读这本书的角色：报进度时默认告诉他们 */
    companionIds: string[];
    progress?: BookProgressEntry;
    history: BookProgressEntry[];
    /** 缓存的目录（正文删掉后仍能显示；EPUB 导入时来自书自带的目录） */
    chapters?: BookChapter[];
    /** 封面：压缩过的小图 data URL（直接存在记录里，备份时跟着 vr_settings 一起走） */
    cover?: string;
    /** 书名 / 段落块总数的冗余：聊天时生成「一起读的书」提醒要用，不必为此把整本正文读出来 */
    title?: string;
    segCount?: number;
    /** 从 Reeden 导入或手动记下的划线笔记 */
    notes?: BookNote[];
    archived?: BookArchive;
    updatedAt: number;
}

export function emptyRecord(novelId: string): BookroomRecord {
    return { id: bookroomRecordId(novelId), novelId, companionIds: [], history: [], updatedAt: Date.now() };
}

// ---------- 目录 ----------

const CN_NUM = '零〇一二两三四五六七八九十百千万0-9０-９';
const HEADING_PATTERNS: RegExp[] = [
    new RegExp(`^第[${CN_NUM}]+[章节回卷部集幕话篇]`),
    /^(序章|序言|序|楔子|引子|引言|前言|尾声|终章|后记|番外|外传|完结感言)(\s|$|[:：·\-—【（(])/,
    /^(chapter|part|prologue|epilogue)\b/i,
    // Sully 剧情记录导出：「[2026-09-20 01:50:54] 剧场正文」
    /^\[\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?\]/,
];

/** 一行像不像章节标题：够短、命中常见格式、不以句末标点结尾。 */
export function isChapterHeading(line: string): boolean {
    const s = line.trim();
    if (!s || s.length > 40) return false;
    if (/[。！？!?…」”]$/.test(s) && !/^\[\d{4}/.test(s)) return false;
    return HEADING_PATTERNS.some(re => re.test(s));
}

/** 从段落块里认出目录。认不出（没有章节标题）时返回空数组，界面改用「按位置」分段。 */
export function detectChapters(segments: VRNovelSegment[]): BookChapter[] {
    const out: BookChapter[] = [];
    for (const seg of segments) {
        for (const line of seg.text.split('\n')) {
            if (isChapterHeading(line)) out.push({ title: line.trim(), segIdx: seg.idx });
        }
    }
    return out;
}

/** 认不出目录时的兜底：每 5% 一格，至少 1 格。 */
export function fallbackSections(segCount: number, parts = 20): BookChapter[] {
    if (segCount <= 0) return [];
    const n = Math.min(parts, segCount);
    return Array.from({ length: n }, (_, i) => {
        const segIdx = Math.floor((i * segCount) / n);
        return { title: `第 ${i + 1} 部分（约 ${Math.round((segIdx / segCount) * 100)}%）`, segIdx };
    });
}

/** 某个位置落在哪一章（目录为空返回 -1）。 */
export function chapterIndexAt(chapters: BookChapter[], segIdx: number): number {
    let found = -1;
    for (let i = 0; i < chapters.length; i++) {
        if (chapters[i].segIdx <= segIdx) found = i; else break;
    }
    return found;
}

// ---------- 按一句原文找位置 ----------

const PUNCT_FOLD: Record<string, string> = {
    '“': '"', '”': '"', '「': '"', '」': '"', '『': '"', '』': '"', "'": '"',
    '‘': "'", '’': "'", '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '…': '...',
};

/** 逐字归一化，同时记下每个归一化字符来自原文第几个字 —— 找到后才能在原文里标出位置。 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
    let norm = '';
    const map: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch)) continue;
        const folded = (PUNCT_FOLD[ch] ?? ch).toLowerCase();
        norm += folded;
        for (let k = 0; k < folded.length; k++) map.push(i);
    }
    return { norm, map };
}

/** 去掉空白与常见标点差异，粘贴来的句子和原文才对得上。 */
export function normalizeForMatch(s: string): string {
    return normalizeWithMap(s).norm;
}

/**
 * EPUB 自带目录 → 段落块位置。每一章用「这章开头的一段原文」按顺序往后找，
 * 找不到的章节跳过（不会让目录乱序）。
 */
export function chaptersFromAnchors(segments: VRNovelSegment[], toc: { title: string; anchor: string }[]): BookChapter[] {
    const starts: number[] = [];
    let joined = '';
    for (const seg of segments) {
        starts.push(joined.length);
        joined += normalizeForMatch(seg.text);
    }
    const segAt = (pos: number) => {
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
        }
        return segments[lo]?.idx ?? 0;
    };
    const out: BookChapter[] = [];
    let from = 0;
    for (const entry of toc) {
        const key = normalizeForMatch(entry.anchor).slice(0, 24);
        if (key.length < 2) continue;
        const hit = joined.indexOf(key, from);
        if (hit < 0) continue;
        out.push({ title: entry.title, segIdx: segAt(hit) });
        from = hit;
    }
    return out;
}

export interface SentenceMatch {
    segIdx: number;
    /** 命中处前后的原文片段，给用户确认用 */
    context: string;
    /** 是整句命中，还是只对上了开头/结尾一截 */
    exact: boolean;
}

const MAX_MATCHES = 8;

/** 找出命中位置；每命中一次就跳到下一个段落块，保证候选落在不同段落。 */
function findAll(haystack: string, needle: string, nextFrom: (hit: number) => number): number[] {
    const hits: number[] = [];
    if (!needle) return hits;
    let from = 0;
    while (hits.length < MAX_MATCHES) {
        const i = haystack.indexOf(needle, from);
        if (i < 0) break;
        hits.push(i);
        from = Math.max(i + needle.length, nextFrom(i));
    }
    return hits;
}

/**
 * 在整本书里找用户粘贴的那句话。先整句找；找不到再用开头、结尾各一截找
 * （Reeden 复制时可能多带或少带几个字）。句子太短（< 6 字）不找，命中太多没意义。
 */
export function locateSentence(segments: VRNovelSegment[], sentence: string): SentenceMatch[] {
    const needle = normalizeForMatch(sentence);
    if (needle.length < 6) return [];
    // 拼成一整串，同时记下每个字属于哪个段落块
    const starts: number[] = [];
    const rawAt: number[] = [];
    let joined = '';
    for (const seg of segments) {
        starts.push(joined.length);
        const { norm, map } = normalizeWithMap(seg.text);
        joined += norm;
        rawAt.push(...map);
    }
    const posAt = (pos: number) => {
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
        }
        return lo;
    };
    const segAt = (pos: number) => segments[posAt(pos)]?.idx ?? 0;
    const nextSegStart = (pos: number) => starts[posAt(pos) + 1] ?? joined.length;
    const build = (positions: number[], exact: boolean): SentenceMatch[] => {
        const seen = new Set<number>();
        const out: SentenceMatch[] = [];
        for (const p of positions) {
            const segIdx = segAt(p);
            if (seen.has(segIdx)) continue;
            seen.add(segIdx);
            const seg = segments.find(s => s.idx === segIdx);
            out.push({ segIdx, context: excerptAround(seg?.text || '', rawAt[p] ?? 0), exact });
        }
        return out;
    };
    const full = findAll(joined, needle, nextSegStart);
    if (full.length) return build(full, true);
    const piece = Math.min(16, Math.floor(needle.length / 2));
    if (piece < 6) return [];
    const head = findAll(joined, needle.slice(0, piece), nextSegStart);
    const tail = findAll(joined, needle.slice(-piece), nextSegStart);
    return build([...head, ...tail].sort((a, b) => a - b), false);
}

/** 命中处前 20 字到后 60 字的原文。 */
function excerptAround(text: string, at: number): string {
    const start = Math.max(0, at - 20);
    const s = text.slice(start, start + 80).replace(/\s+/g, ' ');
    return (start > 0 ? '…' : '') + s + (start + 80 < text.length ? '…' : '');
}

// ---------- 进度 ----------

export function progressRatio(segIdx: number, segCount: number): number {
    if (segCount <= 0) return 0;
    return Math.max(0, Math.min(1, segIdx / Math.max(1, segCount - 1)));
}

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** 章节标题进聊天时只截长度。 */
const shortTitle = (t: string) => (t.length > 24 ? `${t.slice(0, 24)}…` : t);

/**
 * 进度报告写进聊天的那条消息正文 —— 角色上下文和记忆宫殿读的都是它。
 * 用第一人称（是用户在告诉角色），不写「系统」口吻。
 */
export function buildProgressMessage(input: {
    bookTitle: string;
    chapterTitle?: string;
    ratio: number;
    finished: boolean;
    thought?: string;
    sentence?: string;
}): string {
    const where = input.finished
        ? `读完了《${input.bookTitle}》`
        : `《${input.bookTitle}》读到了${input.chapterTitle ? `「${shortTitle(input.chapterTitle)}」` : ''}（全书约 ${formatPercent(input.ratio)}）`;
    const lines = [`【书房 · 读书进度】我${where}`];
    if (input.sentence) lines.push(`停在这句：「${input.sentence.length > 60 ? `${input.sentence.slice(0, 60)}…` : input.sentence}」`);
    if (input.thought?.trim()) lines.push(`感想：${input.thought.trim()}`);
    return lines.join('\n');
}

export function applyProgress(record: BookroomRecord, entry: BookProgressEntry): BookroomRecord {
    return { ...record, progress: entry, history: [...record.history, entry].slice(-200), updatedAt: entry.at };
}

// ---------- 归档 ----------

/** 归档前要提醒的事：谁还没读完。 */
export function unfinishedReaders(
    novel: Pick<VRWorldNovel, 'id' | 'segments'>,
    record: BookroomRecord | undefined,
    characters: { id: string; name: string; vrState?: { novelBookmarks?: Record<string, number> } }[],
): string[] {
    const total = novel.segments.length;
    const names: string[] = [];
    const userAt = record?.progress?.segIdx;
    if (userAt != null && userAt < total - 1) names.push('你');
    for (const c of characters) {
        const bm = c.vrState?.novelBookmarks?.[novel.id];
        if (bm != null && bm > 0 && bm < total) names.push(c.name);
    }
    return names;
}

export function buildArchive(novel: VRWorldNovel, annotations: VRNovelAnnotation[]): BookArchive {
    const quotes: Record<string, string> = {};
    for (const a of annotations) {
        const text = novel.segments[a.segIdx]?.text || '';
        quotes[a.id] = text.slice(0, 60).replace(/\s+/g, ' ');
    }
    return {
        at: Date.now(),
        title: novel.title,
        author: novel.author,
        totalChars: novel.totalChars,
        segCount: novel.segments.length,
        annotationQuotes: quotes,
    };
}

/** 重新导入同名书时找回旧记录，好沿用原来的书 id（角色书签、批注都挂在它上面）。 */
export function findArchivedByTitle(records: BookroomRecord[], title: string): BookroomRecord | undefined {
    const t = title.trim();
    return records.find(r => r.archived && r.archived.title.trim() === t);
}

// ---------- 一起读：聊天时的防剧透提醒 ----------

export interface ReadingTogetherBook {
    title: string;
    /** 用户读到的段落块 */
    userSeg: number;
    userChapter?: string;
    /** 没有章节名时用百分比描述位置 */
    userPercent?: number;
    userFinished: boolean;
    /** 角色在彼方读到的段落块（书签 = 下一次从哪读）；没读过为 undefined */
    charSeg?: number;
    charChapter?: string;
    charPercent?: number;
    charFinished: boolean;
}

/**
 * 给角色看的「你们在一起读的书」—— 进聊天请求的易变尾段。
 * 核心是防剧透：角色读得比用户靠前时，只能聊用户读过的部分；没读到的不许编。
 */
export function buildReadingTogetherNote(userName: string, books: ReadingTogetherBook[]): string {
    if (!books.length) return '';
    const where = (chapter: string | undefined, percent?: number) => (chapter ? `「${chapter}」` : percent != null ? `全书约 ${percent}% 处` : '书里某处');
    const lines = books.map(b => {
        const user = b.userFinished ? `${userName}已经读完了` : `${userName}读到${where(b.userChapter, b.userPercent)}`;
        let me: string;
        if (b.charSeg == null) me = '你还没读过这本，只知道' + userName + '跟你讲过的部分';
        else if (b.charFinished) me = '你在《彼方》里已经读完了';
        else me = `你在《彼方》里读到${where(b.charChapter, b.charPercent)}`;
        const ahead = b.charSeg != null && !b.userFinished && (b.charFinished || b.charSeg - 1 > b.userSeg);
        const behind = b.charSeg != null && !b.charFinished && (b.userFinished || b.charSeg - 1 < b.userSeg);
        const tail = ahead ? `，比${userName}靠前` : behind ? `，比${userName}靠后` : '';
        return `- 《${b.title}》：${user}；${me}${tail}。`;
    });
    return [
        '',
        '【你们在一起读的书】',
        ...lines,
        `聊到这些书时：只谈${userName}已经读过的部分。你读得比${userName}靠前的，后面的情节、人物命运、结局一个字都不能透露，最多卖个关子（比如「后面有段你一定会喜欢」）；`
        + `你没读到或没读过的部分，你并不知道内容，不要编造情节，可以问${userName}、听${userName}讲。没聊到书时不必主动提。`,
        '',
    ].join('\n');
}
