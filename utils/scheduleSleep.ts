/**
 * 「角色此刻是不是真的在睡觉」的唯一判定。
 *
 * 零运行时依赖（只 import type + scheduleClock 这个纯叶子），浏览器与 Cloudflare Worker
 * 共用同一份：前台聊天的日程注入、主动消息到点渲染、自然主动的发不发都读它。
 *
 * 为什么要单独立一份：以前只有 `busyLevel === 'sleep'` 这个散落各处的字面量判断，
 * 「睡了多久 / 还要睡多久」谁都没算过。自然主动因此完全看不见睡眠——表上写着 06:00
 * 补觉到 13:30，它照旧每十几分钟考虑一次要不要联系，角色于是睡两个小时就爬起来发消息。
 */

import type { ScheduleSlot } from '../types';
import { getScheduleSlotInterval, isScheduleMinuteInInterval } from './scheduleClock';

/** 日程里代表「在睡觉」的忙碌程度。 */
export const SLEEP_BUSY_LEVEL = 'sleep';

export const isSleepSlot = (slot: Pick<ScheduleSlot, 'busyLevel'> | null | undefined): boolean =>
    slot?.busyLevel === SLEEP_BUSY_LEVEL;

export interface ScheduleSleepState {
    /** 已经睡了大约多少分钟。 */
    sleptMinutes: number;
    /** 按这条日程还要睡大约多少分钟（到点自然醒的距离）。 */
    remainingMinutes: number;
    /** 这一觉整段有多长。 */
    totalMinutes: number;
}

/**
 * 当前时刻落在一条睡眠日程里的话，算出「睡了多久 / 还剩多久」；否则返回 null。
 *
 * `slots` 必须是渲染用的那份原始顺序表（跟 resolveScheduleSlots 同一份），因为一条
 * 日程的结束时刻常常要靠下一条的开始时刻兜底。跨午夜的睡眠（23:30 → 07:00）由
 * getScheduleSlotInterval 折成 [1410, 1860) 处理，这里跟着把当前分钟折进同一条时间轴。
 */
export const resolveScheduleSleepState = (
    slots: ScheduleSlot[] | null | undefined,
    now: Date,
): ScheduleSleepState | null => {
    if (!slots?.length) return null;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const nextStart = index < slots.length - 1 ? slots[index + 1]?.startTime : undefined;
        const interval = getScheduleSlotInterval(slot, nextStart);
        if (!interval || !isScheduleMinuteInInterval(currentMinutes, interval)) continue;
        if (!isSleepSlot(slot)) return null;
        // 跨午夜时 end 已经加了一天；此刻若在午夜之后，当前分钟也要挪到同一条轴上，
        // 否则 07:00 醒来的那一觉会算出「还要睡 -1410 分钟」。
        const minutes = interval.end > 24 * 60 && currentMinutes < interval.end - 24 * 60
            ? currentMinutes + 24 * 60
            : currentMinutes;
        const total = interval.end - interval.start;
        const slept = Math.max(0, Math.min(total, minutes - interval.start));
        return {
            sleptMinutes: slept,
            remainingMinutes: Math.max(0, total - slept),
            totalMinutes: total,
        };
    }
    return null;
};
