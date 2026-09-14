import type { CharacterProfile, ScheduleSlot } from '../types';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';
import {
    getCurrentScheduleSlotIndexForMinutes,
    getUpcomingScheduleSlotIndexForMinutes,
} from './scheduleClock';

type ScheduleCharacter = Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone'>;

const SCHEDULE_DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 只对 YYYY-MM-DD 做日历运算，不把角色墙钟 pseudo-Date 当成真实时间戳。
 * 用 UTC 承载“日期”本身，避免设备时区或夏令时影响前后一天的结果。
 */
export const addScheduleDateKey = (dateKey: string, days: number): string => {
    const match = SCHEDULE_DATE_KEY_RE.exec(dateKey.trim());
    if (!match || !Number.isInteger(days)) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) return '';
    date.setUTCDate(date.getUTCDate() + days);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

/** 角色当地日期 key 对应的星期；返回 0-6（周日到周六）。 */
export const getScheduleWeekdayForDateKey = (dateKey: string): number | null => {
    const match = SCHEDULE_DATE_KEY_RE.exec(dateKey.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) return null;
    return date.getUTCDay();
};

/** 当前绝对时刻 → 角色所在地的墙上时间；未启用自定义时区时跟随设备。 */
export const getScheduleWallClock = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): Date => nowInTimeZone(resolveCharTimeZone(char), base);

/** 角色所在地的日历日 key。 */
export const getScheduleDateKey = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): string => getLocalDateKey(getScheduleWallClock(char, base));

/** 按角色所在地的当前时间，找到还没开始的第一条日程；空档期也能给出「接下来」。 */
export const getUpcomingScheduleSlotIndex = (
    slots: ScheduleSlot[],
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): number => {
    const now = getScheduleWallClock(char, base);
    return getUpcomingScheduleSlotIndexForMinutes(
        slots,
        now.getHours() * 60 + now.getMinutes(),
    );
};

/** 按角色所在地的当前时间，找到已经开始的最后一条日程。 */
export const getCurrentScheduleSlotIndex = (
    slots: ScheduleSlot[],
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): number => {
    const now = getScheduleWallClock(char, base);
    return getCurrentScheduleSlotIndexForMinutes(
        slots,
        now.getHours() * 60 + now.getMinutes(),
    );
};
