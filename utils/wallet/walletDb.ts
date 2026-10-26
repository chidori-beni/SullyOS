/**
 * 钱包存储：跟书房 / 影院一样放在 vr_settings 里（id='wallet-state'），不新建表、不升数据库版本；
 * 全量备份整表带走 vr_settings。这里只存「基准余额」，流水每次从转账消息现算（见 wallet.ts 文件头）。
 *
 * 读转账消息走 messages 的 [charId, type] 复合索引，成本只跟转账条数有关，跟聊天总量无关。
 * 私聊里用户发的消息 charId 是角色 id；群聊里用户发的是 'user'——所以「每个角色 + 'user'」就是全部。
 */
import { openDB } from '../db';
import type { Message } from '../../types';
import {
    buildWalletEntries, canSpend, emptyWalletState, walletBalance, WALLET_STATE_ID, WALLET_USER_ID,
    type SpendCheck, type WalletBaseline, type WalletEntry, type WalletState,
} from './wallet';

const SETTINGS = 'vr_settings';
const MESSAGES = 'messages';

/** 余额或流水变了（改余额 / 新转账）时广播，钱包 App 收到就重算 */
export const WALLET_UPDATED_EVENT = 'sully-wallet-updated';
export const notifyWalletUpdated = () => {
    try { window.dispatchEvent(new Event(WALLET_UPDATED_EVENT)); } catch { /* 非浏览器环境 */ }
};

export async function getWalletState(): Promise<WalletState> {
    const db = await openDB();
    if (!db.objectStoreNames.contains(SETTINGS)) return emptyWalletState();
    return new Promise((resolve, reject) => {
        const req = db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).get(WALLET_STATE_ID);
        req.onsuccess = () => {
            const row = req.result as WalletState | undefined;
            resolve({ ...emptyWalletState(), ...(row || {}), owners: { ...(row?.owners || {}) } });
        };
        req.onerror = () => reject(req.error);
    });
}

async function saveWalletState(state: WalletState): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SETTINGS, 'readwrite');
        tx.objectStore(SETTINGS).put({ ...state, id: WALLET_STATE_ID });
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('钱包保存失败'));
    });
    notifyWalletUpdated();
}

/** 设定 / 改某人的余额（换一个新基准）。balance 传 null = 清掉，回到「未设置、不限额」 */
export async function setWalletBalance(owner: string, balance: number | null, extra?: Pick<WalletBaseline, 'reason' | 'source'>): Promise<void> {
    const state = await getWalletState();
    if (balance === null) delete state.owners[owner];
    else state.owners[owner] = { balance, setAt: Date.now(), source: extra?.source || 'manual', ...(extra?.reason ? { reason: extra.reason } : {}) };
    await saveWalletState(state);
}

async function transferMessagesOf(charId: string): Promise<Message[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains(MESSAGES)) return [];
    const store = db.transaction(MESSAGES, 'readonly').objectStore(MESSAGES);
    if (!store.indexNames.contains('charId_type')) return [];
    return new Promise((resolve, reject) => {
        const req = store.index('charId_type').getAll(IDBKeyRange.only([charId, 'transfer']));
        req.onsuccess = () => resolve((req.result || []) as Message[]);
        req.onerror = () => reject(req.error);
    });
}

/** 全部人的全部进出（从新到旧） */
export async function loadWalletEntries(charIds: string[]): Promise<WalletEntry[]> {
    const ids = Array.from(new Set([...charIds, WALLET_USER_ID]));
    const lists = await Promise.all(ids.map(id => transferMessagesOf(id).catch(() => [] as Message[])));
    return buildWalletEntries(lists.flat());
}

/**
 * 付钱前查一下够不够。读失败时放行——钱包是锦上添花，不能因为读库出错把转账整个卡死。
 * 角色付款只需要它自己的转账 + 它在群里的红包，但抢红包的进账记在别人的包里，
 * 所以还是把全部人的都读上（只读索引，量很小）。
 */
export async function checkWalletSpend(owner: string, amount: number, charIds: string[]): Promise<SpendCheck> {
    try {
        const state = await getWalletState();
        if (!state.owners[owner]) return { ok: true };
        const entries = await loadWalletEntries(charIds);
        return canSpend(owner, amount, state, entries);
    } catch (e) {
        console.warn('[Wallet] 查余额失败，放行这笔转账:', e);
        return { ok: true };
    }
}

/** 拿所有角色 id（付款检查要用）。不想从 OSContext 传进来的地方用这个 */
export async function listAllCharacterIds(): Promise<string[]> {
    const db = await openDB();
    if (!db.objectStoreNames.contains('characters')) return [];
    return new Promise((resolve, reject) => {
        const req = db.transaction('characters', 'readonly').objectStore('characters').getAllKeys();
        req.onsuccess = () => resolve((req.result || []).map(String));
        req.onerror = () => reject(req.error);
    });
}

/** 某人当前余额；没设过 → undefined。查手机的钱包页、生成流水时用它对齐数字 */
export async function getWalletBalanceOf(owner: string): Promise<number | undefined> {
    try {
        const state = await getWalletState();
        if (!state.owners[owner]) return undefined;
        return walletBalance(owner, state, await loadWalletEntries(await listAllCharacterIds()));
    } catch {
        return undefined;
    }
}
