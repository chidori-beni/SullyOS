/**
 * 通话后台生成任务的环境无关契约。
 *
 * 浏览器只负责把通话现场的提示词快照交给 AMSG2，Worker 在页面冻结/关闭后继续生成，
 * 结果通过 message_outbox 回到浏览器。这里不能引入 DB、React 或任何浏览器 API，因为
 * 同一份文件会被打进 Cloudflare Worker bundle。
 */

import { AMSG_JOB_NAMESPACE } from './amsgTaskKinds';

export const CALL_BACKGROUND_REPLY_KIND = 'call-reply';
export const SLEEP_DREAM_KIND = 'sleep-dream';
export const CALL_BACKGROUND_REPLY_RESULT_KIND = 'call-reply';
export const SLEEP_DREAM_RESULT_KIND = 'sleep-dream';

export type CallBackgroundPhase = 'reply' | 'dream';
export type CallBackgroundMode = 'voice' | 'video';

export interface CallJobMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallJobInput {
  v: 1;
  charId: string;
  charName: string;
  sessionId: string;
  callMode: CallBackgroundMode;
  phase: CallBackgroundPhase;
  systemPrompt: string;
  messages: CallJobMessage[];
  /** 普通通话回复对应的那条用户消息 id；梦话没有。 */
  sourceUserMessageId?: number;
  /** 陪睡自动挂断时间。Worker 到点后不再生成梦话。 */
  autoHangupAt?: number | null;
  /** 只是防止同一个陪睡窗口的梦话任务互相覆盖，不参与业务判断。 */
  dreamIndex?: number;
  createdAt: number;
}

export interface CallJobResult {
  resultKind: typeof CALL_BACKGROUND_REPLY_RESULT_KIND | typeof SLEEP_DREAM_RESULT_KIND;
  v: 1;
  jobId: string;
  charId: string;
  charName: string;
  sessionId: string;
  callMode: CallBackgroundMode;
  phase: CallBackgroundPhase;
  text: string;
  generatedAt: number;
  sourceUserMessageId?: number;
  dreamIndex?: number;
}

export const callJobKey = (jobId: string): string => `call:${jobId}`;

export const callJobNamespace = AMSG_JOB_NAMESPACE;

const isMode = (value: unknown): value is CallBackgroundMode => value === 'voice' || value === 'video';
const isPhase = (value: unknown): value is CallBackgroundPhase => value === 'reply' || value === 'dream';

const parseMessages = (raw: unknown): CallJobMessage[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: CallJobMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (row.role !== 'system' && row.role !== 'user' && row.role !== 'assistant') return null;
    if (typeof row.content !== 'string') return null;
    messages.push({ role: row.role, content: row.content });
  }
  return messages;
};

const parsePositiveNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

/** 严格读 job；损坏的输入交给 Worker 丢弃，不拿半份上下文调用模型。 */
export const parseCallJobInput = (raw: unknown): CallJobInput | null => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const createdAt = parsePositiveNumber(row.createdAt);
  const messages = parseMessages(row.messages);
  if (row.v !== 1
    || typeof row.charId !== 'string' || !row.charId
    || typeof row.charName !== 'string' || !row.charName
    || typeof row.sessionId !== 'string' || !row.sessionId
    || !isMode(row.callMode) || !isPhase(row.phase)
    || typeof row.systemPrompt !== 'string' || !row.systemPrompt
    || !messages || !createdAt) return null;

  const sourceUserMessageId = typeof row.sourceUserMessageId === 'number'
    && Number.isSafeInteger(row.sourceUserMessageId) && row.sourceUserMessageId > 0
    ? row.sourceUserMessageId : undefined;
  const autoHangupAt = row.autoHangupAt == null
    ? null
    : parsePositiveNumber(row.autoHangupAt);
  if (row.autoHangupAt != null && autoHangupAt == null) return null;
  const dreamIndex = typeof row.dreamIndex === 'number'
    && Number.isSafeInteger(row.dreamIndex) && row.dreamIndex >= 0
    ? row.dreamIndex : undefined;

  return {
    v: 1,
    charId: row.charId,
    charName: row.charName,
    sessionId: row.sessionId,
    callMode: row.callMode,
    phase: row.phase,
    systemPrompt: row.systemPrompt,
    messages,
    ...(sourceUserMessageId ? { sourceUserMessageId } : {}),
    autoHangupAt,
    ...(dreamIndex !== undefined ? { dreamIndex } : {}),
    createdAt,
  };
};

export const parseCallJobResult = (raw: unknown): CallJobResult | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const isReply = row.resultKind === CALL_BACKGROUND_REPLY_RESULT_KIND && row.phase === 'reply';
  const isDream = row.resultKind === SLEEP_DREAM_RESULT_KIND && row.phase === 'dream';
  if (row.v !== 1 || (!isReply && !isDream)
    || typeof row.jobId !== 'string' || !row.jobId
    || typeof row.charId !== 'string' || !row.charId
    || typeof row.charName !== 'string'
    || typeof row.sessionId !== 'string' || !row.sessionId
    || !isMode(row.callMode)
    || typeof row.text !== 'string' || !row.text.trim()
    || typeof row.generatedAt !== 'number' || !Number.isFinite(row.generatedAt)) return null;
  const sourceUserMessageId = typeof row.sourceUserMessageId === 'number'
    && Number.isSafeInteger(row.sourceUserMessageId) && row.sourceUserMessageId > 0
    ? row.sourceUserMessageId : undefined;
  const dreamIndex = typeof row.dreamIndex === 'number'
    && Number.isSafeInteger(row.dreamIndex) && row.dreamIndex >= 0
    ? row.dreamIndex : undefined;
  const resultKind = (isDream ? SLEEP_DREAM_RESULT_KIND : CALL_BACKGROUND_REPLY_RESULT_KIND) as CallJobResult['resultKind'];
  const phase = (isDream ? 'dream' : 'reply') as CallBackgroundPhase;
  const callMode = row.callMode as CallBackgroundMode;
  return {
    resultKind,
    v: 1,
    jobId: row.jobId,
    charId: row.charId,
    charName: row.charName,
    sessionId: row.sessionId,
    callMode,
    phase,
    text: row.text.trim(),
    generatedAt: row.generatedAt,
    ...(sourceUserMessageId ? { sourceUserMessageId } : {}),
    ...(dreamIndex !== undefined ? { dreamIndex } : {}),
  };
};

export const buildCallJobResult = (args: {
  jobId: string;
  job: CallJobInput;
  text: string;
  generatedAt?: number;
}): CallJobResult => ({
  resultKind: args.job.phase === 'dream'
    ? SLEEP_DREAM_RESULT_KIND
    : CALL_BACKGROUND_REPLY_RESULT_KIND,
  v: 1,
  jobId: args.jobId,
  charId: args.job.charId,
  charName: args.job.charName,
  sessionId: args.job.sessionId,
  callMode: args.job.callMode,
  phase: args.job.phase,
  text: args.text.trim(),
  generatedAt: args.generatedAt || Date.now(),
  ...(args.job.sourceUserMessageId ? { sourceUserMessageId: args.job.sourceUserMessageId } : {}),
  ...(args.job.dreamIndex !== undefined ? { dreamIndex: args.job.dreamIndex } : {}),
});

export const buildCallJobMessages = (job: CallJobInput): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> => [
  { role: 'system', content: job.systemPrompt },
  ...job.messages,
];
