import type { CharacterProfile, ScheduleSlot } from '../types';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';

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

/** 按角色所在地的当前时间，找到已经开始的最后一条日程。 */
export const getCurrentScheduleSlotIndex = (
    slots: ScheduleSlot[],
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): number => {
    const now = getScheduleWallClock(char, base);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (value?: string): number | null => {
        if (!value) return null;
        const [h, m] = value.split(':').map(Number);
        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    };
    for (let i = 0; i < slots.length; i++) {
        const start = toMinutes(slots[i].startTime);
        if (start == null || currentMinutes < start) continue;
        const nextStart = i < slots.length - 1 ? toMinutes(slots[i + 1].startTime) : null;
        const end = toMinutes(slots[i].endTime) ?? nextStart ?? 24 * 60;
        if (end > start && currentMinutes < end) return i;
    }
    return -1;
};
