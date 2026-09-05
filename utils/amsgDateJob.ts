/**
 * 见面普通回复的 AMSG2 后台任务契约。
 *
 * 这份文件刻意保持浏览器 / Worker 无关：浏览器负责保存 pending、调度和落库，
 * Worker 只负责校验快照、调用 LLM、把原始正文送回 result outbox。
 */

export const DATE_BACKGROUND_REPLY_KIND = 'date-reply';
export const DATE_BACKGROUND_REPLY_RESULT_KIND = 'date-reply';
export const DATE_BACKGROUND_JOB_SCHEMA_VERSION = 1;

export type DateBackgroundTurnKind = 'reply';
export type DateBackgroundMessageRole = 'system' | 'user' | 'assistant';

export interface DateBackgroundMessage {
  role: DateBackgroundMessageRole;
  content: string;
}

export interface DateBackgroundJobInput {
  v: typeof DATE_BACKGROUND_JOB_SCHEMA_VERSION;
  kind: typeof DATE_BACKGROUND_REPLY_KIND;
  turnKind: DateBackgroundTurnKind;
  clientJobId: string;
  charId: string;
  charName: string;
  encounterId: string;
  encounterStartedAt: number;
  sourceUserMessageId: number;
  sceneClockAt: number;
  sceneClockAdvancedMs: number;
  sceneClockRevision: number;
  messages: DateBackgroundMessage[];
  createdAt: number;
}

export interface DateBackgroundJobResult {
  v: typeof DATE_BACKGROUND_JOB_SCHEMA_VERSION;
  resultKind: typeof DATE_BACKGROUND_REPLY_RESULT_KIND;
  clientJobId: string;
  charId: string;
  charName: string;
  encounterId: string;
  encounterStartedAt: number;
  sourceUserMessageId: number;
  turnKind: DateBackgroundTurnKind;
  sceneClockAt: number;
  sceneClockAdvancedMs: number;
  sceneClockRevision: number;
  text: string;
  generatedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const isRole = (value: unknown): value is DateBackgroundMessageRole => (
  value === 'system' || value === 'user' || value === 'assistant'
);

const normalizeContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const item = part as Record<string, unknown>;
        return typeof item.text === 'string' ? item.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : String(content);
};

/** 只保留 Worker 能安全复现的文本消息，拒绝图片 Blob / base64 等不可持久资源。 */
export const normalizeDateBackgroundMessages = (
  messages: Array<{ role?: string; content?: unknown }>,
): DateBackgroundMessage[] => messages
  .filter((message): message is { role: DateBackgroundMessageRole; content?: unknown } => isRole(message?.role))
  .map((message) => ({ role: message.role, content: normalizeContent(message.content).trim() }))
  .filter((message) => !!message.content);

export const dateBackgroundJobKey = (clientJobId: string): string => `date:${clientJobId}`;

export const buildDateBackgroundJobInput = (args: {
  clientJobId: string;
  charId: string;
  charName: string;
  encounterId: string;
  encounterStartedAt: number;
  sourceUserMessageId: number;
  sceneClockAt: number;
  sceneClockAdvancedMs?: number;
  sceneClockRevision: number;
  messages: Array<{ role?: string; content?: unknown }>;
  createdAt?: number;
}): DateBackgroundJobInput => ({
  v: DATE_BACKGROUND_JOB_SCHEMA_VERSION,
  kind: DATE_BACKGROUND_REPLY_KIND,
  turnKind: 'reply',
  clientJobId: args.clientJobId,
  charId: args.charId,
  charName: args.charName,
  encounterId: args.encounterId,
  encounterStartedAt: args.encounterStartedAt,
  sourceUserMessageId: args.sourceUserMessageId,
  sceneClockAt: args.sceneClockAt,
  sceneClockAdvancedMs: Math.max(0, args.sceneClockAdvancedMs || 0),
  sceneClockRevision: Math.max(0, Math.floor(args.sceneClockRevision)),
  messages: normalizeDateBackgroundMessages(args.messages),
  createdAt: args.createdAt ?? Date.now(),
});

