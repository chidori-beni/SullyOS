// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildSlowFlushText,
  reportSlowFlush,
  startFlushTimer,
  SLOW_FLUSH_TIMING_EVENT,
  SLOW_FLUSH_TOAST_MS,
  SLOW_FLUSH_SEGMENT_FLOOR_MS,
} from './slowFlushProbe';

describe('buildSlowFlushText', () => {
  it('不慢就不报（这是「修好之后自动闭嘴」的依据）', () => {
    expect(buildSlowFlushText([['角色', 100], ['近史', 200]])).toBeNull();
  });

  it('刚好卡在阈值下沿不报，够到阈值才报', () => {
    expect(buildSlowFlushText([['近史', SLOW_FLUSH_TOAST_MS - 1]])).toBeNull();
    expect(buildSlowFlushText([['近史', SLOW_FLUSH_TOAST_MS]])).not.toBeNull();
  });

  it('总耗时算的是各段之和，文案里带总数', () => {
    const text = buildSlowFlushText([['角色', 1200], ['近史', 900]]);
    expect(text).toContain('2.1s');
  });

  it('只列大头，碎段不进文案（省得一屏读不完）', () => {
    const text = buildSlowFlushText([
      ['角色', 1800],
      ['重试检查', SLOW_FLUSH_SEGMENT_FLOOR_MS - 1],
      ['近史', 600],
    ]);
    expect(text).toContain('角色 1.8');
    expect(text).toContain('近史 0.6');
    expect(text).not.toContain('重试检查');
  });

  it('全是碎段但总数够慢时，仍然报总数（不能因为没大头就沉默）', () => {
    const segments = Array.from({ length: 20 }, (_, i) => [`第${i}步`, 100] as [string, number]);
    const text = buildSlowFlushText(segments);
    expect(text).toContain('2.0s');
  });

  it('空输入不报，也不抛', () => {
    expect(buildSlowFlushText([])).toBeNull();
  });
});

describe('reportSlowFlush', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('慢的时候派发事件，detail 里带现成文案', () => {
    const seen: string[] = [];
    const handler = (e: Event) => { seen.push((e as CustomEvent).detail?.text); };
    window.addEventListener(SLOW_FLUSH_TIMING_EVENT, handler);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    reportSlowFlush([['角色', 2000]]);
    window.removeEventListener(SLOW_FLUSH_TIMING_EVENT, handler);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('上屏 2.0s');
  });

  it('不慢的时候一个事件都不发', () => {
    const seen: string[] = [];
    const handler = () => { seen.push('x'); };
    window.addEventListener(SLOW_FLUSH_TIMING_EVENT, handler);
    reportSlowFlush([['角色', 10]]);
    window.removeEventListener(SLOW_FLUSH_TIMING_EVENT, handler);
    expect(seen).toHaveLength(0);
  });
});

describe('startFlushTimer', () => {
  it('mark 记的是「离上一次 mark 过了多久」，且顺序保持', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { mark, segments } = startFlushTimer();
    now.mockReturnValue(1_300);
    mark('角色');
    now.mockReturnValue(1_900);
    mark('近史');
    now.mockRestore();
    expect(segments).toEqual([['角色', 300], ['近史', 600]]);
  });
});
