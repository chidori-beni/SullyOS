/**
 * 即时对话多段 push 的轻微节奏控制。
 *
 * Worker 会把一轮较长回复拆成多个 content push。它们在客户端虽然已经串行落库，
 * 但每个 push 都会把自己当成「这一轮的第一条气泡」，于是第一条免延迟规则会让
 * 多个气泡挤在同一帧出现。这里仅提供纯函数；真正的等待状态留在 activeMsgRuntime
 * 内存里，不写数据库，也不影响离线补收。
 */

/** 同一 session 的相邻 content push 至少留出的可见间隔。 */
export const INSTANT_CHUNK_PACING_MS = 1_000;

export interface InstantChunkPacingMessage {
  source?: unknown;
  messageType?: unknown;
  sessionId?: unknown;
  receivedAt?: unknown;
  metadata?: Record<string, unknown> | null;
}

const readMetaNumber = (message: InstantChunkPacingMessage, key: string): number => {
  const topLevel = (message as Record<string, unknown>)[key];
  const nested = message.metadata?.[key];
  const value = topLevel ?? nested;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const getInstantChunkSessionId = (
  message: InstantChunkPacingMessage,
): string | null => {
  const topLevel = message.sessionId;
  const nested = message.metadata?.sessionId;
  const value = topLevel ?? nested;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const getInstantChunkIndex = (message: InstantChunkPacingMessage): number =>
  Math.max(0, Math.floor(readMetaNumber(message, 'messageIndex')));

/**
 * 算出还需等待的毫秒数。传 null 表示该 session 尚未展示过首段。
 * 单独导出方便测试，不让测试依赖真实 timer。
 */
export const getInstantChunkPacingDelay = (
  lastShownAt: number | null,
  nowMs: number,
  pacingMs = INSTANT_CHUNK_PACING_MS,
): number => {
  if (lastShownAt == null || !Number.isFinite(lastShownAt)) return 0;
  if (!Number.isFinite(nowMs)) return 0;
  return Math.max(0, lastShownAt + pacingMs - nowMs);
};
