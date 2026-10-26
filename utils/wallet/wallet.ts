/**
 * 钱包 —— 纯函数，无 DB / 无副作用，便于 vitest 直测。
 *
 * 账从哪来：**不另记一本账，直接从转账消息里算**。私聊转账、回执、群红包本来就都存在
 * messages 里（type:'transfer'），转账从哪条路落库（前台、主动消息重放、群聊派发）都一样会
 * 被算到，不会因为漏挂一个钩子就对不上；以前的老转账也能原样翻出来。
 *
 * 余额怎么算：每个人（用户 'user' / 角色 charId）有一个「基准」——用户手填或按人设生成的
 * 余额 + 设定时刻。余额 = 基准 + 基准之后发生的每一笔进出。所以：
 *   - 设定之前的老转账只进流水、不动余额（否则一设初始余额，旧账一算就可能是负数）
 *   - 手动改余额 = 换一个新基准，之前的进出全部「结清」
 *   - 没设过基准的人余额是 undefined，不限额（不拦）
 *
 * 钱什么时候动（和微信一样）：
 *   私聊：发出当时就从付款方扣（待处理也算扣了）；对方收下 → 进对方；退回 → 回到付款方
 *   群红包：发出扣全额；每份被抢 → 进抢到的人；退回 / 过期 → 剩下的退给发包人
 *   余额不足没转成的（status:'failed'）不动钱
 */
import type { Message } from '../../types';
import { effectivePacketStatus, type GroupPacketMeta } from '../groupChat/redpacket';

export const WALLET_USER_ID = 'user';

export interface WalletBaseline {
    balance: number;
    /** 设定时刻；只有这之后的进出才算进余额 */
    setAt: number;
    /** 按人设生成时模型给的一句理由；手改后清空 */
    reason?: string;
    source?: 'manual' | 'generated';
}

export interface WalletState {
    id: typeof WALLET_STATE_ID;
    /** key = 'user' 或 charId */
    owners: Record<string, WalletBaseline>;
}

export const WALLET_STATE_ID = 'wallet-state';

export const emptyWalletState = (): WalletState => ({ id: WALLET_STATE_ID, owners: {} });

export type WalletEntryKind =
    | 'transfer_out'   // 转出（私聊）
    | 'transfer_in'    // 对方收下（私聊）
    | 'transfer_back'  // 被退回，钱回到付款方（私聊）
    | 'packet_out'     // 发红包
    | 'packet_in'      // 抢到红包
    | 'packet_back';   // 红包退回 / 过期，剩余退给发包人

/** 一笔进出。delta 正 = 进账，负 = 出账，都是对 owner 而言 */
export interface WalletEntry {
    key: string;
    owner: string;
    /** 对手方：'user' / charId；拼手气红包没有单一对手方时为 undefined */
    counterpart?: string;
    delta: number;
    at: number;
    kind: WalletEntryKind;
    msgId: number;
    charId?: string;
    groupId?: string;
    note?: string;
    /** 原转账当前是不是还没被处理 */
    pending?: boolean;
}

export const roundMoney = (n: number) => Math.round(n * 100) / 100;

export const toAmount = (raw: unknown): number => {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
};

