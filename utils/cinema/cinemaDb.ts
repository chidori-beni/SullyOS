/**
 * 影院存储：跟书房一样放在 vr_settings 里，不新建表、不升数据库版本；全量备份整表带走。
 *   cinema-pair            记住的放映室（配对码 + 房间密钥）
 *   cinema-session-<id>    每一场的记录（看什么、和谁、聊了什么、放到哪）
 */
import { DB, openDB } from '../db';
import {
    CINEMA_END_SOURCE, CINEMA_MESSAGE_SOURCE, CINEMA_PAIR_ID, CINEMA_SESSION_PREFIX, cinemaLineText, cinemaMessageMetadata, cinemaSessionKey, matchLinesToChatMessages,
    type CinemaChatLine, type CinemaPairing, type CinemaSession,
} from './cinema';

const SETTINGS = 'vr_settings';

interface StoredSession { id: string; session: CinemaSession }

const read = async <T>(key: string): Promise<T | undefined> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(SETTINGS)) return undefined;
    return new Promise((resolve, reject) => {
        const req = db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
    });
};

const write = async (value: unknown): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS, 'readwrite');
        tx.objectStore(SETTINGS).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('影院记录保存失败'));
    });
};

const remove = async (key: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS, 'readwrite');
        tx.objectStore(SETTINGS).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('影院记录删除失败'));
    });
};

export const getCinemaPairing = () => read<CinemaPairing>(CINEMA_PAIR_ID);
export const saveCinemaPairing = (pairing: CinemaPairing) => write(pairing);
export const clearCinemaPairing = () => remove(CINEMA_PAIR_ID);

export async function listCinemaSessions(): Promise<CinemaSession[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains(SETTINGS)) return [];
    const rows = await new Promise<StoredSession[]>((resolve, reject) => {
        const range = IDBKeyRange.bound(CINEMA_SESSION_PREFIX, `${CINEMA_SESSION_PREFIX}￿`);
        const req = db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).getAll(range);
        req.onsuccess = () => resolve((req.result || []) as StoredSession[]);
        req.onerror = () => reject(req.error);
    });
    return rows.map(row => row.session).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const saveCinemaSession = (session: CinemaSession) =>
    write({ id: cinemaSessionKey(session.id), session } satisfies StoredSession);

export const deleteCinemaSession = (id: string) => remove(cinemaSessionKey(id));

/**
 * 「不留痕」：把这一场已经存进私聊消息库的话（和散场卡）全部删掉，返回删了几条。
 * 只删消息库里的；记忆宫殿如果已经整理过这一场（散过场 / 中途在私聊里聊过天），那部分删不掉。
 */
export async function removeSessionFromChat(charId: string, sessionId: string): Promise<number> {
    const [lines, ends] = await Promise.all([
        DB.getRecentMessagesByCharIdAndSource(charId, CINEMA_MESSAGE_SOURCE, Number.MAX_SAFE_INTEGER),
        DB.getRecentMessagesByCharIdAndSource(charId, CINEMA_END_SOURCE, Number.MAX_SAFE_INTEGER),
    ]);
    const ids = [...lines, ...ends].filter(m => m.metadata?.cinemaSessionId === sessionId).map(m => m.id);
    if (ids.length) await DB.deleteMessages(ids);
    return ids.length;
}

/**
 * 把放映室里的几句话从私聊消息库里撤掉（重来、长按删除），返回撤了几条。
 * 怎么对上是哪条见 matchLinesToChatMessages。
 */
export async function removeLinesFromChat(charId: string, sessionId: string, lines: CinemaChatLine[]): Promise<number> {
    if (!lines.length) return 0;
    const mine = (await DB.getRecentMessagesByCharIdAndSource(charId, CINEMA_MESSAGE_SOURCE, 400))
        .filter(m => m.metadata?.cinemaSessionId === sessionId);
    const ids = matchLinesToChatMessages(mine, lines);
    if (ids.length) await DB.deleteMessages(ids);
    return ids.length;
}

/** 「不留痕」改回「记住」：把这一场到目前为止的话按原来的时间补存进私聊消息库。 */
export async function backfillSessionToChat(charId: string, session: CinemaSession): Promise<number> {
    for (const line of session.lines) {
        await DB.saveMessage({
            charId,
            role: line.role === 'user' ? 'user' : 'assistant',
            type: 'text',
            content: cinemaLineText(line),
            timestamp: line.at,
            metadata: cinemaMessageMetadata(session, line.videoTime, line.at),
        });
    }
    return session.lines.length;
}
