/**
 * Reeden 笔记导出（CSV）→ 书房笔记。
 *
 * 列：章节名称,笔记内容,备注,创建时间,笔记类型,高亮颜色,笔记标签,回跳链接,章节索引,时间戳
 * 「笔记内容」是划线的原文，「备注」是用户写的想法，「回跳链接」形如 reeden://open_note?noteId=…
 */
import type { VRNovelSegment } from '../../types';
import { chapterIndexAt, locateSentence, type BookChapter, type BookroomWaiting } from './bookroom';

export interface CharNoteReply {
    charId: string;
    charName: string;
    content: string;
    at: number;
}

export interface BookNote {
    /** Reeden 的 noteId；没有时用时间戳+原文生成 */
    id: string;
    chapter: string;
    quote: string;
    /** 用户写的想法 */
    note?: string;
    type?: string;
    color?: string;
    tags?: string;
    /** reeden://open_note?noteId=… */
    link?: string;
    /** 创建时间（毫秒） */
    at: number;
    /** 在书里对到的段落块；对不上时为 undefined */
    segIdx?: number;
    source: 'reeden' | 'manual';
    replies?: CharNoteReply[];
    /** 给了角色看、ta 在忙还没回的 */
    waiting?: BookroomWaiting[];
}

export class ReedenCsvError extends Error {}

/** RFC 4180 CSV：支持引号里的逗号、换行和 "" 转义。 */
export function parseCsv(text: string): string[][] {
    const src = text.replace(/^﻿/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else field += ch;
            continue;
        }
        if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(c => c.trim())) rows.push(row);
            row = [];
        } else field += ch;
    }
    row.push(field);
    if (row.some(c => c.trim())) rows.push(row);
    return rows;
}

const COLS = {
    chapter: ['章节名称', '章节'],
    quote: ['笔记内容', '内容', '原文'],
    note: ['备注', '想法', '批注'],
    createdText: ['创建时间'],
    type: ['笔记类型', '类型'],
    color: ['高亮颜色', '颜色'],
    tags: ['笔记标签', '标签'],
    link: ['回跳链接', '链接'],
    ts: ['时间戳'],
} as const;

const hashId = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `n${(h >>> 0).toString(36)}`;
};

export function parseReedenNotes(csvText: string): BookNote[] {
    const rows = parseCsv(csvText);
    if (rows.length < 1) throw new ReedenCsvError('这个文件是空的');
    const header = rows[0].map(h => h.trim());
    const col = (names: readonly string[]) => header.findIndex(h => names.includes(h));
    const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, col(names)])) as Record<keyof typeof COLS, number>;
    if (idx.quote < 0) throw new ReedenCsvError('看起来不是 Reeden 导出的笔记（找不到「笔记内容」这一列）');
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const out: BookNote[] = [];
    for (const r of rows.slice(1)) {
        const quote = get(r, idx.quote);
        if (!quote) continue;
        const link = get(r, idx.link) || undefined;
        const ts = Number(get(r, idx.ts));
        const at = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
        const noteId = link?.match(/noteId=([^&\s]+)/)?.[1];
        out.push({
            id: noteId || hashId(`${at}|${quote}`),
            chapter: get(r, idx.chapter),
            quote,
            note: get(r, idx.note) || undefined,
            type: get(r, idx.type) || undefined,
            color: /^#[0-9a-f]{3,8}$/i.test(get(r, idx.color)) ? get(r, idx.color) : undefined,
            tags: get(r, idx.tags) || undefined,
            link,
            at,
            source: 'reeden',
        });
    }
    return out;
}

/** 文件名「书名_笔记.csv」里的书名（Reeden 的导出命名）。 */
export function titleFromCsvName(name: string): string {
    return name.replace(/\.csv$/i, '').replace(/_笔记$/, '').trim();
}

/**
 * 给每条笔记在书里找位置：用原文找；找到多处时，挑落在同名章节里的那处。
 */
export function placeNotes(segments: VRNovelSegment[], chapters: BookChapter[], notes: BookNote[]): BookNote[] {
    return notes.map(n => {
        const hits = locateSentence(segments, n.quote);
        if (!hits.length) return { ...n, segIdx: undefined };
        const inChapter = n.chapter
            ? hits.find(h => chapters[chapterIndexAt(chapters, h.segIdx)]?.title.trim() === n.chapter.trim())
            : undefined;
        return { ...n, segIdx: (inChapter || hits[0]).segIdx };
    });
}

