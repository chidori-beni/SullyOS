/**
 * 钱包 —— 私聊转账 + 群红包的账本。余额（基准）存 vr_settings，流水从转账消息现算，
 * 算法与规则见 utils/wallet/wallet.ts 文件头。
 *
 * 存钱罐记的消费也从「我的余额」里扣（首页开关，缺省开），流水里显示成「记账」。
 *
 * 两层页面：首页（我的余额 + 各角色往来 + 最近流水）→ 点角色进详情（ta 的余额、改余额、按人设生成、往来流水）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CaretLeft, PencilSimple, Sparkle, Wallet } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import Modal from '../components/os/Modal';
import type { CharacterProfile } from '../types';
import { getCharChatAvatar } from '../utils/charChatAvatar';
import {
    formatWalletMoney, isBankLinked, monthStart, summarizePair, walletBalance, WALLET_USER_ID,
    type WalletEntry, type WalletState,
} from '../utils/wallet/wallet';
import { getWalletState, loadWalletEntries, setWalletBalance, setWalletBankLinked, WALLET_UPDATED_EVENT } from '../utils/wallet/walletDb';
import { generateBalanceByPersona } from '../utils/wallet/walletGenerate';

const money = (n: number | undefined) => `₩${formatWalletMoney(n)}`;

const fmtTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
    const md = `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
    return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md}`;
};

/** 一笔转账（按原始消息合并：转出 + 收下/退回是同一行） */
interface FlowRow {
    key: string;
    at: number;
    from: string;
    to?: string;
    amount: number;
    status: '待处理' | '已收下' | '已退回' | '红包' | '抢到红包' | '记账';
    note?: string;
    isPacket: boolean;
}

function buildRows(entries: WalletEntry[]): FlowRow[] {
    const byMsg = new Map<number, WalletEntry[]>();
    for (const e of entries) {
        const list = byMsg.get(e.msgId) || [];
        list.push(e);
        byMsg.set(e.msgId, list);
    }
    const rows: FlowRow[] = [];
    for (const e of entries) {
        if (e.kind !== 'bank_expense') continue;
        // 存钱罐的账：from = 我（花出去）；金额填负数的那种算进账，to = 我
        rows.push(e.delta < 0
            ? { key: e.key, at: e.at, from: WALLET_USER_ID, amount: -e.delta, status: '记账', note: e.note, isPacket: false }
            : { key: e.key, at: e.at, from: 'bank', to: WALLET_USER_ID, amount: e.delta, status: '记账', note: e.note, isPacket: false });
    }
    for (const [msgId, list] of byMsg) {
        if (!msgId) continue;
        const out = list.find(e => e.kind === 'transfer_out' || e.kind === 'packet_out');
        if (!out) continue;
        const isPacket = out.kind === 'packet_out';
        const status: FlowRow['status'] = isPacket ? '红包'
            : list.some(e => e.kind === 'transfer_in') ? '已收下'
            : list.some(e => e.kind === 'transfer_back') ? '已退回' : '待处理';
        rows.push({ key: out.key, at: out.at, from: out.owner, to: out.counterpart, amount: -out.delta, status, note: out.note, isPacket });
        // 别人发的红包被谁抢到，单独记一行（抢到的人视角）
        for (const c of list.filter(e => e.kind === 'packet_in')) {
            rows.push({ key: c.key, at: c.at, from: out.owner, to: c.owner, amount: c.delta, status: '抢到红包', isPacket: true });
        }
    }
    return rows.sort((a, b) => b.at - a.at);
}

const STATUS_COLOR: Record<FlowRow['status'], string> = {
    '待处理': 'text-amber-600 bg-amber-50',
    '已收下': 'text-emerald-600 bg-emerald-50',
    '已退回': 'text-slate-500 bg-slate-100',
    '红包': 'text-rose-500 bg-rose-50',
    '抢到红包': 'text-rose-500 bg-rose-50',
    '记账': 'text-lime-700 bg-lime-50',
};

