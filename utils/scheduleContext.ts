import type { CharacterProfile, DailySchedule, ScheduleSlot } from '../types';
import { resolveScheduleSlots, type ResolvedScheduleSlots } from './scheduleInjection';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';

export type ScheduleContextCharacter = Pick<
    CharacterProfile,
    'customTimezoneEnabled' | 'customTimezone'
>;

/**
 * 一轮聊天共用的角色时间/日程快照。
 *
 * `instant` 是真实的绝对时刻；`wallClock` 只用于读取角色所在地的小时、分钟等
 * 日程字段。两者同时保留，避免把角色墙钟伪 Date 当成真实时间戳继续向下传。
 */
export interface ScheduleContextSnapshot {
    instant: Date;
    wallClock: Date;
    timeZone?: string;
    localDateKey: string;
    hour: number;
    minute: number;
    minuteOfDay: number;
    schedule: DailySchedule | null;
    current: ScheduleSlot | null;
    next: ScheduleSlot | null;
    currentSlotIndex: number;
}

/**
 * 以同一个绝对时刻计算角色当地的日历日、墙钟和当前日程。
 * `schedule` 应当是用同一个 `instant` 读取的角色当地日程。
 */
export const createScheduleContextSnapshot = (
    char: ScheduleContextCharacter,
    schedule: DailySchedule | null,
    instant: Date = new Date(),
): ScheduleContextSnapshot => {
    const baseInstant = new Date(instant.getTime());
    const timeZone = resolveCharTimeZone(char);
    const wallClock = nowInTimeZone(timeZone, baseInstant);
    const resolved: ResolvedScheduleSlots = resolveScheduleSlots(schedule, wallClock);
    const currentSlotIndex = resolved.current && schedule
        ? schedule.slots.indexOf(resolved.current)
        : -1;

    return {
        instant: baseInstant,
        wallClock,
        timeZone,
        localDateKey: getLocalDateKey(wallClock),
        hour: wallClock.getHours(),
        minute: wallClock.getMinutes(),
        minuteOfDay: wallClock.getHours() * 60 + wallClock.getMinutes(),
        schedule,
        current: resolved.current,
        next: resolved.next,
        currentSlotIndex,
    };
};