export const parseDateBackgroundJobInput = (value: unknown): DateBackgroundJobInput | null => {
  const raw = typeof value === 'string'
    ? (() => {
      try { return JSON.parse(value) as unknown; } catch { return null; }
    })()
    : value;
  if (!isRecord(raw)
    || raw.v !== DATE_BACKGROUND_JOB_SCHEMA_VERSION
    || raw.kind !== DATE_BACKGROUND_REPLY_KIND
    || raw.turnKind !== 'reply'
    || typeof raw.clientJobId !== 'string'
    || typeof raw.charId !== 'string'
    || typeof raw.charName !== 'string'
    || typeof raw.encounterId !== 'string'
    || !isFiniteNumber(raw.encounterStartedAt)
    || !Number.isInteger(raw.sourceUserMessageId)
    || !isFiniteNumber(raw.sceneClockAt)
    || !isFiniteNumber(raw.sceneClockAdvancedMs)
    || !Number.isInteger(raw.sceneClockRevision)
    || !isFiniteNumber(raw.createdAt)
    || !Array.isArray(raw.messages)
    || !raw.messages.length) return null;

  const messages = raw.messages.filter((message): message is Record<string, unknown> => isRecord(message));
  if (messages.length !== raw.messages.length) return null;
  const normalized = messages.map((message) => ({
    role: typeof message.role === 'string' ? message.role : undefined,
    content: message.content,
  }));
  const safeMessages = normalizeDateBackgroundMessages(normalized);
  if (safeMessages.length !== messages.length) return null;

  return {
    v: DATE_BACKGROUND_JOB_SCHEMA_VERSION,
    kind: DATE_BACKGROUND_REPLY_KIND,
    turnKind: 'reply',
    clientJobId: raw.clientJobId,
    charId: raw.charId,
    charName: raw.charName,
    encounterId: raw.encounterId,
    encounterStartedAt: raw.encounterStartedAt,
    sourceUserMessageId: raw.sourceUserMessageId as number,
    sceneClockAt: raw.sceneClockAt as number,
    sceneClockAdvancedMs: raw.sceneClockAdvancedMs as number,
    sceneClockRevision: raw.sceneClockRevision as number,
    messages: safeMessages,
    createdAt: raw.createdAt as number,
  };
};

export const buildDateBackgroundJobResult = (args: {
  job: DateBackgroundJobInput;
  text: string;
  generatedAt?: number;
}): DateBackgroundJobResult => ({
  v: DATE_BACKGROUND_JOB_SCHEMA_VERSION,
  resultKind: DATE_BACKGROUND_REPLY_RESULT_KIND,
  clientJobId: args.job.clientJobId,
  charId: args.job.charId,
  charName: args.job.charName,
  encounterId: args.job.encounterId,
  encounterStartedAt: args.job.encounterStartedAt,
  sourceUserMessageId: args.job.sourceUserMessageId,
  turnKind: args.job.turnKind,
  sceneClockAt: args.job.sceneClockAt,
  sceneClockAdvancedMs: args.job.sceneClockAdvancedMs,
  sceneClockRevision: args.job.sceneClockRevision,
  text: args.text,
  generatedAt: args.generatedAt ?? Date.now(),
});

export const parseDateBackgroundJobResult = (value: unknown): DateBackgroundJobResult | null => {
  if (!isRecord(value)
    || value.v !== DATE_BACKGROUND_JOB_SCHEMA_VERSION
    || value.resultKind !== DATE_BACKGROUND_REPLY_RESULT_KIND
    || typeof value.clientJobId !== 'string'
    || typeof value.charId !== 'string'
    || typeof value.charName !== 'string'
    || typeof value.encounterId !== 'string'
    || !isFiniteNumber(value.encounterStartedAt)
    || !Number.isInteger(value.sourceUserMessageId)
    || value.turnKind !== 'reply'
    || !isFiniteNumber(value.sceneClockAt)
    || !isFiniteNumber(value.sceneClockAdvancedMs)
    || !Number.isInteger(value.sceneClockRevision)
    || typeof value.text !== 'string'
    || !isFiniteNumber(value.generatedAt)) return null;
  return value as unknown as DateBackgroundJobResult;
};
