import type { CharacterProfile, ScheduleSlot } from '../types';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';
import {
    getCurrentScheduleSlotIndexForMinutes,
    getUpcomingScheduleSlotIndexForMinutes,
} from './scheduleClock';

type ScheduleCharacter = Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone'>;

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
