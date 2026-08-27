/**
 * 通话会话的同步生命周期哨兵。
 *
 * CallApp 会在挂断按钮刚被确认时先写入 ended 状态，再开始任何异步收尾。这样一来，
 * 仍在飞的文本请求、主动消息请求或 Worker 回调都能在落库前知道「这通电话已经结束」，
 * 不会把迟到的电话台词接到结束卡片后面。
 *
 * 这是文档级单例，只在当前 PWA document 内负责竞态收口；真正的历史事实仍以
 * IndexedDB 的 call-end-popup 为准。generation 用来识别「请求开始后发生过一次通话
 * 生命周期变化」，即使通话已经结束，也能丢弃那次请求的旧结果。
 */

const ENDED_TOMBSTONE_TTL_MS = 60 * 60 * 1000;

type ActiveCall = { charId: string; sessionId: string; startedAt: number };
type EndedCall = { charId: string; startedAt: number; endedAt: number };

const activeCalls = new Map<string, ActiveCall>();
const endedSessions = new Map<string, EndedCall>();
const generations = new Map<string, number>();
// IndexedDB writes are asynchronous. A late call reply can therefore pass its
// "live" check, start saveMessage, and only commit after finishCall has begun
// saving the end card. Serialize all call-scoped writes so the end card waits
// behind work that was already admitted, while work admitted after the tombstone
// is dropped before it reaches IndexedDB. The queue is per session and survives
// a CallApp remount during suspend/resume.
const sessionWriteQueues = new Map<string, Promise<void>>();

// A call can be ended while the user has not spoken in the final turn (for
// example by tapping Hang up immediately after the character finishes).  The
// chat boundary needs to tell the next normal-message generation whether this
// was an ordinary goodbye or an unexpected disappearance.  Keep this helper
// deliberately conservative: only an explicit farewell counts as a graceful
// ending; an empty transcript is therefore abrupt by definition.
const CALL_FAREWELL_RE = /(?:再见|拜拜|拜了|晚安|先这样(?:吧)?|那就这样(?:吧)?|先挂(?:了)?|挂了|挂电话|回头聊|回头见|下次聊|下次见|明天聊|待会儿聊|我先走|我先忙|不聊了|走了|bye|goodbye)/iu;

export type CallTranscriptItem = { role?: string; content?: unknown };

export const didCallEndAbruptly = (transcript: readonly CallTranscriptItem[]): boolean => {
  const lastUser = [...transcript].reverse().find(item => item.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content.trim() : '';
  return !text || !CALL_FAREWELL_RE.test(text);
};

const bumpGeneration = (charId: string): number => {
  const next = (generations.get(charId) || 0) + 1;
  generations.set(charId, next);
  return next;
};

const pruneEnded = (now = Date.now()): void => {
  for (const [sessionId, entry] of endedSessions) {
    if (now - entry.endedAt > ENDED_TOMBSTONE_TTL_MS) endedSessions.delete(sessionId);
  }
};

const dispatchLifecycleEvent = (type: 'started' | 'ended', detail: Record<string, unknown>): void => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(`sully-call-session-${type}`, { detail }));
  } catch {
    // 非浏览器测试环境没有 CustomEvent 时，内存哨兵仍然有效。
  }
};

/** 标记一通新电话开始。重复恢复同一 session 不增加第二份 active 状态。 */
export const startCallSession = (charId: string, sessionId: string, startedAt = Date.now()): void => {
  if (!charId || !sessionId) return;
  pruneEnded();
  const previous = activeCalls.get(charId);
  if (previous?.sessionId === sessionId) return;
  activeCalls.set(charId, { charId, sessionId, startedAt });
  endedSessions.delete(sessionId);
  const generation = bumpGeneration(charId);
  dispatchLifecycleEvent('started', { charId, sessionId, startedAt, generation });
};

/**
 * 在挂断确认的同步部分调用。即使后续 DB/取消 Worker 任务失败，旧异步请求也已被
 * generation / ended 闸门挡住；调用方可以放心继续做收尾。
 */
export const endCallSession = (charId: string, sessionId: string, endedAt = Date.now()): void => {
  if (!charId || !sessionId) return;
  pruneEnded(endedAt);
  const active = activeCalls.get(charId);
  if (active?.sessionId === sessionId) activeCalls.delete(charId);
  // 保留较新的结束时刻；finishCall 的重复调用不应把时间倒退。
  const previous = endedSessions.get(sessionId);
  endedSessions.set(sessionId, {
    charId,
    startedAt: active?.startedAt || previous?.startedAt || endedAt,
    endedAt: Math.max(previous?.endedAt || 0, endedAt),
  });
  const generation = bumpGeneration(charId);
  dispatchLifecycleEvent('ended', {
    charId,
    sessionId,
    endedAt: endedSessions.get(sessionId)!.endedAt,
    generation,
  });
};

export const isCallSessionEnded = (sessionId: string): boolean => {
  pruneEnded();
  return !!sessionId && endedSessions.has(sessionId);
};

/**
 * Serialize an IndexedDB write for one call session.
 *
 * Normal call writes are rejected after the synchronous end tombstone. The
 * end-card write passes `allowEnded: true`, so it is queued after any write that
 * had already started and becomes the final durable boundary for that session.
 * Rejections from an earlier write do not poison the queue; the caller still
 * receives its own error and the next operation can perform cleanup.
 */
export const enqueueCallSessionWrite = async <T>(
  sessionId: string,
  operation: () => Promise<T>,
  options: { allowEnded?: boolean } = {},
): Promise<T | null> => {
  if (!sessionId) return null;
  const previous = sessionWriteQueues.get(sessionId) || Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      if (!options.allowEnded && isCallSessionEnded(sessionId)) return null;
      return operation();
    });
  const settled = run.then(() => undefined, () => undefined);
  sessionWriteQueues.set(sessionId, settled);
  void settled.then(() => {
    if (sessionWriteQueues.get(sessionId) === settled) sessionWriteQueues.delete(sessionId);
  });
  return run;
};

export const isCallActiveForChar = (charId: string): boolean => !!charId && activeCalls.has(charId);

export const getActiveCallSessionId = (charId: string): string | null => activeCalls.get(charId)?.sessionId || null;

/** 当前或最近一通电话的时间窗，供主动消息收件箱丢弃通话期间迟到的推送。 */
export const getCallSessionWindowForChar = (charId: string): {
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
} | null => {
  const active = activeCalls.get(charId);
  if (active) return { sessionId: active.sessionId, startedAt: active.startedAt, endedAt: null };
  let latest: { sessionId: string; entry: EndedCall } | null = null;
  for (const [sessionId, entry] of endedSessions) {
    if (entry.charId !== charId) continue;
    if (!latest || entry.endedAt > latest.entry.endedAt) latest = { sessionId, entry };
  }
  return latest
    ? { sessionId: latest.sessionId, startedAt: latest.entry.startedAt, endedAt: latest.entry.endedAt }
    : null;
};

export const getCallLifecycleGeneration = (charId: string): number => generations.get(charId) || 0;

export const getCallSessionEndedAt = (sessionId: string): number | null => {
  pruneEnded();
  return endedSessions.get(sessionId)?.endedAt ?? null;
};

/** 仅供单测清理模块级状态，不由业务代码调用。 */
export const resetCallLifecycleForTests = (): void => {
  activeCalls.clear();
  endedSessions.clear();
  generations.clear();
  sessionWriteQueues.clear();
};
