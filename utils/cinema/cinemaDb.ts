/**
 * 影院存储：跟书房一样放在 vr_settings 里，不新建表、不升数据库版本；全量备份整表带走。
 *   cinema-pair            记住的放映室（配对码 + 房间密钥）
 *   cinema-session-<id>    每一场的记录（看什么、和谁、聊了什么、放到哪）
 */
import { openDB } from '../db';
import { CINEMA_PAIR_ID, CINEMA_SESSION_PREFIX, cinemaSessionKey, type CinemaPairing, type CinemaSession } from './cinema';

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
