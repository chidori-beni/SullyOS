import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SLEEP_DREAM_CHANCE,
  SLEEP_DREAM_MAX_COUNT,
  SLEEP_DREAM_INSTRUCTION,
  SLEEP_LULLABY_INSTRUCTION,
  loadSleepAutoHangupMinutes,
  planSleepDreams,
  saveSleepAutoHangupMinutes,
  shouldFireSleepDream,
  shouldScheduleNextSleepDreamCheck,
} from './sleepCompanion';

afterEach(() => vi.unstubAllGlobals());

describe('shouldFireSleepDream', () => {
  it('开关关闭时永远不触发，不管概率和次数', () => {
    expect(shouldFireSleepDream(0, false, 0)).toBe(false);
    expect(shouldFireSleepDream(0, false, 0.99)).toBe(false);
  });

  it('roll 落在概率区间内才触发', () => {
    expect(shouldFireSleepDream(0, true, 0)).toBe(true);
    expect(shouldFireSleepDream(0, true, SLEEP_DREAM_CHANCE - 0.0001)).toBe(true);
    expect(shouldFireSleepDream(0, true, SLEEP_DREAM_CHANCE)).toBe(false);
    expect(shouldFireSleepDream(0, true, 0.9)).toBe(false);
  });

  it('达到整夜上限后即使概率命中也不再触发', () => {
    expect(shouldFireSleepDream(SLEEP_DREAM_MAX_COUNT, true, 0)).toBe(false);
    expect(shouldFireSleepDream(SLEEP_DREAM_MAX_COUNT + 1, true, 0)).toBe(false);
  });

  it('上限前一次仍然正常判定', () => {
    expect(shouldFireSleepDream(SLEEP_DREAM_MAX_COUNT - 1, true, 0)).toBe(true);
  });
});

describe('shouldScheduleNextSleepDreamCheck', () => {
  it('开关开着且没到上限就继续排下一次检查', () => {
    expect(shouldScheduleNextSleepDreamCheck(0, true)).toBe(true);
    expect(shouldScheduleNextSleepDreamCheck(SLEEP_DREAM_MAX_COUNT - 1, true)).toBe(true);
  });

  it('到上限或开关关闭就不用再排了（省得白等一小时什么也不做）', () => {
    expect(shouldScheduleNextSleepDreamCheck(SLEEP_DREAM_MAX_COUNT, true)).toBe(false);
    expect(shouldScheduleNextSleepDreamCheck(0, false)).toBe(false);
  });
});

describe('陪睡指令文案', () => {
  it('哄睡指令不包含 emotion 标签或动作标签教学（复用通话已有的语音规则，不重复教）', () => {
    expect(SLEEP_LULLABY_INSTRUCTION).not.toMatch(/emotion=/);
    expect(SLEEP_LULLABY_INSTRUCTION).not.toMatch(/\[happy\]/);
  });

  it('梦话指令明确要求极短，避免真的写成一整段清醒对话', () => {
    expect(SLEEP_DREAM_INSTRUCTION).toContain('一两句');
  });

  it('两条指令都是括号包起来的旁白格式，和通话里 fireIdleNudge 的写法一致', () => {
    expect(SLEEP_LULLABY_INSTRUCTION.startsWith('（')).toBe(true);
    expect(SLEEP_LULLABY_INSTRUCTION.endsWith('）')).toBe(true);
    expect(SLEEP_DREAM_INSTRUCTION.startsWith('（')).toBe(true);
    expect(SLEEP_DREAM_INSTRUCTION.endsWith('）')).toBe(true);
  });
});

describe('定时挂断分钟数持久化', () => {
  it('没存过时默认 0（不自动挂断）', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(loadSleepAutoHangupMinutes()).toBe(0);
  });

  it('存了多少读回来就是多少', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    saveSleepAutoHangupMinutes(120);
    expect(loadSleepAutoHangupMinutes()).toBe(120);
  });

  it('存负数 / 小数会被夹到合法的非负整数', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    saveSleepAutoHangupMinutes(-5);
    expect(loadSleepAutoHangupMinutes()).toBe(0);
    saveSleepAutoHangupMinutes(45.9);
    expect(loadSleepAutoHangupMinutes()).toBe(45);
  });

  it('localStorage 坏掉（隐私模式）时读写都不抛异常', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(() => saveSleepAutoHangupMinutes(60)).not.toThrow();
    expect(loadSleepAutoHangupMinutes()).toBe(0);
  });
});

describe('planSleepDreams（梦话排期）', () => {
  const MIN = 60 * 1000;
  const start = 1_000_000_000_000;

  it('不挂断时第一句必出，落在入睡后 45～90 分钟', () => {
    for (const r of [0, 0.3, 0.999]) {
      const plan = planSleepDreams(start, null, () => r);
      expect(plan[0].dreamIndex).toBe(0);
      expect(plan[0].dueAt).toBeGreaterThanOrEqual(start + 45 * MIN);
      expect(plan[0].dueAt).toBeLessThanOrEqual(start + 90 * MIN);
    }
  });

  it('运气好时一夜三句，都在 4 小时内（用户半夜醒之前）', () => {
    const plan = planSleepDreams(start, null, () => 0);
    expect(plan).toHaveLength(3);
    plan.forEach(slot => expect(slot.dueAt).toBeLessThanOrEqual(start + 240 * MIN));
  });

  it('定时挂断之后的时段不排；30 分钟挂断也会在后半段塞一句', () => {
    const plan = planSleepDreams(start, start + 30 * MIN, () => 0.5);
    expect(plan).toHaveLength(1);
    expect(plan[0].dueAt).toBeGreaterThan(start + 14 * MIN);
    expect(plan[0].dueAt).toBeLessThan(start + 27 * MIN);
  });

  it('挂断太短（不到 20 分钟）就不排梦话', () => {
    expect(planSleepDreams(start, start + 10 * MIN, () => 0)).toEqual([]);
  });
});
