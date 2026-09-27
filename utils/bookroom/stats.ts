/**
 * 书房三期的纯逻辑：打卡、年度书单、书评评分解析、荐书解析。
 * 日期一律按用户手机本地时区算（打卡是「我这边的哪一天」）。
 */
import type { BookroomRecord } from './bookroom';

// ---------- 全局记录（vr_settings 里 id = bookroom-meta） ----------

export const BOOKROOM_META_ID = 'bookroom-meta';

export interface BookRecommendation {
    id: string;
    charId: string;
    charName: string;
    title: string;
    author?: string;
    reason: string;
    at: number;
    /** 用户标记：想读 / 已经读过 / 不感兴趣 */
    status?: 'want' | 'read' | 'pass';
}

export interface YearLetter {
    year: number;
    charId: string;
    charName: string;
    text: string;
    at: number;
}

export interface BookroomMeta {
    id: typeof BOOKROOM_META_ID;
    /** 手动「今天读了」的日子（YYYY-MM-DD） */
    checkins: string[];
    recommendations: BookRecommendation[];
    yearLetters: YearLetter[];
}

export const emptyMeta = (): BookroomMeta => ({ id: BOOKROOM_META_ID, checkins: [], recommendations: [], yearLetters: [] });

// ---------- 书评 ----------

export interface BookReview {
    text: string;
    /** 1~5 星 */
    rating?: number;
    at: number;
}

export interface CharBookReview extends BookReview {
    charId: string;
    charName: string;
}

// ---------- 打卡 ----------

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 读过书的日子：报过进度、导入/写过笔记、写过书评、手动打卡。 */
export function readingDays(records: BookroomRecord[], meta: BookroomMeta): Set<string> {
    const days = new Set(meta.checkins);
    for (const r of records) {
        for (const h of r.history) days.add(dateKey(h.at));
        if (r.reviews?.user) days.add(dateKey(r.reviews.user.at));
        for (const n of r.notes || []) if (n.source === 'manual') days.add(dateKey(n.at));
    }
    return days;
}

/** 连续打卡天数：今天读了就从今天往回数；今天还没读就从昨天往回数（今天还没结束，不算断）。 */
export function streakDays(days: Set<string>, now = Date.now()): number {
    const d = new Date(now);
    if (!days.has(dateKey(d.getTime()))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(dateKey(d.getTime()))) {
        n++;
        d.setDate(d.getDate() - 1);
    }
    return n;
}

/** 某月的日历格子：前面补空位让 1 号落在正确的星期（周一开头）。 */
export function monthGrid(year: number, month0: number): (number | null)[] {
    const first = new Date(year, month0, 1);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(year, month0 + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
}

// ---------- 年度书单 ----------

export interface FinishedBook {
    novelId: string;
    title: string;
    cover?: string;
    rating?: number;
    finishedAt: number;
}

export interface YearSummary {
    year: number;
    finished: FinishedBook[];
    /** 今年报过进度的书（含没读完的） */
    touched: number;
    reports: number;
    notes: number;
    days: number;
    /** 一起读的人：角色 id → 一起读过的书数 */
    companions: Record<string, number>;
}

const inYear = (ts: number, year: number) => new Date(ts).getFullYear() === year;

export function yearSummary(records: BookroomRecord[], meta: BookroomMeta, year: number): YearSummary {
    const finished: FinishedBook[] = [];
    let touched = 0, reports = 0, notes = 0;
    const companions: Record<string, number> = {};
    for (const r of records) {
        const total = r.segCount ?? r.archived?.segCount;
        const yearHistory = r.history.filter(h => inYear(h.at, year));
        reports += yearHistory.length;
        notes += (r.notes || []).filter(n => inYear(n.at, year)).length;
        if (yearHistory.length) {
            touched++;
            for (const id of r.companionIds) companions[id] = (companions[id] || 0) + 1;
        }
        const done = total != null ? yearHistory.find(h => h.segIdx >= total - 1) : undefined;
        if (done) {
            finished.push({ novelId: r.novelId, title: r.title || r.archived?.title || '无题', cover: r.cover, rating: r.reviews?.user?.rating, finishedAt: done.at });
        }
    }
    const days = [...readingDays(records, meta)].filter(k => k.startsWith(`${year}-`)).length;
    return { year, finished: finished.sort((a, b) => a.finishedAt - b.finishedAt), touched, reports, notes, days, companions };
}

// ---------- 解析角色的输出 ----------

/** 书评第一行「评分：4/5」→ 4；取出评分后把那行去掉。 */
export function parseRatedReview(raw: string): { rating?: number; text: string } {
    const m = raw.match(/^\s*(?:评分|打分|星级)\s*[:：]\s*([1-5])(?:\s*\/\s*5|\s*星|\s*分)?\s*$/m);
    if (!m) return { text: raw.trim() };
    return { rating: Number(m[1]), text: raw.replace(m[0], '').trim() };
}

/** 荐书格式：书名：《X》 / 作者：Y / 理由：…；缺了书名就当解析失败。 */
export function parseRecommendation(raw: string): { title: string; author?: string; reason: string } | null {
    const title = raw.match(/书名\s*[:：]\s*《?([^》\n]+)》?/)?.[1]?.trim();
    if (!title) {
        const bracket = raw.match(/《([^》\n]{1,40})》/)?.[1]?.trim();
        if (!bracket) return null;
        return { title: bracket, reason: raw.trim() };
    }
    const author = raw.match(/作者\s*[:：]\s*([^\n]+)/)?.[1]?.trim() || undefined;
    const reasonMatch = raw.match(/理由\s*[:：]\s*([\s\S]+)/);
    const reason = (reasonMatch ? reasonMatch[1] : raw.replace(/.*书名.*\n?|.*作者.*\n?/g, '')).trim();
    return { title, author, reason };
}
