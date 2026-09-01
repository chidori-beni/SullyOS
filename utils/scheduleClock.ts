import type { ScheduleSlot } from '../types';

/** 日程时间使用角色当地的墙上时钟；end 可以用 00:00 表示午夜。 */
export const parseScheduleClockTime = (value: unknown, allowEndOfDay = false): number | null => {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (allowEndOfDay && hour === 24 && minute === 0) return 24 * 60;
    if (hour < 0 || hour > 23) return null;
    return hour * 60 + minute;
};

export const formatScheduleClockTime = (minutes: number): string => {
    const normalized = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${Math.floor(normalized / 60).toString().padStart(2, '0')}:${(normalized % 60).toString().padStart(2, '0')}`;
};

export interface ScheduleSlotInterval {
    /** start is always within the first calendar day; end may extend into the next day. */
    start: number;
    end: number;
}

/**
 * 将一条日程解析成半开区间 [start, end)。
 *
 * - endTime 缺省时用调用方提供的下一条 startTime；再缺省则延续到当天结束；
 * - endTime 小于 startTime 时按跨午夜处理；23:00–00:00 是一小时，不是零时长；
 * - 非法或零时长区间返回 null。
 */
export const getScheduleSlotInterval = (
    slot: Pick<ScheduleSlot, 'startTime' | 'endTime'>,
    fallbackEndTime?: string,
): ScheduleSlotInterval | null => {
    const start = parseScheduleClockTime(slot.startTime);
    if (start == null) return null;

    let end: number | null;
    if (slot.endTime !== undefined) {
        end = parseScheduleClockTime(slot.endTime, true);
    } else if (fallbackEndTime !== undefined) {
        end = parseScheduleClockTime(fallbackEndTime, true);
    } else {
        end = 24 * 60;
    }
    if (end == null) return null;

    // 00:00 after an evening start means the coming midnight.  For any other
    // end before start, roll the end into the following calendar day.
    if (end === 0 && start > 0) end = 24 * 60;
    else if (end < start) end += 24 * 60;
    if (end <= start || end - start > 24 * 60) return null;
    return { start, end };
};

export const isScheduleMinuteInInterval = (
    minuteOfDay: number,
    interval: ScheduleSlotInterval,
): boolean => {
    const minute = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minuteOfDay)));
    if (interval.end <= 24 * 60) return minute >= interval.start && minute < interval.end;
    return minute >= interval.start || minute < interval.end - 24 * 60;
};

export type ScheduleSlotTemporalState = 'upcoming' | 'current' | 'past';

/** 用于卡片灰度和其他前台展示，尤其修正跨午夜 slot 的“未来项被标成已过”。 */
export const getScheduleSlotTemporalState = (
    slots: ScheduleSlot[],
    index: number,
    minuteOfDay: number,
): ScheduleSlotTemporalState => {
    const slot = slots[index];
    if (!slot) return 'upcoming';
    const nextStart = index < slots.length - 1 ? slots[index + 1]?.startTime : undefined;
    const interval = getScheduleSlotInterval(slot, nextStart);
    if (!interval) return 'upcoming';
    if (isScheduleMinuteInInterval(minuteOfDay, interval)) return 'current';
    // For an overnight interval, its start is later today.  Before that start
    // it is still upcoming, including the early-morning carry-over case.
    if (interval.end > 24 * 60) return 'upcoming';
    return minuteOfDay < interval.start ? 'upcoming' : 'past';
};

/** 找到当前墙钟落入的日程；调用方已负责把绝对时刻折成角色当地分钟。 */
export const getCurrentScheduleSlotIndexForMinutes = (
    slots: ScheduleSlot[],
    minuteOfDay: number,
): number => {
    for (let index = 0; index < slots.length; index += 1) {
        const nextStart = index < slots.length - 1 ? slots[index + 1]?.startTime : undefined;
        const interval = getScheduleSlotInterval(slots[index], nextStart);
        if (interval && isScheduleMinuteInInterval(minuteOfDay, interval)) return index;
    }
    return -1;
};
