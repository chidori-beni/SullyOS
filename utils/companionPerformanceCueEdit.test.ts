import { describe, expect, it } from 'vitest';
import type { AvatarPerformanceCue, AvatarPerformanceDirection } from './avatarPerformance';
import {
  MAX_PERFORMANCE_CUES,
  canSplitPerformanceCues,
  cueSplitPoints,
  cueTextAt,
  cueWindowMs,
  mergePerformanceCueIntoPrevious,
  patchCueDirection,
  recommendedHoldMs,
  splitPerformanceCueAt,
} from './companionPerformanceCueEdit';

const direction = (emotion: AvatarPerformanceDirection['emotion']): AvatarPerformanceDirection => ({
  emotion,
  gesture: 'talk',
  camera: 'medium',
  gaze: 'viewer',
  intensity: 0.7,
});

// 「早啊。」= 3 字，其后是第二句。
const LINE = '早啊。大早上头发乱翘着就跑过来看我，这么离不开我？';
const twoBeats = (): AvatarPerformanceCue[] => [
  { at: 0, direction: direction('calm'), endDirection: direction('happy'), holdMs: 1000 },
  { at: 3 / LINE.length, direction: direction('happy'), endDirection: direction('surprised'), holdMs: 3000 },
];

describe('cueTextAt', () => {
  it('slices each beat out of the base text by its at range', () => {
    const cues = twoBeats();
    expect(cueTextAt(LINE, cues, 0)).toBe('早啊。');
    expect(cueTextAt(LINE, cues, 1)).toBe('大早上头发乱翘着就跑过来看我，这么离不开我？');
  });

  it('stays correct after a split makes beats outnumber sentences', () => {
    const cues = twoBeats();
    const point = cueSplitPoints(LINE, cues, 1)[0];
    const split = splitPerformanceCueAt(cues, 1, point.at);
    expect(split).toHaveLength(3);
    expect(cueTextAt(LINE, split, 0)).toBe('早啊。');
    expect(cueTextAt(LINE, split, 1)).toBe('大早上头发乱翘着就跑过来看我，');
    expect(cueTextAt(LINE, split, 2)).toBe('这么离不开我？');
  });
});

describe('cueSplitPoints', () => {
  it('offers the comma inside a beat, with both halves shown', () => {
    const points = cueSplitPoints(LINE, twoBeats(), 1);
    expect(points).toHaveLength(1);
    expect(points[0].before).toBe('大早上头发乱翘着就跑过来看我，');
    expect(points[0].after).toBe('这么离不开我？');
  });

  it('returns nothing for a beat without pause punctuation', () => {
    expect(cueSplitPoints(LINE, twoBeats(), 0)).toEqual([]);
  });

  it('treats a run of punctuation as one cut and never splits at the very end', () => {
    const text = '我知道……你不用说了，真的。';
    const cues: AvatarPerformanceCue[] = [{ at: 0, direction: direction('sad') }];
    const points = cueSplitPoints(text, cues, 0);
    // 「……」整体跳过，切点落在它后面；句尾的「。」不产生切点。
    expect(points.map(point => point.before)).toEqual(['我知道……', '我知道……你不用说了，']);
    expect(points.every(point => point.after.length > 0)).toBe(true);
  });

  it('caps how many cut points it offers', () => {
    const text = 'a，b，c，d，e，f，g，h';
    const cues: AvatarPerformanceCue[] = [{ at: 0, direction: direction('calm') }];
    expect(cueSplitPoints(text, cues, 0).length).toBeLessThanOrEqual(4);
  });
});

describe('splitPerformanceCueAt', () => {
  it('carries the closing pose into the new beat so nothing jumps', () => {
    const cues = twoBeats();
    const at = cueSplitPoints(LINE, cues, 1)[0].at;
    const split = splitPerformanceCueAt(cues, 1, at);
    // 后半拍的起始 = 前半拍的收尾。
    expect(split[2].direction.emotion).toBe('surprised');
    expect(split[1].endDirection?.emotion).toBe('surprised');
    // holdMs 对半分，两拍都还有可见的中段。
    expect(split[1].holdMs).toBe(1500);
    expect(split[2].holdMs).toBe(1500);
  });

  it('deep-copies so editing the new beat cannot mutate the old one', () => {
    const cues = twoBeats();
    const at = cueSplitPoints(LINE, cues, 1)[0].at;
    const split = splitPerformanceCueAt(cues, 1, at);
    const patched = patchCueDirection(split, 2, 'start', { emotion: 'angry' });
    expect(patched[2].direction.emotion).toBe('angry');
    expect(patched[1].endDirection?.emotion).toBe('surprised');
  });

  it('refuses a cut outside the beat and refuses to pass the cue ceiling', () => {
    const cues = twoBeats();
    expect(splitPerformanceCueAt(cues, 0, 0.9)).toHaveLength(2);
    expect(splitPerformanceCueAt(cues, 0, 0)).toHaveLength(2);
    const full = Array.from({ length: MAX_PERFORMANCE_CUES }, (_, index): AvatarPerformanceCue => ({
      at: index / MAX_PERFORMANCE_CUES,
      direction: direction('calm'),
    }));
    expect(canSplitPerformanceCues(full)).toBe(false);
    expect(splitPerformanceCueAt(full, 0, 0.01)).toHaveLength(MAX_PERFORMANCE_CUES);
  });
});

describe('mergePerformanceCueIntoPrevious', () => {
  it('keeps the earlier opening pose and the later closing pose', () => {
    const merged = mergePerformanceCueIntoPrevious(twoBeats(), 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].direction.emotion).toBe('calm');
    expect(merged[0].endDirection?.emotion).toBe('surprised');
    expect(merged[0].holdMs).toBe(4000);
  });

  it('is a no-op on the first beat', () => {
    expect(mergePerformanceCueIntoPrevious(twoBeats(), 0)).toHaveLength(2);
  });

  it('round-trips with a split', () => {
    const cues = twoBeats();
    const at = cueSplitPoints(LINE, cues, 1)[0].at;
    const merged = mergePerformanceCueIntoPrevious(splitPerformanceCueAt(cues, 1, at), 2);
    expect(merged).toHaveLength(2);
    expect(cueTextAt(LINE, merged, 1)).toBe('大早上头发乱翘着就跑过来看我，这么离不开我？');
  });
});

describe('cueWindowMs / recommendedHoldMs', () => {
  it('splits the duration across beats and recommends 70% of the window', () => {
    const cues = twoBeats();
    expect(cueWindowMs(cues, 0, 10_000)).toBe(1200);
    expect(cueWindowMs(cues, 1, 10_000)).toBe(8800);
    expect(recommendedHoldMs(8800)).toBe(5_000);
    expect(recommendedHoldMs(1200)).toBe(840);
  });

  it('gives no recommendation for a window too short to show a closing pose', () => {
    expect(recommendedHoldMs(100)).toBe(0);
    expect(cueWindowMs(cues0(), 0, Number.NaN)).toBe(0);
  });

  const cues0 = (): AvatarPerformanceCue[] => [{ at: 0, direction: direction('calm') }];
});
