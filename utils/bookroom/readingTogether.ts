/**
 * 聊天请求组装时调用：找出这个角色和用户「一起在读」的书，生成防剧透提醒。
 * 只读 vr_settings 里的书房记录（很小），不读整本正文。任何失败都返回空串，不影响聊天。
 */
import type { CharacterProfile } from '../../types';
import { buildReadingTogetherNote, chapterIndexAt, type BookroomRecord, type ReadingTogetherBook } from './bookroom';
import { listBookroomRecords } from './bookroomDb';

/** 多久没报进度就不再提（避免陈年旧书一直占着提示词） */
const STALE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_BOOKS = 3;

export function pickReadingTogether(char: Pick<CharacterProfile, 'id' | 'vrState'>, records: BookroomRecord[], now = Date.now()): ReadingTogetherBook[] {
    const bookmarks = char.vrState?.novelBookmarks || {};
    return records
        .filter(r => r.progress && r.title && now - r.progress.at < STALE_MS)
        .filter(r => r.companionIds.includes(char.id) || (bookmarks[r.novelId] ?? 0) > 0)
        .sort((a, b) => b.progress!.at - a.progress!.at)
        .slice(0, MAX_BOOKS)
        .map(r => {
            const chapters = r.chapters || [];
            const total = r.segCount ?? r.archived?.segCount;
            const userSeg = r.progress!.segIdx;
            const charBm = bookmarks[r.novelId];
            const charSeg = charBm != null && charBm > 0 ? charBm : undefined;
            const chapterAt = (seg: number) => chapters[chapterIndexAt(chapters, seg)]?.title;
            const pct = (seg: number) => (total ? Math.round((Math.min(seg, total) / total) * 100) : undefined);
            return {
                title: r.title!,
                userSeg,
                userChapter: chapterAt(userSeg),
                userPercent: pct(userSeg),
                userFinished: total != null && userSeg >= total - 1,
                charSeg,
                charChapter: charSeg != null ? chapterAt(Math.max(0, charSeg - 1)) : undefined,
                charPercent: charSeg != null ? pct(charSeg) : undefined,
                charFinished: charSeg != null && total != null && charSeg >= total,
            };
        });
}

export async function loadReadingTogetherBlock(char: CharacterProfile, userName: string): Promise<string> {
    try {
        const books = pickReadingTogether(char, await listBookroomRecords());
        return buildReadingTogetherNote(userName, books);
    } catch {
        return '';
    }
}
