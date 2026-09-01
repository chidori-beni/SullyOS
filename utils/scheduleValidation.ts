import type { ScheduleSleepMode, ScheduleSlot } from '../types';
import {
    formatScheduleClockTime,
    getScheduleSlotInterval,
    parseScheduleClockTime,
} from './scheduleClock';

export interface ScheduleSleepPolicy {
    minTotalMinutes: number;
    maxTotalMinutes: number;
    minContinuousMinutes: number;
}

/** 普通人（包括运动员）不能因为职业忙就默认只睡三四个小时。 */
export const DEFAULT_SCHEDULE_SLEEP_POLICY: ScheduleSleepPolicy = {
    minTotalMinutes: 7 * 60,
    maxTotalMinutes: 9 * 60,
    minContinuousMinutes: 6 * 60 + 30,
};

export interface ScheduleValidationOptions {
    sleepMode?: ScheduleSleepMode;
    requireEndTime?: boolean;
    sleepPolicy?: ScheduleSleepPolicy;
}

export interface ScheduleValidationResult {
    valid: boolean;
    errors: string[];
    sleepTotalMinutes: number;
    maxContinuousSleepMinutes: number;
}

interface LinearInterval {
    start: number;
    end: number;
}

const splitInterval = (start: number, end: number): LinearInterval[] => {
    if (end <= 24 * 60) return [{ start, end }];
    return [
        { start, end: 24 * 60 },
        { start: 0, end: end - 24 * 60 },
    ];
};

const mergeIntervals = (intervals: LinearInterval[]): LinearInterval[] => {
    const sorted = intervals
        .filter(interval => interval.end > interval.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: LinearInterval[] = [];
    for (const interval of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || interval.start > previous.end) {
            merged.push({ ...interval });
        } else {
            previous.end = Math.max(previous.end, interval.end);
        }
    }
    return merged;
};

const getSleepContinuity = (intervals: LinearInterval[]): number => {
    const merged = mergeIntervals(intervals);
    if (merged.length === 0) return 0;
    let longest = Math.max(...merged.map(interval => interval.end - interval.start));
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (first.start === 0 && last.end === 24 * 60 && merged.length > 1) {
        longest = Math.max(longest, first.end + (24 * 60 - last.start));
    }
    return longest;
};

/**
 * 给旧模型输出补上缺省 endTime，避免历史兼容的“单点日程”继续让新校验失效。
 * 生成提示仍会要求模型直接输出 endTime；这里只是安全兜底，不改变已有合法值。
 */
export const fillMissingScheduleEndTimes = (slots: ScheduleSlot[]): ScheduleSlot[] => {
    const ordered = [...slots].sort((a, b) => (
        (parseScheduleClockTime(a.startTime) ?? Number.MAX_SAFE_INTEGER)
        - (parseScheduleClockTime(b.startTime) ?? Number.MAX_SAFE_INTEGER)
    ));
    return ordered.map((slot, index) => {
        if (typeof slot.endTime === 'string' && slot.endTime.trim()) return slot;
        const start = parseScheduleClockTime(slot.startTime);
        if (start == null) return slot;
        const nextStart = index < ordered.length - 1
            ? parseScheduleClockTime(ordered[index + 1].startTime)
            : null;
        let end = nextStart ?? (start + 60) % (24 * 60);
        if (end === start) end = (start + 60) % (24 * 60);
        return { ...slot, endTime: formatScheduleClockTime(end) };
    });
};

/**
 * 只用于本次新生成结果；旧缓存仍按旧读取逻辑兼容，不因历史缺 endTime 被拒绝。
 * 这里不根据活动名称判断“跑五公里是否现实”，只检查可验证的时间结构，避免误杀角色设定。
 */
export const validateGeneratedSchedule = (
    slots: ScheduleSlot[],
    options: ScheduleValidationOptions = {},
): ScheduleValidationResult => {
    const errors: string[] = [];
    const allIntervals: LinearInterval[] = [];
    const sleepIntervals: LinearInterval[] = [];
    const requireEndTime = options.requireEndTime !== false;

    for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const start = parseScheduleClockTime(slot.startTime);
        if (start == null) {
            errors.push(`第 ${index + 1} 项 startTime 无效`);
            continue;
        }
        if (requireEndTime && (!slot.endTime || !slot.endTime.trim())) {
            errors.push(`第 ${index + 1} 项缺少 endTime`);
        }
        const nextStart = index < slots.length - 1 ? slots[index + 1]?.startTime : undefined;
        const interval = getScheduleSlotInterval(slot, nextStart);
        if (!interval) {
            errors.push(`第 ${index + 1} 项时间区间无效或时长为零`);
            continue;
        }
        const pieces = splitInterval(interval.start, interval.end);
        allIntervals.push(...pieces);
        if (slot.busyLevel === 'sleep') sleepIntervals.push(...pieces);
    }

    const sortedAll = [...allIntervals].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < sortedAll.length; index += 1) {
        if (sortedAll[index].start < sortedAll[index - 1].end) {
            errors.push('日程时段存在重叠');
            break;
        }
    }

    const mergedSleep = mergeIntervals(sleepIntervals);
    const sleepTotalMinutes = mergedSleep.reduce((sum, interval) => sum + interval.end - interval.start, 0);
    const maxContinuousSleepMinutes = getSleepContinuity(sleepIntervals);
    if (options.sleepMode !== 'no-sleep') {
        const policy = options.sleepPolicy || DEFAULT_SCHEDULE_SLEEP_POLICY;
        if (sleepTotalMinutes < policy.minTotalMinutes) {
            errors.push(`正常睡眠总量不足（${sleepTotalMinutes} 分钟，至少需要 ${policy.minTotalMinutes} 分钟）`);
        }
        if (sleepTotalMinutes > policy.maxTotalMinutes) {
            errors.push(`正常睡眠总量过长（${sleepTotalMinutes} 分钟，最多建议 ${policy.maxTotalMinutes} 分钟）`);
        }
        if (maxContinuousSleepMinutes < policy.minContinuousMinutes) {
            errors.push(`缺少连续的主要睡眠段（最长仅 ${maxContinuousSleepMinutes} 分钟）`);
        }
    }

    return {
        valid: errors.length === 0,
        errors: [...new Set(errors)],
        sleepTotalMinutes,
        maxContinuousSleepMinutes,
    };
};
