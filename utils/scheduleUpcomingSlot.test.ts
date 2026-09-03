import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '../types';
import {
    getCurrentScheduleSlotIndexForMinutes,
    getUpcomingScheduleSlotIndexForMinutes,
} from './scheduleClock';

// 用户实机那张表：补觉写了 endTime，12:00 之后到 13:30 之前是空档。
const slots: ScheduleSlot[] = [
    { startTime: '04:00', endTime: '05:30', activity: '晨跑与核心加练' },
    { startTime: '06:00', endTime: '12:00', activity: '强行补觉', busyLevel: 'sleep' },
    { startTime: '13:30', endTime: '17:00', activity: '赛道终期长测' },
    { startTime: '22:30', activity: '前往浦东机场' },
];

const at = (hour: number, minute = 0) => hour * 60 + minute;

describe('日程空档里的「接下来」', () => {
    it('空档期没有当前时段，但下一条应该是 13:30 而不是今天最早那条', () => {
        expect(getCurrentScheduleSlotIndexForMinutes(slots, at(12, 30))).toBe(-1);
        expect(getUpcomingScheduleSlotIndexForMinutes(slots, at(12, 30))).toBe(2);
    });

    it('有当前时段时，下一条仍然是紧接着的那条', () => {
        expect(getCurrentScheduleSlotIndexForMinutes(slots, at(11, 49))).toBe(1);
        expect(getUpcomingScheduleSlotIndexForMinutes(slots, at(11, 49))).toBe(2);
    });

    it('今天最早一条还没开始时指向它自己', () => {
        expect(getUpcomingScheduleSlotIndexForMinutes(slots, at(3, 0))).toBe(0);
    });

    it('最后一条之后没有下一条', () => {
        expect(getUpcomingScheduleSlotIndexForMinutes(slots, at(23, 30))).toBe(-1);
    });

    it('忽略时间写坏的格子', () => {
        const broken: ScheduleSlot[] = [
            { startTime: '晚点', activity: '？' },
            { startTime: '15:00', activity: '录音' },
        ];
        expect(getUpcomingScheduleSlotIndexForMinutes(broken, at(12, 0))).toBe(1);
    });
});

/**
 * 接线守卫：两个桌面日程卡（方图和宽卡）都必须走按时间找的「接下来」，
 * 否则空档期又会退回 `slots[currentIdx + 1]` 那种指回过去的写法。
 */
describe('日程卡接线', () => {
    const widget = fs.readFileSync(
        path.resolve(__dirname, '..', 'components/schedule/ScheduleHomeWidget.tsx'),
        'utf8',
    );

    it('两处 next 都用 getUpcomingScheduleSlotIndex', () => {
        expect(widget.match(/getUpcomingScheduleSlotIndex\(/g) || []).toHaveLength(2);
        expect(widget).not.toContain('slots[currentIdx + 1]');
    });
});
