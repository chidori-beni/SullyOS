import type { CharacterProfile, MemoryFragment } from '../types';
import { addScheduleDateKey, getScheduleDateKey } from './scheduleTime';

/** 日度记忆日期 → `YYYY-MM`；兼容 `2026-09-05` / `2026/9/5` / `2026年9月5日`。 */
const memoryMonthKey = (raw: string): string => {
    let date = raw.replace(/[\/年月]/g, '-').replace('日', '');
    const parts = date.split('-');
    if (parts.length >= 2) date = `${parts[0]}-${parts[1].padStart(2, '0')}`;
    return date;
};

/** 日度记忆日期 → `YYYY-MM-DD`；读不出「日」时返回 null。 */
export const memoryDayKey = (raw: string): string | null => {
    const match = /(\d{4})\s*[-\/年]\s*(\d{1,2})\s*[-\/月]\s*(\d{1,2})/.exec(raw);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
};

/** 小眼睛「只发最近 N 天」的有效天数；未设置 / 非法值 = 0（整月）。 */
export const recentMemoryDaysOf = (char: Pick<CharacterProfile, 'recentMemoryDays'>): number => {
    const days = char.recentMemoryDays;
    return typeof days === 'number' && Number.isInteger(days) && days > 0 ? days : 0;
};

/**
 * 最近 N 天窗口的起点（含），按角色所在地的日历日算。整月模式返回 null。
 * 「今天」算第 1 天：N=7 → 今天 + 前 6 天。
 */
export const recentMemoryWindowStart = (
    char: Pick<CharacterProfile, 'recentMemoryDays' | 'customTimezoneEnabled' | 'customTimezone'>,
    base?: Date,
): string | null => {
    const days = recentMemoryDaysOf(char);
    if (!days) return null;
    return addScheduleDateKey(getScheduleDateKey(char, base), -(days - 1)) || null;
};

/** 按窗口过滤；读不出日期的条目保留（宁可多发，不悄悄丢）。 */
export const filterMemoriesInWindow = <T extends Pick<MemoryFragment, 'date'>>(entries: T[], windowStart: string | null): T[] => {
    if (!windowStart) return entries;
    return entries.filter(memory => {
        const day = memoryDayKey(memory.date);
        return day === null || day >= windowStart;
    });
};

/** Shared with the prompt renderer: closed eyes suppress daily logs, never monthly summaries. */
export function readableContextMemories(char: CharacterProfile, includeDetails = true, base?: Date) {
    const monthly = Object.entries(char.refinedMemories || {}).sort().map(([date, summary]) => ({ date, summary }));
    const windowStart = recentMemoryWindowStart(char, base);
    const daily = (includeDetails ? char.activeMemoryMonths || [] : []).map(month => ({
        month,
        entries: filterMemoriesInWindow(
            (char.memories || []).filter(memory => memoryMonthKey(memory.date).startsWith(month)),
            windowStart,
        ),
    }));
    return { monthly, daily };
}
