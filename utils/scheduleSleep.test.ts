import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '../types';
import { isSleepSlot, resolveScheduleSleepState } from './scheduleSleep';

const slot = (startTime: string, endTime: string | undefined, busyLevel: ScheduleSlot['busyLevel'], activity = '活动'): ScheduleSlot => ({
  startTime,
  ...(endTime ? { endTime } : {}),
  activity,
  busyLevel,
} as ScheduleSlot);

// 用户实测那天的表：04:00 晨跑 → 06:00 强行补觉 → 13:30 赛道长测。
const daySlots: ScheduleSlot[] = [
  slot('04:00', '06:00', 'busy', '晨跑'),
  slot('06:00', '13:30', 'sleep', '强行补觉'),
  slot('13:30', '17:30', 'busy', '赛道终期长测'),
];

const at = (hour: number, minute = 0) => new Date(2026, 8, 3, hour, minute);

describe('日程睡眠判定', () => {
  it('睡到一半时算得出睡了多久、还要睡多久', () => {
    const state = resolveScheduleSleepState(daySlots, at(8, 4));
    expect(state).toEqual({ sleptMinutes: 124, remainingMinutes: 326, totalMinutes: 450 });
  });

  it('不在睡眠时段（含刚醒那一刻）返回 null', () => {
    expect(resolveScheduleSleepState(daySlots, at(5))).toBeNull();
    expect(resolveScheduleSleepState(daySlots, at(13, 30))).toBeNull();
    expect(resolveScheduleSleepState(null, at(8))).toBeNull();
    expect(resolveScheduleSleepState([], at(8))).toBeNull();
  });

  it('跨午夜的一觉在凌晨也算得对，不会算出负的剩余时间', () => {
    const overnight = [slot('20:00', '23:30', 'free', '晚间语音'), slot('23:30', '07:00', 'sleep', '睡觉')];
    expect(resolveScheduleSleepState(overnight, at(23, 45))).toEqual({
      sleptMinutes: 15, remainingMinutes: 435, totalMinutes: 450,
    });
    expect(resolveScheduleSleepState(overnight, at(6, 30))).toEqual({
      sleptMinutes: 420, remainingMinutes: 30, totalMinutes: 450,
    });
  });

  it('isSleepSlot 只认 busyLevel=sleep', () => {
    expect(isSleepSlot(daySlots[1])).toBe(true);
    expect(isSleepSlot(daySlots[0])).toBe(false);
    expect(isSleepSlot(null)).toBe(false);
  });
});
