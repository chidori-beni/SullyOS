import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { buildBankEntries, buildWalletEntries, canSpend, formatWalletMoney, parseGeneratedBalance, summarizePair, walletBalance, type WalletState } from './wallet';

let nextId = 1;
const msg = (p: Partial<Message> & { metadata?: any }): Message => ({
    id: nextId++, charId: 'c1', role: 'user', type: 'transfer', content: '[转账]', timestamp: 1000, ...p,
} as Message);

const state = (owners: WalletState['owners']): WalletState => ({ id: 'wallet-state', owners });

describe('钱包流水', () => {
    it('用户转出当时就扣；对方收下进对方账', () => {
        const entries = buildWalletEntries([
            msg({ timestamp: 2000, metadata: { amount: '520', status: 'accepted', resolvedAt: 3000 } }),
        ]);
        const s = state({ user: { balance: 1000, setAt: 1000 }, c1: { balance: 0, setAt: 1000 } });
        expect(walletBalance('user', s, entries)).toBe(480);
        expect(walletBalance('c1', s, entries)).toBe(520);
    });

    it('待处理也算扣了；退回钱回到付款方', () => {
        const pending = buildWalletEntries([msg({ timestamp: 2000, metadata: { amount: 100 } })]);
        const returned = buildWalletEntries([msg({ timestamp: 2000, metadata: { amount: 100, status: 'returned', resolvedAt: 2500 } })]);
        const s = state({ user: { balance: 100, setAt: 0 }, c1: { balance: 0, setAt: 0 } });
        expect(walletBalance('user', s, pending)).toBe(0);
        expect(walletBalance('user', s, returned)).toBe(100);
        expect(walletBalance('c1', s, returned)).toBe(0);
    });

    it('角色转给用户；回执消息不重复记账；余额不足没转成的不动钱', () => {
        const entries = buildWalletEntries([
            msg({ role: 'assistant', timestamp: 2000, metadata: { amount: 300, status: 'accepted', resolvedAt: 2100 } }),
            msg({ role: 'user', timestamp: 2100, content: '[已收款]', metadata: { receipt: 'accepted', amount: 300 } }),
            msg({ role: 'assistant', timestamp: 2200, metadata: { amount: 9999, status: 'failed' } }),
        ]);
        const s = state({ user: { balance: 0, setAt: 0 }, c1: { balance: 500, setAt: 0 } });
        expect(walletBalance('c1', s, entries)).toBe(200);
        expect(walletBalance('user', s, entries)).toBe(300);
    });

    it('设定余额之前的老转账不动余额；没设过余额是 undefined', () => {
        const entries = buildWalletEntries([msg({ timestamp: 500, metadata: { amount: 50, status: 'accepted' } })]);
        const s = state({ user: { balance: 10, setAt: 1000 } });
        expect(walletBalance('user', s, entries)).toBe(10);
        expect(walletBalance('c1', s, entries)).toBeUndefined();
        expect(canSpend('c1', 1e9, s, entries).ok).toBe(true);
    });

    it('余额不够就拦；刚好够放行', () => {
        const s = state({ user: { balance: 100, setAt: 0 } });
        expect(canSpend('user', 100, s, []).ok).toBe(true);
        expect(canSpend('user', 100.01, s, [])).toEqual({ ok: false, balance: 100 });
    });

    it('群红包：发出扣全额，抢到的进账，过期剩余退回', () => {
        const packet = msg({
            charId: 'user', groupId: 'g1', role: 'user', timestamp: 1000, content: '[红包]',
            metadata: {
                packet: true, packetType: 'lucky', totalAmount: 100, shares: 3, status: 'pending', expiresAt: 5000,
                claims: [{ claimantId: 'c1', amount: 30, at: 1100 }, { claimantId: 'c2', amount: 20, at: 1200 }],
            },
        });
        const s = state({ user: { balance: 100, setAt: 0 }, c1: { balance: 0, setAt: 0 } });
        const before = buildWalletEntries([packet], 4000);
        expect(walletBalance('user', s, before)).toBe(0);
        expect(walletBalance('c1', s, before)).toBe(30);
        const after = buildWalletEntries([packet], 6000);
        expect(walletBalance('user', s, after)).toBe(50);
    });

    it('同一条消息被读两次只算一次', () => {
        const m = msg({ timestamp: 2000, metadata: { amount: 10 } });
        expect(buildWalletEntries([m, m])).toHaveLength(1);
    });
});

describe('往来汇总', () => {
    it('分方向统计，被退回的不算转给了', () => {
        const entries = buildWalletEntries([
            msg({ timestamp: 2000, metadata: { amount: 100, status: 'accepted', resolvedAt: 2100 } }),
            msg({ timestamp: 2200, metadata: { amount: 50, status: 'returned', resolvedAt: 2300 } }),
            msg({ timestamp: 2400, metadata: { amount: 7 } }),
            msg({ role: 'assistant', timestamp: 2500, metadata: { amount: 1314 } }),
            msg({ charId: 'c2', timestamp: 2600, metadata: { amount: 1 } }),
        ]);
        const s = summarizePair('c1', entries);
        expect(s.userToChar).toBe(107);
        expect(s.charToUser).toBe(1314);
        expect(s.pendingFromUser).toBe(1);
        expect(s.pendingFromChar).toBe(1);
        expect(s.count).toBe(4);
    });
});

describe('杂项', () => {
    it('金额格式', () => {
        expect(formatWalletMoney(1234567)).toBe('1,234,567');
        expect(formatWalletMoney(-1234.5)).toBe('-1,234.50');
        expect(formatWalletMoney(undefined)).toBe('--');
    });
    it('解析生成结果', () => {
        expect(parseGeneratedBalance({ balance: '¥12,000.5', reason: '打工人' })).toEqual({ balance: 12000.5, reason: '打工人' });
        expect(parseGeneratedBalance({ balance: -1 })).toBeNull();
        expect(parseGeneratedBalance('x')).toBeNull();
    });
});

describe('存钱罐记账', () => {
    const tx = (id: string, amount: number, timestamp: number) => ({ id, amount, category: 'general', note: '午饭', timestamp, dateStr: '2026-10-26' });

    it('设余额之后记的消费从我的余额里扣，之前记的不扣', () => {
        const entries = buildBankEntries([tx('a', 30, 500), tx('b', 25.5, 2000), tx('c', 10, 3000)]);
        const s = state({ user: { balance: 1000, setAt: 1000 } });
        expect(walletBalance('user', s, entries)).toBe(964.5);
    });

    it('和转账一起算；扣到不够时转账被拦', () => {
        const entries = [
            ...buildWalletEntries([msg({ timestamp: 2000, metadata: { amount: 50 } })]),
            ...buildBankEntries([tx('a', 40, 1500)]),
        ];
        const s = state({ user: { balance: 100, setAt: 1000 } });
        expect(walletBalance('user', s, entries)).toBe(10);
        expect(canSpend('user', 11, s, entries).ok).toBe(false);
    });

    it('金额填负数当进账；坏数据跳过', () => {
        const entries = buildBankEntries([tx('a', -20, 2000), { ...tx('b', 0, 2000) }, { ...tx('', 5, 2000) }]);
        expect(entries).toHaveLength(1);
        expect(entries[0].delta).toBe(20);
    });
});
