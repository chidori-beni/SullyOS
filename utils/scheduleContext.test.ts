import { describe, expect, it } from 'vitest';
import type { CharacterProfile, DailySchedule } from '../types';
import { buildScheduleInjection } from './scheduleInjection';
import { createScheduleContextSnapshot } from './scheduleContext';
import { decideBusyReply } from './busyAutoReply';

const roleInBeijing = {
    id: 'char-beijing',
    customTimezoneEnabled: true,
    customTimezone: 'Asia/Shanghai',
    busyAutoReplyEnabled: true,
} as unknown as CharacterProfile;

const schedule: DailySchedule = {
    id: 'char-beijing_2026-08-31',
    charId: 'char-beijing',
    date: '2026-08-31',
    generatedAt: Date.parse('2026-08-30T20:00:00Z'),
    slots: [
        { startTime: '04:30', endTime: '09:00', activity: '补觉休息', busyLevel: 'sleep' },
        { startTime: '09:00', endTime: '11:30', activity: '晨间抗G加练', busyLevel: 'busy' },
    ],
};

// 东京 09:15 = 北京 08:15，正好覆盖截图里的时差场景。
const instant = new Date('2026-08-31T00:15:00Z');
const userMessage = {
    id: 1,
    charId: roleInBeijing.id,
    role: 'user' as const,
    type: 'text' as const,
    content: '你醒了吗',
    timestamp: instant.getTime(),
};

describe('本轮角色时间/日程快照', () => {
    it('用同一个绝对时刻统一角色墙钟、日期、当前 slot 和忙碌判定', () => {
        const context = createScheduleContextSnapshot(roleInBeijing, schedule, instant);

        expect(context.instant.getTime()).toBe(instant.getTime());
        expect(context.wallClock.getHours()).toBe(8);
        expect(context.wallClock.getMinutes()).toBe(15);
        expect(context.localDateKey).toBe('2026-08-31');
        expect(context.current?.activity).toBe('补觉休息');
        expect(context.currentSlotIndex).toBe(0);

        const decision = decideBusyReply({
            char: roleInBeijing,
            messages: [userMessage],
            scheduleContext: context,
            roll: 99,
        });
        expect(decision.mode).toBe('auto-reply');
        expect(decision.level).toBe('sleep');
    });

    it('快照解析结果可直接复用于日程提示词，不会重新挑到下一条活动', () => {
        const context = createScheduleContextSnapshot(roleInBeijing, schedule, instant);
        const prompt = buildScheduleInjection(schedule, undefined, context.wallClock, {
            resolvedSlots: { current: context.current, next: context.next },
        });

        expect(prompt).toContain('当前时段：04:30 你正在补觉休息');
        expect(prompt).toContain('之后安排：09:00 晨间抗G加练');
        expect(prompt).toContain('历史聊天里的活动只代表当时');
    });
});