/** 合并：同一条笔记（同 id）以新导入的内容为准，但保留角色已经写的回应。 */
/** 判断「是不是同一句」用：去掉空白和常见标点、统一大小写 */
export const quoteKey = (quote: string) =>
    quote.normalize('NFKC').toLowerCase().replace(/[\s\u3000"'“”‘’「」『』《》〈〉（）()\[\]【】,，.。!！?？;；:：、…—\-~～·]/g, '');

const mergeText = (a?: string, b?: string) => {
    const x = a?.trim(), y = b?.trim();
    if (!x) return y || undefined;
    if (!y || x === y || x.includes(y)) return x;
    if (y.includes(x)) return y;
    return `${x}\n${y}`;
};

/** 两条其实是同一句：合成一条。Reeden 的信息（id、链接、颜色）优先；角色回复、等回复、想法都并起来。 */
function combineNotes(prev: BookNote, next: BookNote, sameId: boolean): BookNote {
    const reeden = next.source === 'reeden' ? next : prev.source === 'reeden' ? prev : prev;
    const other = reeden === prev ? next : prev;
    const replies = [...(prev.replies || []), ...(next.replies || [])]
        .filter((r, i, all) => all.findIndex(x => x.charId === r.charId && x.content === r.content) === i)
        .sort((x, y) => x.at - y.at);
    const waiting = [...(prev.waiting || []), ...(next.waiting || [])]
        .filter((w, i, all) => all.findIndex(x => x.charId === w.charId) === i);
    return {
        ...other, ...reeden,
        // 保留原来那条的 id：等回复队列、页面上的展开状态都认它
        id: prev.id,
        // 同一条 Reeden 笔记再导一次 = 更新，想法以新的为准；不同的两条划了同一句，想法并起来
        note: sameId ? next.note : mergeText(prev.note, next.note),
        chapter: reeden.chapter || other.chapter,
        segIdx: reeden.segIdx ?? other.segIdx,
        at: Math.min(prev.at, next.at),
        replies: replies.length ? replies : undefined,
        waiting: waiting.length ? waiting : undefined,
    };
}

/**
 * 把新导入的笔记并进已有的。**同一句原文只留一条**（不管是 Reeden 里重复划的、同一份 CSV 导两次，
 * 还是先在书房手动「划一句给 ta 看」、后来又从 Reeden 导进来的）；已有列表里原本就重复的也顺手合掉。
 * added = 真正多出来的条数；updated = 合进已有那条的条数。
 */
export function mergeNotes(existing: BookNote[], incoming: BookNote[]): { notes: BookNote[]; added: number; updated: number } {
    const out: BookNote[] = [];
    const byKey = new Map<string, number>();
    const byId = new Map<string, number>();
    const put = (n: BookNote): 'added' | 'updated' => {
        const key = quoteKey(n.quote) || `id:${n.id}`;
        const sameId = byId.has(n.id);
        const at = byId.get(n.id) ?? byKey.get(key);
        if (at == null) {
            byId.set(n.id, out.length); byKey.set(key, out.length);
            out.push(n);
            return 'added';
        }
        out[at] = combineNotes(out[at], n, sameId);
        byId.set(n.id, at); byKey.set(key, at);
        return 'updated';
    };
    for (const n of existing) put(n);
    const before = out.length;
    let updated = 0;
    for (const n of incoming) if (put(n) === 'updated') updated++;
    return { notes: out.sort((a, b) => a.at - b.at), added: out.length - before, updated };
}

/** 导入后建议把进度挪到哪：最新一条对上了位置、且比当前进度靠后的笔记。 */
export function suggestProgressFromNotes(notes: BookNote[], currentSeg: number | undefined): BookNote | undefined {
    const placed = notes.filter(n => n.segIdx != null).sort((a, b) => b.at - a.at);
    const latest = placed[0];
    if (!latest) return undefined;
    return currentSeg == null || latest.segIdx! > currentSeg ? latest : undefined;
}
