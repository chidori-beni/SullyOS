import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '../types';
import { getScheduleSlotInterval, isScheduleMinuteInInterval } from './scheduleClock';
import {
    fillMissingScheduleEndTimes,
    validateGeneratedSchedule,
} from './scheduleValidation';

const normalDay: ScheduleSlot[] = [
    { startTime: '07:00', endTime: '08:00', activity: '起床', busyLevel: 'free' },
    { startTime: '08:00', endTime: '12:00', activity: '训练', busyLevel: 'busy' },
    { startTime: '13:00', endTime: '18:00', activity: '工作', busyLevel: 'busy' },
    { startTime: '23:00', endTime: '07:00', activity: '睡眠', busyLevel: 'sleep' },
];

describe('日程时间区间与生成结果校验', () => {
    it('支持跨午夜睡眠，并在凌晨识别为当前区间', () => {
        const interval = getScheduleSlotInterval(normalDay[3]);
        expect(interval).toEqual({ start: 23 * 60, end: 31 * 60 });
        expect(isScheduleMinuteInInterval(4 * 60 + 7, interval!)).toBe(true);
    });

    it('普通生活系要求至少五小时总睡眠和连续主要睡眠段', () => {
        const result = validateGeneratedSchedule(normalDay);
        expect(result.valid).toBe(true);
        expect(result.sleepTotalMinutes).toBe(8 * 60);
        expect(result.maxContinuousSleepMinutes).toBe(8 * 60);
    });

    it('允许五小时总量由四小时主睡眠加一小时午睡组成', () => {
        const result = validateGeneratedSchedule([
            { startTime: '00:00', endTime: '04:00', activity: '主要睡眠', busyLevel: 'sleep' },
            { startTime: '09:00', endTime: '12:00', activity: '工作', busyLevel: 'busy' },
            { startTime: '14:00', endTime: '15:00', activity: '午睡', busyLevel: 'sleep' },
        ]);
        expect(result.valid).toBe(true);
        expect(result.sleepTotalMinutes).toBe(5 * 60);
        expect(result.maxContinuousSleepMinutes).toBe(4 * 60);
    });

    it('拒绝少于五小时的普通睡眠', () => {
        const result = validateGeneratedSchedule([
            { startTime: '00:00', endTime: '04:00', activity: '主要睡眠', busyLevel: 'sleep' },
            { startTime: '14:00', endTime: '14:59', activity: '午睡', busyLevel: 'sleep' },
        ]);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.includes('至少需要 300 分钟'))).toBe(true);
    });

    it('重叠或睡眠不足的新输出会被拒绝，但 no-sleep 是显式例外', () => {
        const overlapping = [
            ...normalDay,
            { startTime: '06:30', endTime: '07:30', activity: '临时训练', busyLevel: 'busy' as const },
        ];
        expect(validateGeneratedSchedule(overlapping).valid).toBe(false);

        const noSleep = validateGeneratedSchedule(
            normalDay.filter(slot => slot.busyLevel !== 'sleep'),
            { sleepMode: 'no-sleep' },
        );
        expect(noSleep.valid).toBe(true);
    });

    it('旧式缺 endTime 输出先补全，历史读取不需要迁移', () => {
        const filled = fillMissingScheduleEndTimes([
            { startTime: '08:00', activity: '训练' },
            { startTime: '10:00', activity: '工作' },
        ]);
        expect(filled.map(slot => slot.endTime)).toEqual(['10:00', '11:00']);
        expect(validateGeneratedSchedule(filled, { sleepMode: 'no-sleep' }).valid).toBe(true);
    });
});
