import { afterAll, describe, expect, it } from 'vitest';
import type { CharacterProfile, ScheduleSlot } from '../types';
import {
    addScheduleDateKey,
    getCurrentScheduleSlotIndex,
    getScheduleDateKey,
    getScheduleWallClock,
} from './scheduleTime';

const originalTimeZone = process.env.TZ;

afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
});

const losAngelesChar = {
    customTimezoneEnabled: true,
    customTimezone: 'America/Los_Angeles',
} as CharacterProfile;

const slots: ScheduleSlot[] = [
    { startTime: '08:00', activity: '早餐' },
    { startTime: '12:00', activity: '午餐' },
    { startTime: '18:00', activity: '晚饭' },
];

describe('character schedule clock', () => {
    it('uses the character wall clock for date, time and current-slot ordering', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T16:30:00.000Z');
        const wallClock = getScheduleWallClock(losAngelesChar, instant);

        expect(getScheduleDateKey(losAngelesChar, instant)).toBe('2026-07-20');
        expect([wallClock.getHours(), wallClock.getMinutes()]).toEqual([9, 30]);
        expect(getCurrentScheduleSlotIndex(slots, losAngelesChar, instant)).toBe(0);
    });

    it('falls back to the phone clock when custom timezone is disabled', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T16:30:00.000Z'); // 手机 7/21 00:30
        const disabled = {
            ...losAngelesChar,
            customTimezoneEnabled: false,
        };

        expect(getScheduleDateKey(disabled, instant)).toBe('2026-07-21');
        expect(getCurrentScheduleSlotIndex(slots, disabled, instant)).toBe(-1);
    });

    it('ignores malformed slot times instead of selecting them', () => {
        const instant = new Date('2026-07-20T16:30:00.000Z');
        expect(getCurrentScheduleSlotIndex([
            { startTime: 'not-a-time', activity: '坏数据' },
            ...slots,
        ], losAngelesChar, instant)).toBe(1);
    });

    it('keeps Beijing date/time when the Tokyo device has already crossed midnight', () => {
        process.env.TZ = 'Asia/Tokyo';
        const beijingChar = {
            customTimezoneEnabled: true,
            customTimezone: 'Asia/Shanghai',
        } as CharacterProfile;
        const instant = new Date('2026-09-14T15:30:00.000Z'); // 东京 9/15 00:30，北京 9/14 23:30
        expect(getScheduleDateKey(beijingChar, instant)).toBe('2026-09-14');
        expect(getScheduleWallClock(beijingChar, instant).getHours()).toBe(23);
        expect(addScheduleDateKey('2026-09-14', 1)).toBe('2026-09-15');
        expect(addScheduleDateKey('2026-03-01', -1)).toBe('2026-02-28');
    });
});
