import type { AvatarPerformanceCue, AvatarPerformanceDirection } from './avatarPerformance';

/**
 * 逐拍动作编排的纯编辑逻辑：从 at 区间反切文字、找可拆分点、拆分与合并、
 * 算本拍可用时间窗。开机台词和触摸台词共用同一套，行为必须一致。
 *
 * 这里不碰 React 状态，也不认识具体是哪一条台词——只吃「基准串 + 拍数组」。
 */

/** 手动拆分后一句可以对应多拍；上限取句子表上限（12）的两倍。 */
export const MAX_PERFORMANCE_CUES = 24;

/** 收尾姿势至少要留 60ms 才看得出来，这是 expandAvatarPerformanceCueBeats 的硬下限。 */
const MIN_VISIBLE_HOLD_MS = 120;

/** 本拍内部允许切开的停顿标点。句号级的标点由自动断句负责，不在这里出现。 */
const SPLIT_PUNCTUATION = /[，,、…—]/;
const SPLIT_PUNCTUATION_RUN = /[，,、…—\s]/;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cueAt = (cues: readonly AvatarPerformanceCue[], index: number): number => {
  const value = Number(cues[index]?.at);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (index <= 0 ? 0 : 1);
};

/** 下一拍的起点；最后一拍吃到结尾。 */
const nextCueAt = (cues: readonly AvatarPerformanceCue[], index: number): number => (
  index + 1 < cues.length ? cueAt(cues, index + 1) : 1
);

/**
 * 这一拍对应的台词片段。
 *
 * 必须按 at 区间反切，不能按下标去查句子表：手动拆分后拍数会多于句数，
 * 按下标取会让第 2 拍之后的标签全部错位。
 */
export const cueTextAt = (
  baseText: string,
  cues: readonly AvatarPerformanceCue[],
  index: number,
): string => {
  const text = baseText || '';
  const total = Math.max(1, text.length);
  const from = Math.round(cueAt(cues, index) * total);
  const to = Math.round(nextCueAt(cues, index) * total);
  return text.slice(from, Math.max(from, to)).trim();
};

export interface CuePerformanceSplitPoint {
  at: number;
  before: string;
  after: string;
}

/**
 * 这一拍内部可以切开的位置。自动断句只认句号级标点，一句里的逗号切不开，
 * 而「前半句一个表情、后半句另一个」正是最常见的需求。
 */
export const cueSplitPoints = (
  baseText: string,
  cues: readonly AvatarPerformanceCue[],
  index: number,
  limit = 4,
): CuePerformanceSplitPoint[] => {
  const cueText = cueTextAt(baseText, cues, index);
  if (!cues[index] || cueText.length < 4) return [];
  const total = Math.max(1, (baseText || '').length);
  const start = cueAt(cues, index);
  const end = nextCueAt(cues, index);
  const cueStart = Math.round(start * total);
  const points: CuePerformanceSplitPoint[] = [];
  const seen = new Set<number>();
  for (let offset = 0; offset < cueText.length - 1; offset += 1) {
    if (!SPLIT_PUNCTUATION.test(cueText[offset])) continue;
    // 连续标点（……、——）整体跳过，切点落在它们后面。
    let cut = offset + 1;
    while (cut < cueText.length && SPLIT_PUNCTUATION_RUN.test(cueText[cut])) cut += 1;
    if (cut >= cueText.length) break;
    const before = cueText.slice(0, cut).trim();
    const after = cueText.slice(cut).trim();
    offset = cut - 1;
    if (!before || !after) continue;
    const at = Math.min(0.98, Math.max(0, (cueStart + cut) / total));
    // 切点必须落在本拍内部，且不能和相邻拍挤在几乎同一时刻。
    if (at <= start + 0.002 || at >= end - 0.002) continue;
    const key = Math.round(at * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ at, before, after });
    if (points.length >= limit) break;
  }
  return points;
};

export const canSplitPerformanceCues = (cues: readonly AvatarPerformanceCue[]): boolean => (
  cues.length < MAX_PERFORMANCE_CUES
);

/**
 * 在 at 处把一拍切成两拍。后半拍继承前半拍的收尾姿势，所以切完画面不跳；
 * holdMs 对半分，两拍各自还有可见的中段。at 不在本拍内部时原样返回。
 */
export const splitPerformanceCueAt = (
  cues: readonly AvatarPerformanceCue[],
  index: number,
  at: number,
): AvatarPerformanceCue[] => {
  const source = cues[index];
  if (!source || !canSplitPerformanceCues(cues)) return [...cues];
  const start = cueAt(cues, index);
  const end = nextCueAt(cues, index);
  if (!(at > start) || !(at < end)) return [...cues];
  const carried = source.endDirection || source.direction;
  const half = Math.max(MIN_VISIBLE_HOLD_MS, Math.round((source.holdMs ?? 900) / 2));
  const head: AvatarPerformanceCue = { ...source, holdMs: half };
  const tail: AvatarPerformanceCue = {
    at,
    direction: clone(carried),
    endDirection: clone(source.endDirection || carried),
    holdMs: half,
  };
  return [...cues.slice(0, index), head, tail, ...cues.slice(index + 1)];
};

/** 把一拍并回上一拍：保留上一拍的起始姿势和本拍的收尾姿势，holdMs 相加。 */
export const mergePerformanceCueIntoPrevious = (
  cues: readonly AvatarPerformanceCue[],
  index: number,
): AvatarPerformanceCue[] => {
  const previous = cues[index - 1];
  const current = cues[index];
  if (!previous || !current) return [...cues];
  const merged: AvatarPerformanceCue = {
    ...previous,
    endDirection: current.endDirection || previous.endDirection,
    holdMs: Math.min(5_000, (previous.holdMs ?? 900) + (current.holdMs ?? 900)),
  };
  return [...cues.slice(0, index - 1), merged, ...cues.slice(index + 1)];
};

/** 本拍可用的时间窗：（下一拍起点 − 本拍起点）× 整句时长。 */
export const cueWindowMs = (
  cues: readonly AvatarPerformanceCue[],
  index: number,
  durationMs: number,
): number => {
  if (!cues[index]) return 0;
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return Math.max(0, Math.round((nextCueAt(cues, index) - cueAt(cues, index)) * duration));
};

/** 推荐的中段保持：窗口的 70%，窗口太窄时返回 0 表示「没法给建议」。 */
export const recommendedHoldMs = (windowMs: number): number => (
  windowMs >= 140 ? Math.max(MIN_VISIBLE_HOLD_MS, Math.min(5_000, Math.round(windowMs * 0.7))) : 0
);

/** 取这一拍当前正在编辑的那一相（起始 / 收尾）的姿势。 */
export const cueDirectionForPhase = (
  cue: AvatarPerformanceCue | undefined,
  phase: 'start' | 'end',
  fallback: AvatarPerformanceDirection,
): AvatarPerformanceDirection => {
  if (!cue) return fallback;
  if (phase === 'end') return cue.endDirection || cue.direction || fallback;
  return cue.direction || fallback;
};

/** 就地改写某一拍某一相的姿势，其余拍原样保留。 */
export const patchCueDirection = (
  cues: readonly AvatarPerformanceCue[],
  index: number,
  phase: 'start' | 'end',
  patch: Partial<AvatarPerformanceDirection>,
): AvatarPerformanceCue[] => cues.map((cue, cueIndex) => {
  if (cueIndex !== index) return cue;
  if (phase === 'end') {
    return { ...cue, endDirection: { ...(cue.endDirection || cue.direction), ...patch } };
  }
  return { ...cue, direction: { ...cue.direction, ...patch } };
});