const WalletApp: React.FC = () => {
    const { closeApp, characters, userProfile, apiConfig, addToast } = useOS();
    const [state, setState] = useState<WalletState | null>(null);
    const [entries, setEntries] = useState<WalletEntry[]>([]);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [generating, setGenerating] = useState(false);

    const reload = useCallback(async () => {
        try {
            const s = await getWalletState();
            const e = await loadWalletEntries(characters.map(c => c.id), s);
            setState(s);
            setEntries(e);
        } catch (err: any) {
            addToast(`钱包读取失败：${err?.message || err}`, 'error');
        }
    }, [characters, addToast]);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => {
        const on = () => { reload(); };
        window.addEventListener(WALLET_UPDATED_EVENT, on);
        return () => window.removeEventListener(WALLET_UPDATED_EVENT, on);
    }, [reload]);

    const nameOf = useCallback((id?: string) => {
        if (!id) return '群里';
        if (id === WALLET_USER_ID) return '我';
        return characters.find(c => c.id === id)?.name || '已删除的角色';
    }, [characters]);

    const rows = useMemo(() => buildRows(entries), [entries]);
    const since = useMemo(() => monthStart(), []);
    const balanceOf = (id: string) => (state ? walletBalance(id, state, entries) : undefined);

    const userMonth = useMemo(() => {
        // 被退回的那笔一来一回抵消：既不算转出，也不算收到
        let out = 0, inn = 0;
        for (const e of entries) {
            if (e.owner !== WALLET_USER_ID || e.at < since) continue;
            if (e.kind === 'transfer_in' || e.kind === 'packet_in') inn += e.delta;
            else out -= e.delta;
        }
        return { out: Math.round(out * 100) / 100, inn: Math.round(inn * 100) / 100 };
    }, [entries, since]);

    const charList = useMemo(() => {
        return [...characters]
            .map(c => ({ char: c, all: summarizePair(c.id, entries), month: summarizePair(c.id, entries, since) }))
            .sort((a, b) => (b.all.count - a.all.count) || a.char.name.localeCompare(b.char.name));
    }, [characters, entries, since]);

    const openEdit = (owner: string) => {
        const cur = balanceOf(owner);
        setEditValue(cur === undefined ? '' : String(cur));
        setEditing(owner);
    };

    const saveEdit = async (clear = false) => {
        if (!editing) return;
        if (clear) {
            await setWalletBalance(editing, null);
            addToast('已清除余额，现在不限额', 'success');
        } else {
            const n = parseFloat(editValue.replace(/[,，\s]/g, ''));
            if (!Number.isFinite(n) || n < 0) { addToast('请输入 0 或以上的数字', 'error'); return; }
            await setWalletBalance(editing, Math.round(n * 100) / 100, { source: 'manual' });
            addToast('余额已更新', 'success');
        }
        setEditing(null);
    };

    const generate = async (char: CharacterProfile) => {
        if (generating) return;
        setGenerating(true);
        try {
            const { balance, reason } = await generateBalanceByPersona(char, userProfile, apiConfig);
            await setWalletBalance(char.id, balance, { source: 'generated', reason });
            addToast(`${char.name}：${money(balance)}${reason ? `（${reason}）` : ''}`, 'success');
        } catch (err: any) {
            addToast(`生成失败：${err?.message || err}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const renderRow = (r: FlowRow, viewer: string) => {
        const outgoing = r.from === viewer;
        const incoming = r.to === viewer;
        const title = r.status === '记账'
            ? `存钱罐 · ${r.note || '一笔账'}`
            : r.status === '抢到红包'
            ? `${nameOf(r.to)} 抢到 ${nameOf(r.from)} 的红包`
            : `${nameOf(r.from)} → ${r.isPacket && !r.to ? '群红包' : nameOf(r.to)}`;
        return (
            <div key={r.key} className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-slate-700 truncate">{title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">{fmtTime(r.at)}{r.note && r.status !== '记账' ? ` · ${r.note}` : ''}</div>
                </div>
                <div className="text-right shrink-0">
                    <div className={`text-[15px] font-semibold tabular-nums ${outgoing ? 'text-slate-800' : incoming ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {outgoing ? '-' : incoming ? '+' : ''}{formatWalletMoney(r.amount)}
                    </div>
                    <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-[1px] rounded-full ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                </div>
            </div>
        );
    };

    const header = (title: string, onBack: () => void) => (
        <div className="shrink-0 bg-white/80 backdrop-blur-md border-b border-slate-100" style={{ paddingTop: 'var(--safe-top)' }}>
            <div className="flex items-center gap-2 px-4 py-3">
                <button onClick={onBack} className="p-2 -ml-2 rounded-full active:scale-90 transition-transform" aria-label="返回">
                    <CaretLeft size={22} className="text-slate-600" />
                </button>
                <h1 className="text-lg font-semibold text-slate-700">{title}</h1>
            </div>
        </div>
    );

    const balanceCard = (owner: string, label: string, extra?: React.ReactNode) => {
        const b = balanceOf(owner);
        const base = state?.owners[owner];
        return (
            <div className="rounded-3xl p-5 text-white shadow-lg bg-gradient-to-br from-amber-400 to-orange-500 relative overflow-hidden">
                <Wallet size={90} weight="fill" className="absolute -right-4 -bottom-5 opacity-15" />
                <div className="flex items-center justify-between">
                    <span className="text-[12px] text-white/80">{label}</span>
                    <button onClick={() => openEdit(owner)} className="flex items-center gap-1 text-[11px] bg-white/25 px-2.5 py-1 rounded-full active:scale-95">
                        <PencilSimple size={12} /> 改余额
                    </button>
                </div>
                <div className="text-[32px] font-bold tracking-tight tabular-nums mt-1">{b === undefined ? '未设置' : money(b)}</div>
                <div className="text-[11px] text-white/75 mt-0.5">
                    {b === undefined ? '没设余额时转账不限额' : base?.reason ? base.reason : `从 ${fmtTime(base!.setAt)} 起开始记账`}
                </div>
                {extra}
            </div>
        );
    };

    if (!state) {
        return <div className="h-full w-full bg-slate-50 flex items-center justify-center text-slate-400 text-sm">正在算账…</div>;
    }

    const detailChar = detailId ? characters.find(c => c.id === detailId) : undefined;

    const editModal = (
        <Modal
            isOpen={!!editing}
            title={editing === WALLET_USER_ID ? '我的余额' : `${nameOf(editing || undefined)}的余额`}
            onClose={() => setEditing(null)}
            footer={<>
                <button onClick={() => saveEdit(true)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl">清除</button>
                <button onClick={() => saveEdit()} className="flex-1 py-3 bg-orange-500 text-white rounded-2xl">保存</button>
            </>}
        >
            <input type="number" inputMode="decimal" value={editValue} onChange={e => setEditValue(e.target.value)} placeholder="余额"
                className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-lg font-bold" autoFocus />
            <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                保存后从现在起按这个数记账，之前的转账不再影响余额。余额不够时转账会被拦下；「清除」= 回到不限额。
            </p>
        </Modal>
    );

    if (detailChar) {
        const all = summarizePair(detailChar.id, entries);
        const month = summarizePair(detailChar.id, entries, since);
        const charRows = rows.filter(r => r.from === detailChar.id || r.to === detailChar.id);
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col">
                {header(detailChar.name, () => setDetailId(null))}
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 24px)' }}>
                    {balanceCard(detailChar.id, `${detailChar.name}的余额`,
                        <button onClick={() => generate(detailChar)} disabled={generating}
                            className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-white/25 text-[12px] font-medium active:scale-[0.98] disabled:opacity-60">
                            <Sparkle size={14} weight="fill" /> {generating ? '正在按人设估算…' : '按人设生成'}
                        </button>,
                    )}
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        <div className="bg-white rounded-2xl p-3.5 shadow-sm">
                            <div className="text-[11px] text-slate-400">我转给 ta</div>
                            <div className="text-[17px] font-semibold text-slate-800 tabular-nums mt-0.5">{money(all.userToChar)}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">本月 {money(month.userToChar)}</div>
                        </div>
                        <div className="bg-white rounded-2xl p-3.5 shadow-sm">
                            <div className="text-[11px] text-slate-400">ta 转给我</div>
                            <div className="text-[17px] font-semibold text-emerald-600 tabular-nums mt-0.5">{money(all.charToUser)}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">本月 {money(month.charToUser)}</div>
                        </div>
                    </div>
                    {(all.pendingFromChar > 0 || all.pendingFromUser > 0) && (
                        <div className="mt-3 text-[12px] text-amber-700 bg-amber-50 rounded-2xl px-4 py-2.5">
                            {all.pendingFromChar > 0 && <div>ta 有 {all.pendingFromChar} 笔转账你还没处理（去聊天里点开转账卡）</div>}
                            {all.pendingFromUser > 0 && <div>你有 {all.pendingFromUser} 笔转账 ta 还没收</div>}
                        </div>
                    )}
                    <div className="mt-4 bg-white rounded-2xl px-4 shadow-sm">
                        <div className="text-[12px] text-slate-400 pt-3">往来流水（{charRows.length}）</div>
                        {charRows.length === 0 && <div className="py-8 text-center text-[13px] text-slate-400">还没有转账</div>}
                        {charRows.map(r => renderRow(r, WALLET_USER_ID))}
                    </div>
                </div>
                {editModal}
            </div>
        );
    }

    const userRows = rows.filter(r => r.from === WALLET_USER_ID || r.to === WALLET_USER_ID).slice(0, 30);

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col">
            {header('钱包', closeApp)}
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 24px)' }}>
                {balanceCard(WALLET_USER_ID, '我的余额',
                    <div className="flex gap-4 mt-3 text-[12px] text-white/90">
                        <span>本月支出 {money(userMonth.out)}</span>
                        <span>收入 {money(userMonth.inn)}</span>
                    </div>,
                )}

                <button
                    onClick={async () => {
                        const next = !isBankLinked(state);
                        await setWalletBankLinked(next);
                        addToast(next ? '存钱罐的记账会从我的余额里扣' : '存钱罐的记账不再影响余额', 'success');
                    }}
                    className="mt-3 w-full flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm text-left active:bg-slate-50"
                >
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-slate-700">存钱罐记账也从余额里扣</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">设好余额之后在存钱罐记的每一笔消费都会扣掉；删掉那笔账，钱就退回来</div>
                    </div>
                    <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${isBankLinked(state) ? 'bg-orange-500' : 'bg-slate-300'}`}>
                        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${isBankLinked(state) ? 'translate-x-5' : ''}`} />
                    </span>
                </button>

                <div className="mt-5 text-[12px] text-slate-400 px-1">角色</div>
                <div className="mt-2 bg-white rounded-2xl shadow-sm overflow-hidden">
                    {charList.length === 0 && <div className="py-8 text-center text-[13px] text-slate-400">还没有角色</div>}
                    {charList.map(({ char, all }) => {
                        const b = balanceOf(char.id);
                        const avatar = getCharChatAvatar(char);
                        return (
                            <button key={char.id} onClick={() => setDetailId(char.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 text-left active:bg-slate-50">
                                {avatar
                                    ? <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                                    : <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] text-slate-700 truncate">{char.name}</div>
                                    <div className="text-[11px] text-slate-400 truncate">
                                        {all.count === 0 ? '还没有转账' : `ta 转我 ${money(all.charToUser)} · 我转 ta ${money(all.userToChar)}`}
                                        {all.pendingFromChar > 0 ? ` · ${all.pendingFromChar} 笔待收` : ''}
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-[13px] font-medium text-slate-700 tabular-nums">{b === undefined ? '未设置' : money(b)}</div>
                                    <div className="text-[10px] text-slate-400">余额</div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-5 text-[12px] text-slate-400 px-1">最近流水</div>
                <div className="mt-2 bg-white rounded-2xl px-4 shadow-sm">
                    {userRows.length === 0 && <div className="py-8 text-center text-[13px] text-slate-400">还没有转账</div>}
                    {userRows.map(r => renderRow(r, WALLET_USER_ID))}
                </div>
            </div>
            {editModal}
        </div>
    );
};

export default WalletApp;
