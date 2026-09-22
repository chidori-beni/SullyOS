/**
 * 【临时排查代码 · 定位后整份删除】
 *
 * 现象：用户在东京（设备 UTC+9），角色萧逸开着自定义时区 Asia/Shanghai（UTC+8）。
 * 日程表第一条写 `02:00 沉睡休整`，本该在东京 03:00 才生效，实际东京 02:00 一到
 * 就收到「[自动回复]睡了」——表现得像是拿设备的钟去对角色的表。
 *
 * 但 utils/scheduleContext.ts → utils/busyAutoReply.ts 这条链（含线上已部署的那份
 * bundle，逐句比对过）读的都是角色墙钟，日程卡右上角的时钟也确实显示北京时间。
 * 静态读码已经走到头，缺的是运行时那几个中间值：当时用的哪张表、那张表每条的
 * 结束时间是几点、命中的是第几条、它以为角色当地几点。
 *
 * 所以把这些值直接贴在自动回复正文后面（iOS 上看不了 console）。定位完删掉本文件
 * 与 hooks/useChatAI.ts 里唯一的那个调用点即可，不影响任何其他逻辑。
 */

import type { DailySchedule, ScheduleSlot } from '../types';
import type { ScheduleContextSnapshot } from './scheduleContext';

const pad2 = (value: number): string => value.toString().padStart(2, '0');

const clockOf = (date: Date): string => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const dateOf = (date: Date): string =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** 一条时段写成 `02:00→10:30`；没写结束时间的写成 `02:00→(空)`，这正是界面看不见的部分。 */
const slotBrief = (slot: ScheduleSlot): string =>
    `${slot.startTime}→${slot.endTime ?? '(空)'}`;

/**
 * 生成贴在自动回复后面的那行诊断。
 *
 * `deviceNow` 是设备墙钟，`context.wallClock` 是程序认为的角色墙钟——两者摆在一起，
 * 一眼就能看出时差有没有被算进去。
 */
export const buildBusyAutoReplyDiagnostic = (
    context: ScheduleContextSnapshot,
    schedule: DailySchedule | null,
    slot: ScheduleSlot,
): string => {
    const deviceNow = new Date(context.instant.getTime());
    const slots = schedule?.slots ?? [];
    const total = slots.length;
    const index = context.currentSlotIndex;
    const generatedAt = Number.isFinite(schedule?.generatedAt)
        ? new Date(schedule!.generatedAt)
        : null;

    const parts = [
        `设备 ${dateOf(deviceNow)} ${clockOf(deviceNow)}`,
        `角色 ${context.timeZone ?? '(跟随设备)'} ${dateOf(context.wallClock)} ${clockOf(context.wallClock)}`,
        `表 ${schedule?.date ?? '(无)'}${generatedAt ? `（生成于 ${dateOf(generatedAt)} ${clockOf(generatedAt)}，按设备时区读）` : ''}`,
        `命中第 ${index >= 0 ? index + 1 : '?'}/${total} 条 ${slotBrief(slot)} ${slot.busyLevel ?? '(无)'}`,
        `全表 ${slots.map(slotBrief).join(' | ') || '(空)'}`,
    ];

    return `\n（诊断·排查用｜${parts.join(' · ')}）`;
};
