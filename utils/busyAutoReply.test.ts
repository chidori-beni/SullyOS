import { describe, expect, it } from 'vitest';
import type { CharacterProfile, DailySchedule, Message } from '../types';
import {
    buildAutoReplyCatchUpPrompt,
    buildAutoReplyText,
    busyReplyChance,
    collectBusyReplySignals,
    decideBusyReply,
} from './busyAutoReply';

const char = (extra: Partial<CharacterProfile> = {}) => ({
    id: 'char-1', name: '萧逸', busyAutoReplyEnabled: true, ...extra,
} as CharacterProfile);
const schedule = (busyLevel: 'free' | 'light' | 'busy' | 'sleep', extra: Record<string, unknown> = {}): DailySchedule => ({
    id: 'char-1_2026-08-25', charId: 'char-1', date: '2026-08-25', generatedAt: 1,
    slots: [{ startTime: '10:00', endTime: '12:00', activity: '车队会议', busyLevel, ...extra }],
});
const user = (content: string): Message => ({ id: 1, charId: 'char-1', role: 'user', type: 'text', content, timestamp: 1 });

describe('忙碌时自动回复', () => {
    it('free 正常回复，light 进入可分心模式', () => {
        const now = new Date('2026-08-25T10:30:00');
        expect(decideBusyReply({ char: char(), schedule: schedule('free'), messages: [user('在吗')], now }).mode).toBe('free');
        expect(decideBusyReply({ char: char(), schedule: schedule('light'), messages: [user('在吗')], now }).mode).toBe('multitask');
    });

    it('busy 通常只给自动回复，sleep 同理', () => {
        const now = new Date('2026-08-25T10:30:00');
        expect(decideBusyReply({ char: char(), schedule: schedule('busy'), messages: [user('晚点聊')], now, roll: 99 }).mode).toBe('auto-reply');
        expect(decideBusyReply({ char: char(), schedule: schedule('sleep'), messages: [user('晚安')], now, roll: 99 }).mode).toBe('auto-reply');
    });

    it('紧急消息与来电会提高偷看概率，并遵守 APK 上限', () => {
        const signals = collectBusyReplySignals([user('紧急，快给我打电话')]);
        expect(signals.isCallRequest).toBe(true);
        expect(busyReplyChance('busy', signals)).toBe(81);
        expect(busyReplyChance('sleep', signals)).toBe(47);
        const many = { ...signals, unreadUserMsgCount: 20 };
        expect(busyReplyChance('busy', many)).toBe(85);
        expect(busyReplyChance('sleep', many)).toBe(60);
    });

    it('日程空档不把上一条活动无限延长', () => {
        const now = new Date('2026-08-25T13:00:00');
        expect(decideBusyReply({ char: char(), schedule: schedule('busy'), messages: [user('在吗')], now, roll: 99 }).mode).toBe('free');
    });

    it('默认使用 APK 固定文案，也可自定义或按当前活动生成', () => {
        const slot = schedule('busy').slots[0];
        expect(buildAutoReplyText(char(), 'busy', slot)).toBe('[自动回复]现在在忙稍后回复');
        expect(buildAutoReplyText(char({ busyAutoReplyUseScheduleText: false, busyAutoReplyBusyText: '比赛中，勿扰' }), 'busy', slot)).toBe('比赛中，勿扰');
        expect(buildAutoReplyText(char({ busyAutoReplyUseScheduleText: true }), 'busy', slot)).toBe('[自动回复] 车队会议中，稍后回复');
    });

    it('上一条是自动回复且现在空闲时给补回提示', () => {
        const auto = { ...user('x'), role: 'assistant' as const, metadata: { busyAutoReply: { level: 'busy' } } };
        expect(buildAutoReplyCatchUpPrompt([auto, user('你忙完了吗')])).toContain('并没有真正回答');
        expect(buildAutoReplyCatchUpPrompt([user('x')])).toBe('');
    });
});
