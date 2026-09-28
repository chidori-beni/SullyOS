/**
 * 书房「等回复」队列：把划线 / 书评给角色看时，ta 正按日程忙或睡，就先不回（不敷衍、不发自动回复），
 * 在那条笔记 / 这本书的书评上记一笔 waiting。之后小手机开着的时候（components/BookroomPendingRunner 定时来叫），
 * 看 ta 有空了，就照正常流程发进私聊、认真回一篇，并挂回书房那条笔记 / 书评上。
 *
 * 队列就存在书房记录里（vr_settings），跟着备份走；手机没开着的时候不会生成（算不了）。
 */
import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import type { BookroomRecord, BookroomWaiting } from './bookroom';
import { getBookroomRecord, listBookroomRecords, saveBookroomRecord, type MemoryConfigLike } from './bookroomDb';
import { askCharacterAboutHighlight, askCharacterInBookroom, buildHighlightMessage, buildReviewMessage, checkCharBusy, REVIEW_INSTRUCTION } from './highlightReply';
import { parseRatedReview } from './stats';

/** 失败后隔多久再试 */
const RETRY_MS = 10 * 60 * 1000;

export interface PendingContext {
    characters: CharacterProfile[];
    userProfile: UserProfile;
    groups: GroupProfile[];
    apiConfig: APIConfig;
    realtimeConfig?: RealtimeConfig;
    memoryPalaceConfig?: MemoryConfigLike;
}

export interface PendingDone {
    charName: string;
    bookTitle: string;
    kind: 'highlight' | 'review';
}

// ---------- 记一笔 / 取消 ----------

const upsertWaiting = (list: BookroomWaiting[] | undefined, w: BookroomWaiting) => [...(list || []).filter(x => x.charId !== w.charId), w];

export function addNoteWaiting(record: BookroomRecord, noteId: string, w: BookroomWaiting): BookroomRecord {
    return {
        ...record, updatedAt: Date.now(),
        notes: (record.notes || []).map(n => n.id === noteId ? { ...n, waiting: upsertWaiting(n.waiting, w) } : n),
    };
}

export function addReviewWaiting(record: BookroomRecord, w: BookroomWaiting): BookroomRecord {
    return { ...record, updatedAt: Date.now(), reviews: { ...record.reviews, waiting: upsertWaiting(record.reviews?.waiting, w) } };
}

export function cancelNoteWaiting(record: BookroomRecord, noteId: string, charId: string): BookroomRecord {
    return {
        ...record, updatedAt: Date.now(),
        notes: (record.notes || []).map(n => n.id === noteId ? { ...n, waiting: (n.waiting || []).filter(w => w.charId !== charId) } : n),
    };
}

export function cancelReviewWaiting(record: BookroomRecord, charId: string): BookroomRecord {
    return { ...record, updatedAt: Date.now(), reviews: { ...record.reviews, waiting: (record.reviews?.waiting || []).filter(w => w.charId !== charId) } };
}

export const hasAnyWaiting = (records: BookroomRecord[]) =>
    records.some(r => (r.reviews?.waiting || []).length || (r.notes || []).some(n => (n.waiting || []).length));

// ---------- 补回 ----------

type Job =
    | { kind: 'highlight'; novelId: string; noteId: string; w: BookroomWaiting }
    | { kind: 'review'; novelId: string; w: BookroomWaiting };

function collectJobs(records: BookroomRecord[]): Job[] {
    const jobs: Job[] = [];
    for (const r of records) {
        for (const n of r.notes || []) for (const w of n.waiting || []) jobs.push({ kind: 'highlight', novelId: r.novelId, noteId: n.id, w });
        for (const w of r.reviews?.waiting || []) jobs.push({ kind: 'review', novelId: r.novelId, w });
    }
    return jobs.sort((a, b) => a.w.since - b.w.since);
}

/** 改记录前重新读一遍，别拿旧快照把用户刚改的东西盖掉 */
async function updateRecord(novelId: string, fn: (r: BookroomRecord) => BookroomRecord): Promise<void> {
    const fresh = await getBookroomRecord(novelId);
    if (fresh) await saveBookroomRecord(fn(fresh));
}

const dropJob = (job: Job) => updateRecord(job.novelId, r => job.kind === 'highlight'
    ? cancelNoteWaiting(r, job.noteId, job.w.charId)
    : cancelReviewWaiting(r, job.w.charId));

