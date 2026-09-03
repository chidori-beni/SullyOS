import { describe, expect, it } from 'vitest';
import { formatDateDividerLabel, localDayKey, shouldShowDateDivider } from './chatDateDivider';

// 本地时区的某几天。用 new Date(y,m,d,h) 构造，测试跟着跑测机器的时区走 ——
// 分隔线本来就是「设备本地的哪一天」，这正是要验的行为。
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

describe('localDayKey', () => {
  it('按本地时区给出年月日', () => {
    expect(localDayKey(at(2026, 9, 3, 14))).toBe('2026-09-03');
    expect(localDayKey(at(2026, 1, 5, 0, 1))).toBe('2026-01-05');
  });

  it('同一天的深夜和清晨是同一个 key', () => {
    expect(localDayKey(at(2026, 9, 3, 0, 5))).toBe(localDayKey(at(2026, 9, 3, 23, 55)));
  });

  it('坏时间戳不炸，返回空串（调用方据此不画分隔线）', () => {
    expect(localDayKey(Number.NaN)).toBe('');
  });
});

describe('shouldShowDateDivider', () => {
  it('第一条消息上方永远有分隔线', () => {
    expect(shouldShowDateDivider(at(2026, 9, 3), null)).toBe(true);
    expect(shouldShowDateDivider(at(2026, 9, 3), undefined)).toBe(true);
  });

  it('同一天的后续消息不再画', () => {
    expect(shouldShowDateDivider(at(2026, 9, 3, 15), at(2026, 9, 3, 9))).toBe(false);
  });

  it('跨天的第一条才画', () => {
    expect(shouldShowDateDivider(at(2026, 9, 4, 0, 3), at(2026, 9, 3, 23, 58))).toBe(true);
  });

  it('跨月跨年都算跨天', () => {
    expect(shouldShowDateDivider(at(2026, 10, 1), at(2026, 9, 30))).toBe(true);
    expect(shouldShowDateDivider(at(2027, 1, 1), at(2026, 12, 31))).toBe(true);
  });

  it('坏时间戳不画（宁可少一条线，也不画一条写着 Invalid Date 的）', () => {
    expect(shouldShowDateDivider(Number.NaN, at(2026, 9, 3))).toBe(false);
  });
});

describe('formatDateDividerLabel', () => {
  const now = at(2026, 9, 3, 16, 20);

  it('今天 / 昨天不带星期', () => {
    expect(formatDateDividerLabel(at(2026, 9, 3, 9), now)).toBe('今天');
    expect(formatDateDividerLabel(at(2026, 9, 2, 23), now)).toBe('昨天');
  });

  it('同年的更早日子带月日和星期', () => {
    // 2026-09-01 是星期二
    expect(formatDateDividerLabel(at(2026, 9, 1), now)).toBe('9月1日 · 星期二');
  });

  it('跨年补上年份', () => {
    // 2025-12-31 是星期三
    expect(formatDateDividerLabel(at(2025, 12, 31), now)).toBe('2025年12月31日 · 星期三');
  });

  it('跨月边界：上个月最后一天不会被误判成昨天', () => {
    const firstOfMonth = at(2026, 9, 1, 10);
    expect(formatDateDividerLabel(at(2026, 8, 31), firstOfMonth)).toBe('昨天');
    expect(formatDateDividerLabel(at(2026, 8, 30), firstOfMonth)).toBe('8月30日 · 星期日');
  });

  it('坏时间戳返回空串', () => {
    expect(formatDateDividerLabel(Number.NaN, now)).toBe('');
  });
});
