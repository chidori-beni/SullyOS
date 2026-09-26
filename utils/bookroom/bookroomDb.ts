/**
 * 「书房」存储：记录放在 vr_settings（`bookroom-book-<novelId>`），书沿用 vr_novels。
 * 不新建表、不升数据库版本；全量备份已经整表带走 vr_settings。
 */
import { DB, openDB } from '../db';
import { processNewMessagesWithAutoArchive } from '../memoryPalace/autoArchive';
import type { APIConfig, CharacterProfile, VRWorldNovel } from '../../types';
import { BOOKROOM_RECORD_PREFIX, buildArchive, type BookroomRecord } from './bookroom';

const SETTINGS = 'vr_settings';
const NOVELS = 'vr_novels';

export async function listBookroomRecords(): Promise<BookroomRecord[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains(SETTINGS)) return [];
    return new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(BOOKROOM_RECORD_PREFIX, `${BOOKROOM_RECORD_PREFIX}￿`);
        const req = db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).getAll(range);
        req.onsuccess = () => resolve((req.result || []) as BookroomRecord[]);
        req.onerror = () => reject(req.error);
    });
}

export async function saveBookroomRecord(record: BookroomRecord): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS, 'readwrite');
        tx.objectStore(SETTINGS).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('书房记录保存失败'));
    });
}

/**
 * 归档：只删正文，记录、批注、角色书签全留。
 * 和彼方的「下架」不同 —— 下架会连批注一起删。书记录和删书在同一事务里，不会只做一半。
 */
export async function archiveBook(novel: VRWorldNovel, record: BookroomRecord): Promise<BookroomRecord> {
    const annotations = await DB.getVRAnnotations(novel.id);
    const next: BookroomRecord = { ...record, archived: buildArchive(novel, annotations), updatedAt: Date.now() };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SETTINGS, NOVELS], 'readwrite');
        tx.objectStore(SETTINGS).put(next);
        tx.objectStore(NOVELS).delete(novel.id);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('归档失败，书没有被删除'));
    });
    return next;
}

/**
 * 重新导入同名书：沿用旧 id，角色书签和批注自动接回。
 * 目录按新导入的正文重算；新文件没带封面时保留旧封面。
 */
export async function restoreArchivedBook(novel: VRWorldNovel, record: BookroomRecord, extras: { chapters?: BookroomRecord['chapters']; cover?: string } = {}): Promise<BookroomRecord> {
    const next: BookroomRecord = { ...record, archived: undefined, chapters: extras.chapters, cover: extras.cover || record.cover, updatedAt: Date.now() };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SETTINGS, NOVELS], 'readwrite');
        tx.objectStore(SETTINGS).put(next);
        tx.objectStore(NOVELS).put({ ...novel, id: record.novelId });
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('接回旧记录失败'));
    });
    return next;
}

interface MemoryConfigLike {
    embedding?: { baseUrl?: string; apiKey?: string };
    lightLLM?: { baseUrl?: string; apiKey?: string; model?: string };
}

/**
 * 把一条读书进度发进角色私聊（用户说的话），让它进上下文与记忆宫殿。
 * 这是一条普通的、看得见也删得掉的消息 —— 故意不做成隐藏消息，
 * 以前的「隐藏镜像」坑过：看不见、删不掉却一直影响角色。
 */
export async function sendProgressToCharacters(input: {
    text: string;
    novelId: string;
    characters: CharacterProfile[];
    apiConfig: APIConfig;
    memoryPalaceConfig?: MemoryConfigLike;
    userName: string;
}): Promise<void> {
    for (const char of input.characters) {
        await DB.saveMessage({
            charId: char.id, role: 'user', type: 'text', content: input.text,
            metadata: { source: 'bookroom', bookroomNovelId: input.novelId },
        });
        // 记忆管线（和彼方活动卡同一套做法，失败不影响进度保存）
        try {
            const mpEmb = input.memoryPalaceConfig?.embedding;
            const configured = input.memoryPalaceConfig?.lightLLM;
            const mpLLM = configured?.baseUrl ? configured : { baseUrl: input.apiConfig.baseUrl, apiKey: input.apiConfig.apiKey, model: input.apiConfig.model };
            if (char.memoryPalaceEnabled && mpEmb?.baseUrl && mpEmb?.apiKey && mpLLM.baseUrl) {
                const recent = await DB.getRecentMessagesByCharId(char.id, 50);
                void processNewMessagesWithAutoArchive(recent, char.id, char.name, mpEmb as any, mpLLM as any, input.userName, false).catch(() => {});
            }
        } catch { /* 记忆失败不影响主流程 */ }
    }
}
