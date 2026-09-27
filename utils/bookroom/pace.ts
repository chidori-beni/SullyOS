/**
 * 角色在彼方的读书节奏。
 *
 * A. 陪读节奏：角色被设为某本书「一起读的人」、而用户在书房报过进度（且还没读完）时，
 *    ta 在这本书上最多读到「用户当前那一章的结尾」，追上了就先不读这本，等用户报新进度。
 * B. 每次读多少：每个角色可选 细读 / 正常 / 快读。以前固定 4 万字一次，一天能读完一本。
 */
import type { CharacterProfile, VRWorldCharState, VRWorldNovel } from '../../types';
import type { ReadingWindow } from '../vrWorld/novel';
import { chapterIndexAt, type BookroomRecord } from './bookroom';

export type ReadingPace = NonNullable<VRWorldCharState['readingPace']>;

export const READING_PACE_CHARS: Record<ReadingPace, number> = { slow: 5000, normal: 15000, fast: 40000 };
export const READING_PACE_LABEL: Record<ReadingPace, string> = { slow: '细读', normal: '正常', fast: '快读' };
export const DEFAULT_READING_PACE: ReadingPace = 'normal';

export const readingPaceOf = (char: Pick<CharacterProfile, 'vrState'>): ReadingPace =>
    char.vrState?.readingPace ?? DEFAULT_READING_PACE;

/** 没有目录时，最多比用户多读这么多个段落块（约 4000 字） */
const NO_CHAPTER_LEAD = 10;

/**
 * 这本书角色最多能读到哪（书签上限，不含）。不受限时返回 undefined。
 */
export function companionCap(record: BookroomRecord, charId: string): number | undefined {
    if (!record.companionIds.includes(charId) || !record.progress) return undefined;
    const total = record.segCount;
    const userSeg = record.progress.segIdx;
    if (total != null && userSeg >= total - 1) return undefined; // 用户读完了，不再拦
    const chapters = record.chapters || [];
    const ci = chapterIndexAt(chapters, userSeg);
    const nextStart = ci >= 0 ? chapters[ci + 1]?.segIdx : chapters.find(c => c.segIdx > userSeg)?.segIdx;
    const cap = nextStart ?? (chapters.length ? total : undefined) ?? userSeg + NO_CHAPTER_LEAD;
    return Math.max(userSeg + 1, cap);
}

export function buildPaceCaps(records: BookroomRecord[], charId: string): Map<string, number> {
    const caps = new Map<string, number>();
    for (const r of records) {
        const cap = companionCap(r, charId);
        if (cap != null) caps.set(r.novelId, cap);
    }
    return caps;
}

/** 已经追上用户的陪读书，这一轮不给 ta 读（从候选里拿掉）。 */
export function withoutCaughtUp(novels: VRWorldNovel[], char: Pick<CharacterProfile, 'vrState'>, caps: Map<string, number>): VRWorldNovel[] {
    const bookmarks = char.vrState?.novelBookmarks || {};
    return novels.filter(n => {
        const cap = caps.get(n.id);
        if (cap == null) return true;
        const bm = bookmarks[n.id] ?? 0;
        // 读完整本后会从头重读；陪读中的书不走这条（读完的前提是用户也读完，那时已经不设上限）
        return bm < Math.min(cap, n.segments.length);
    });
}

/** 把这一轮的阅读窗口截到上限以内。 */
export function clampWindow(win: ReadingWindow, cap: number | undefined): ReadingWindow {
    if (cap == null || win.to <= cap) return win;
    const to = Math.max(win.from + 1, cap);
    return { ...win, to, segments: win.segments.slice(0, to - win.from), reachedEnd: false };
}
