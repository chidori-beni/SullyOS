import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, DailySchedule, ScheduleSlot } from '../../types';
import { DB } from '../db';
import { evaluateVRActivityEligibility, resolveVRActivityEligibility } from './eligibility';

afterEach(() => vi.restoreAllMocks());

const role = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-1',
    name: '角色',
    scheduleFeatureEnabled: true,
    customTimezoneEnabled: true,
    customTimezone: 'Asia/Shanghai',
    ...overrides,
} as CharacterProfile);

const schedule = (...slots: ScheduleSlot[]): DailySchedule => ({
    id: 'char-1_2026-08-31',
    charId: 'char-1',
    date: '2026-08-31',
    generatedAt: Date.parse('2026-08-30T20:00:00Z'),
    slots,
});

const slot = (
    startTime: string,
    endTime: string,
    busyLevel: ScheduleSlot['busyLevel'],
): ScheduleSlot => ({ startTime, endTime, busyLevel, activity: '当前安排' });

describe('彼方活动资格', () => {
    it.each([
        ['busy', 'schedule-busy'],
        ['sleep', 'schedule-sleep'],
    ] as const)('当前 %s 时禁止活动', (busyLevel, reason) => {
        const result = evaluateVRActivityEligibility(
            role(),
            schedule(slot('08:00', '10:00', busyLevel)),
            new Date('2026-08-31T01:00:00Z'), // 上海 09:00
        );

        expect(result).toEqual({ allowed: false, reason, busyLevel });
    });

    it('free/light 和日程空档允许活动', () => {
        const at = new Date('2026-08-31T01:00:00Z'); // 上海 09:00
        expect(evaluateVRActivityEligibility(role(), schedule(slot('08:00', '10:00', 'free')), at)).toEqual({ allowed: true });
        expect(evaluateVRActivityEligibility(role(), schedule(slot('08:00', '10:00', 'light')), at)).toEqual({ allowed: true });
        expect(evaluateVRActivityEligibility(role(), schedule(slot('08:00', '09:00', 'busy')), at)).toEqual({ allowed: true });
    });

    it('按角色时区判定，而不是按设备时钟判定', () => {
        const laRole = role({ customTimezone: 'America/Los_Angeles' });
        const result = evaluateVRActivityEligibility(
            laRole,
            schedule(slot('09:00', '10:00', 'busy')),
            new Date('2026-08-31T16:30:00Z'), // 洛杉矶 09:30；设备在东京时已是次日 01:30
        );

        expect(result.reason).toBe('schedule-busy');
    });

    it('跨午夜睡眠时段在凌晨仍然禁止活动', () => {
        const result = evaluateVRActivityEligibility(
            role(),
            schedule(slot('23:00', '07:00', 'sleep')),
            new Date('2026-08-31T18:30:00Z'), // 上海次日 02:30
        );

        expect(result.reason).toBe('schedule-sleep');
    });

    it('日程功能关闭时保持旧行为，不因 busy 日程阻断', () => {
        const result = evaluateVRActivityEligibility(
            role({ scheduleFeatureEnabled: false }),
            schedule(slot('08:00', '10:00', 'busy')),
            new Date('2026-08-31T01:00:00Z'),
        );

        expect(result).toEqual({ allowed: true });
    });

    it('当天没有日程时允许活动，无法解析的日程则保守阻断', () => {
        expect(evaluateVRActivityEligibility(role(), null)).toEqual({ allowed: true });
        expect(evaluateVRActivityEligibility(role(), { slots: undefined as unknown as ScheduleSlot[] })).toEqual({
            allowed: false,
            reason: 'schedule-unavailable',
        });
    });

    it('清晨当天表尚未生成时，会补看前一个角色本地日的跨午夜状态', async () => {
        const previous = schedule(slot('23:00', '07:00', 'sleep'));
        vi.spyOn(DB, 'getDailySchedule').mockImplementation(async (_charId, date) =>
            date === '2026-08-31' ? previous : null,
        );

        const result = await resolveVRActivityEligibility(
            role(),
            new Date('2026-08-31T18:30:00Z'), // 上海次日 02:30
        );

        expect(result.reason).toBe('schedule-sleep');
    });

    it('读取日程失败时阻止活动；日程功能关闭时不读取存储', async () => {
        const failingRead = vi.spyOn(DB, 'getDailySchedule').mockRejectedValue(new Error('offline'));
        await expect(resolveVRActivityEligibility(role(), new Date('2026-08-31T01:00:00Z'))).resolves.toEqual({
            allowed: false,
            reason: 'schedule-unavailable',
        });

        failingRead.mockClear();
        await expect(resolveVRActivityEligibility(
            role({ scheduleFeatureEnabled: false }),
            new Date('2026-08-31T01:00:00Z'),
        )).resolves.toEqual({ allowed: true });
        expect(failingRead).not.toHaveBeenCalled();
    });
});