export const formatWalletMoney = (n: number | undefined): string => {
    if (n === undefined || !Number.isFinite(n)) return '--';
    const fixed = Number.isInteger(n) ? String(n) : n.toFixed(2);
    const [int, dec] = fixed.replace('-', '').split('.');
    return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${dec ? `.${dec}` : ''}`;
};

const ownerOfMessage = (m: Message): string => (m.role === 'user' ? WALLET_USER_ID : m.charId);

/** 一条私聊转账原始消息 → 进出（回执消息本身不产生进出，钱跟着原转账走） */
function privateEntries(m: Message): WalletEntry[] {
    const meta = m.metadata || {};
    if (meta.receipt) return [];
    const status = meta.status || 'pending';
    if (status === 'failed') return [];
    const amount = toAmount(meta.amount);
    if (!amount) return [];
    const payer = ownerOfMessage(m);
    const payee = payer === WALLET_USER_ID ? m.charId : WALLET_USER_ID;
    const at = m.timestamp || 0;
    const resolvedAt = Number(meta.resolvedAt) || at;
    const base = { msgId: m.id, charId: m.charId, note: meta.note };
    const out: WalletEntry[] = [{
        ...base, key: `${m.id}:out`, owner: payer, counterpart: payee, delta: -amount, at, kind: 'transfer_out',
        pending: status === 'pending',
    }];
    if (status === 'accepted') {
        out.push({ ...base, key: `${m.id}:in`, owner: payee, counterpart: payer, delta: amount, at: resolvedAt, kind: 'transfer_in' });
    } else if (status === 'returned') {
        out.push({ ...base, key: `${m.id}:back`, owner: payer, counterpart: payee, delta: amount, at: resolvedAt, kind: 'transfer_back' });
    }
    return out;
}

function packetEntries(m: Message, now: number): WalletEntry[] {
    const meta = m.metadata as GroupPacketMeta | undefined;
    if (!meta?.packet) return [];
    const total = toAmount(meta.totalAmount);
    if (!total) return [];
    const sender = ownerOfMessage(m);
    const at = m.timestamp || 0;
    const base = { msgId: m.id, groupId: m.groupId, note: meta.note };
    const status = effectivePacketStatus(meta, now);
    const out: WalletEntry[] = [{
        ...base, key: `${m.id}:out`, owner: sender, counterpart: meta.packetType === 'direct' ? meta.targetId : undefined,
        delta: -total, at, kind: 'packet_out', pending: status === 'pending',
    }];
    let claimed = 0;
    for (const c of meta.claims || []) {
        const amt = toAmount(c.amount);
        if (!amt) continue;
        claimed = roundMoney(claimed + amt);
        out.push({ ...base, key: `${m.id}:claim:${c.claimantId}`, owner: c.claimantId, counterpart: sender, delta: amt, at: c.at || at, kind: 'packet_in' });
    }
    const left = roundMoney(total - claimed);
    if ((status === 'returned' || status === 'expired') && left > 0) {
        const backAt = status === 'returned' ? (meta.resolvedAt || at) : meta.expiresAt;
        out.push({ ...base, key: `${m.id}:back`, owner: sender, delta: left, at: backAt, kind: 'packet_back' });
    }
    return out;
}

/** 所有转账消息 → 所有进出，按时间从新到旧 */
export function buildWalletEntries(messages: Message[], now: number = Date.now()): WalletEntry[] {
    const seen = new Set<number>();
    const out: WalletEntry[] = [];
    for (const m of messages) {
        if (!m || m.type !== 'transfer' || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(...(m.metadata?.packet ? packetEntries(m, now) : m.groupId ? [] : privateEntries(m)));
    }
    return out.sort((a, b) => b.at - a.at);
}

/** 当前余额；没设过基准 → undefined（不限额） */
export function walletBalance(owner: string, state: WalletState, entries: WalletEntry[]): number | undefined {
    const base = state.owners[owner];
    if (!base) return undefined;
    let sum = base.balance;
    for (const e of entries) if (e.owner === owner && e.at > base.setAt) sum += e.delta;
    return roundMoney(sum);
}

export interface SpendCheck {
    ok: boolean;
    balance?: number;
}

/** 能不能付这笔：没设余额的人不拦 */
export function canSpend(owner: string, amount: number, state: WalletState, entries: WalletEntry[]): SpendCheck {
    const balance = walletBalance(owner, state, entries);
    if (balance === undefined) return { ok: true };
    return { ok: roundMoney(balance - amount) >= 0, balance };
}

export interface PairSummary {
    /** 你转给 ta（已扣的，包括待处理），不含被退回的 */
    userToChar: number;
    /** ta 转给你 */
    charToUser: number;
    /** 你还没处理的 ta 的转账 */
    pendingFromChar: number;
    /** ta 还没处理的你的转账 */
    pendingFromUser: number;
    count: number;
}

/**
 * 你和某个角色之间的往来（只算私聊转账 + 指名红包）。since 用来算「本月」。
 * 被退回的那笔不算「转给了」。
 */
export function summarizePair(charId: string, entries: WalletEntry[], since = 0): PairSummary {
    const s: PairSummary = { userToChar: 0, charToUser: 0, pendingFromChar: 0, pendingFromUser: 0, count: 0 };
    const backed = new Set(entries.filter(e => e.kind === 'transfer_back' || e.kind === 'packet_back').map(e => e.msgId));
    for (const e of entries) {
        if (e.at < since) continue;
        if (e.kind !== 'transfer_out' && e.kind !== 'packet_out') continue;
        const fromUser = e.owner === WALLET_USER_ID && e.counterpart === charId;
        const fromChar = e.owner === charId && e.counterpart === WALLET_USER_ID;
        if (!fromUser && !fromChar) continue;
        s.count++;
        if (backed.has(e.msgId) && !e.pending) continue;
        const amt = -e.delta;
        if (fromUser) { s.userToChar = roundMoney(s.userToChar + amt); if (e.pending) s.pendingFromUser++; }
        else { s.charToUser = roundMoney(s.charToUser + amt); if (e.pending) s.pendingFromChar++; }
    }
    return s;
}

/** 本月第一天 0 点（本地时间） */
export const monthStart = (now: number = Date.now()): number => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** 按人设生成：从模型回复里抠 {balance, reason} */
export function parseGeneratedBalance(raw: unknown): { balance: number; reason: string } | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const n = typeof o.balance === 'number'
        ? o.balance
        : parseFloat(String(o.balance ?? '').replace(/[,，\s¥￥₩$元]/g, ''));
    if (!Number.isFinite(n) || n < 0) return null;
    return { balance: roundMoney(n), reason: String(o.reason ?? '').trim().slice(0, 80) };
}