const markFailed = (job: Job, error: string, messageSent: boolean) => updateRecord(job.novelId, r => {
    const mark = (w: BookroomWaiting) => w.charId === job.w.charId
        ? { ...w, lastTryAt: Date.now(), lastError: error.slice(0, 200), messageSent: w.messageSent || messageSent }
        : w;
    return job.kind === 'highlight'
        ? { ...r, notes: (r.notes || []).map(n => n.id === job.noteId ? { ...n, waiting: (n.waiting || []).map(mark) } : n) }
        : { ...r, reviews: { ...r.reviews, waiting: (r.reviews?.waiting || []).map(mark) } };
});

/**
 * 看一遍队列：谁有空了就补回。返回这次补回了哪些（给界面弹提示用）。
 * 一次最多补 maxJobs 条，免得一口气连打好多次 API。
 */
export async function processPendingReplies(ctx: PendingContext, now = Date.now(), maxJobs = 3): Promise<PendingDone[]> {
    if (!ctx.apiConfig?.baseUrl || !ctx.characters.length) return [];
    const records = await listBookroomRecords();
    if (!hasAnyWaiting(records)) return [];
    const userName = ctx.userProfile?.name || '用户';
    const done: PendingDone[] = [];
    const busyCache = new Map<string, boolean>();

    for (const job of collectJobs(records)) {
        if (done.length >= maxJobs) break;
        if (job.w.lastTryAt && now - job.w.lastTryAt < RETRY_MS) continue;
        const char = ctx.characters.find(c => c.id === job.w.charId);
        if (!char) { await dropJob(job); continue; } // 角色删了，不等了
        if (!busyCache.has(char.id)) busyCache.set(char.id, !!(await checkCharBusy(char)));
        if (busyCache.get(char.id)) continue;

        const record = records.find(r => r.novelId === job.novelId)!;
        const bookTitle = record.title || record.archived?.title || '这本书';
        const base = { char, userProfile: ctx.userProfile, groups: ctx.groups, apiConfig: ctx.apiConfig, realtimeConfig: ctx.realtimeConfig, memoryPalaceConfig: ctx.memoryPalaceConfig };
        const deferred = { since: job.w.since, activity: job.w.activity };
        let sent = false;
        const once = { skipUserMessage: !!job.w.messageSent, onUserMessageSaved: () => { sent = true; } };
        try {
            if (job.kind === 'highlight') {
                const note = (record.notes || []).find(n => n.id === job.noteId);
                if (!note) { await dropJob(job); continue; }
                const reply = await askCharacterAboutHighlight({
                    ...base, ...once, novelId: job.novelId, bookTitle, deferred,
                    message: buildHighlightMessage({ bookTitle, chapter: note.chapter || undefined, quote: note.quote, comment: job.w.comment ?? note.note }),
                });
                const answer = { charId: char.id, charName: char.name, content: reply, at: Date.now() };
                await updateRecord(job.novelId, r => ({
                    ...r, updatedAt: Date.now(),
                    notes: (r.notes || []).map(n => n.id === job.noteId
                        ? { ...n, replies: [...(n.replies || []), answer], waiting: (n.waiting || []).filter(w => w.charId !== char.id) }
                        : n),
                }));
            } else {
                const mine = record.reviews?.user;
                if (!mine) { await dropJob(job); continue; } // 用户把自己的书评删了
                const bm = char.vrState?.novelBookmarks?.[job.novelId];
                const total = record.segCount ?? record.archived?.segCount ?? Infinity;
                const hasRead = bm != null && bm > 0;
                const reply = await askCharacterInBookroom({
                    ...base, ...once, novelId: job.novelId, bookTitle, deferred,
                    message: buildReviewMessage(bookTitle, mine),
                    instruction: REVIEW_INSTRUCTION(userName, hasRead && bm! >= total, hasRead),
                    kind: 'review', purpose: '交换书评（忙完补回）',
                });
                const parsed = parseRatedReview(reply);
                const charReview = { charId: char.id, charName: char.name, text: parsed.text, rating: parsed.rating, at: Date.now() };
                await updateRecord(job.novelId, r => ({
                    ...r, updatedAt: Date.now(),
                    reviews: {
                        ...r.reviews,
                        chars: [...(r.reviews?.chars || []).filter(x => x.charId !== char.id), charReview],
                        waiting: (r.reviews?.waiting || []).filter(w => w.charId !== char.id),
                    },
                }));
            }
            done.push({ charName: char.name, bookTitle, kind: job.kind });
        } catch (e) {
            await markFailed(job, e instanceof Error ? e.message : String(e), sent);
        }
    }
    return done;
}
