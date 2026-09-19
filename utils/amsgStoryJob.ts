/**
 * 见面·剧情模式的 AMSG2 后台任务契约。
 *
 * 浏览器把完整的剧情 prompt 快照放进加密的 amsg:job 状态，Worker 只负责调用
 * LLM 并把正文送回 result outbox。正文最终仍由浏览器写入本地 IndexedDB。
 */

export const STORY_BACKGROUND_REPLY_KIND = 'story-reply';
export const STORY_BACKGROUND_REPLY_RESULT_KIND = 'story-reply';
export const STORY_BACKGROUND_JOB_SCHEMA_VERSION = 1;

export type StoryBackgroundTurnKind = 'opening' | 'advance' | 'continue' | 'retry' | 'reroll';
export type StoryBackgroundOperation = 'append' | 'replace';
export type StoryBackgroundMessageRole = 'system' | 'user' | 'assistant';

export interface StoryBackgroundMessage {
  role: StoryBackgroundMessageRole;
  content: string;
}

export interface StoryBackgroundAffinityInput {
  characterId?: string;
  characterName?: string;
  delta: number;
  reason: string;
  awareness?: 'noticed' | 'unnoticed';
}

export interface StoryBackgroundMirrorTarget {
  charId: string;
  /** 剧情创建时为该角色指定的现实时间锚点。 */
  anchorAt?: number;
  /** 用于复现 memoryTimestampForCharacter 的剧情创建时间。 */
  entryCreatedAt: number;
}

export interface StoryBackgroundJobInput {
  v: typeof STORY_BACKGROUND_JOB_SCHEMA_VERSION;
  kind: typeof STORY_BACKGROUND_REPLY_KIND;
  clientJobId: string;
  storyId: string;
  storyTitle: string;
  threadId: string;
  /** Worker 任务 metadata 里的 charId；剧情用自己的 threadId 串行，不占角色聊天队列。 */
  charId: string;
  primaryCharId: string;
  primaryCharName: string;
  markerMessageId: number;
  operation: StoryBackgroundOperation;
  turnKind: StoryBackgroundTurnKind;
  sourceUserMessageId?: number;
  targetAssistantMessageId?: number;
  expectedTailId?: number;
  expectedTailRole?: StoryBackgroundMessageRole;
  expectedTailFingerprint?: string;
  targetAssistantFingerprint?: string;
  targetMirrorIds?: Record<string, number>;
  messages: StoryBackgroundMessage[];
  assistantPrefill: string;
  promptTokenEstimate: number;
  affinityInputs?: StoryBackgroundAffinityInput[];
  mirrorTargets: StoryBackgroundMirrorTarget[];
  temperature?: number;
  maxTokens?: number;
  /** 仅允许传递剧情预设使用的三个高级采样字段。 */
  extraBody?: {
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
  };
  createdAt: number;
}

export interface StoryBackgroundJobResult extends Omit<StoryBackgroundJobInput, 'messages'> {
  resultKind: typeof STORY_BACKGROUND_REPLY_RESULT_KIND;
  text: string;
  generatedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const isRole = (value: unknown): value is StoryBackgroundMessageRole => (
  value === 'system' || value === 'user' || value === 'assistant'
);

const isTurnKind = (value: unknown): value is StoryBackgroundTurnKind => (
  value === 'opening'
    || value === 'advance'
    || value === 'continue'
    || value === 'retry'
    || value === 'reroll'
);

const isOperation = (value: unknown): value is StoryBackgroundOperation => (
  value === 'append' || value === 'replace'
);

const normalizeContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (!part || typeof part !== 'object') return '';
      const item = part as Record<string, unknown>;
      return typeof item.text === 'string' ? item.text : '';
    }).filter(Boolean).join('\n');
  }
  return content == null ? '' : String(content);
};

export const normalizeStoryBackgroundMessages = (
  messages: Array<{ role?: string; content?: unknown }>,
): StoryBackgroundMessage[] => messages
  .filter((message): message is { role: StoryBackgroundMessageRole; content?: unknown } => isRole(message?.role))
  .map(message => ({ role: message.role, content: normalizeContent(message.content).trim() }))
  .filter(message => !!message.content);

const normalizeAffinityInputs = (value: unknown): StoryBackgroundAffinityInput[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap(item => {
    if (!isRecord(item)) return [];
    const delta = Math.max(-100, Math.min(100, Math.round(Number(item.delta) || 0)));
    const reason = String(item.reason || '').trim().slice(0, 200);
    if (delta === 0 && !reason) return [];
    return [{
      ...(typeof item.characterId === 'string' ? { characterId: item.characterId.slice(0, 200) } : {}),
      ...(typeof item.characterName === 'string' ? { characterName: item.characterName.slice(0, 200) } : {}),
      delta,
      reason,
      awareness: item.awareness === 'noticed' ? 'noticed' as const : 'unnoticed' as const,
    }];
  });
  return rows.length > 0 ? rows : undefined;
};

const normalizeExtraBody = (value: unknown): StoryBackgroundJobInput['extraBody'] | undefined => {
  if (!isRecord(value)) return undefined;
  const extra: NonNullable<StoryBackgroundJobInput['extraBody']> = {};
  for (const key of ['top_p', 'frequency_penalty', 'presence_penalty'] as const) {
    if (isFiniteNumber(value[key])) extra[key] = value[key];
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
};

const normalizeMirrorTargets = (value: unknown): StoryBackgroundMirrorTarget[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.charId !== 'string' || !item.charId || !isFiniteNumber(item.entryCreatedAt)) return [];
    return [{
      charId: item.charId,
      ...(isFiniteNumber(item.anchorAt) ? { anchorAt: item.anchorAt } : {}),
      entryCreatedAt: item.entryCreatedAt,
    }];
  });
};

const normalizeTargetMirrorIds = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (Number.isInteger(raw) && Number(raw) > 0) result[key] = Number(raw);
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

export const storyBackgroundJobKey = (clientJobId: string): string => `story:${clientJobId}`;

export const buildStoryBackgroundJobInput = (args: {
  clientJobId: string;
  storyId: string;
  storyTitle: string;
  threadId: string;
  primaryCharId: string;
  primaryCharName: string;
  markerMessageId: number;
  operation: StoryBackgroundOperation;
  turnKind: StoryBackgroundTurnKind;
  sourceUserMessageId?: number;
  targetAssistantMessageId?: number;
  expectedTailId?: number;
  expectedTailRole?: StoryBackgroundMessageRole;
  expectedTailFingerprint?: string;
  targetAssistantFingerprint?: string;
  targetMirrorIds?: Record<string, number>;
  messages: Array<{ role?: string; content?: unknown }>;
  assistantPrefill?: string;
  promptTokenEstimate: number;
  affinityInputs?: StoryBackgroundAffinityInput[];
  mirrorTargets?: StoryBackgroundMirrorTarget[];
  temperature?: number;
  maxTokens?: number;
  extraBody?: Record<string, unknown>;
  createdAt?: number;
}): StoryBackgroundJobInput => ({
  v: STORY_BACKGROUND_JOB_SCHEMA_VERSION,
  kind: STORY_BACKGROUND_REPLY_KIND,
  clientJobId: args.clientJobId,
  storyId: args.storyId,
  storyTitle: args.storyTitle,
  threadId: args.threadId,
  charId: args.threadId,
  primaryCharId: args.primaryCharId,
  primaryCharName: args.primaryCharName,
  markerMessageId: args.markerMessageId,
  operation: args.operation,
  turnKind: args.turnKind,
  ...(Number.isInteger(args.sourceUserMessageId) && args.sourceUserMessageId! > 0 ? { sourceUserMessageId: args.sourceUserMessageId } : {}),
  ...(Number.isInteger(args.targetAssistantMessageId) && args.targetAssistantMessageId! > 0 ? { targetAssistantMessageId: args.targetAssistantMessageId } : {}),
  ...(Number.isInteger(args.expectedTailId) && args.expectedTailId! > 0 ? { expectedTailId: args.expectedTailId } : {}),
  ...(args.expectedTailRole ? { expectedTailRole: args.expectedTailRole } : {}),
  ...(args.expectedTailFingerprint ? { expectedTailFingerprint: args.expectedTailFingerprint } : {}),
  ...(args.targetAssistantFingerprint ? { targetAssistantFingerprint: args.targetAssistantFingerprint } : {}),
  ...(args.targetMirrorIds ? { targetMirrorIds: args.targetMirrorIds } : {}),
  messages: normalizeStoryBackgroundMessages(args.messages),
  assistantPrefill: String(args.assistantPrefill || '').trim(),
  promptTokenEstimate: Math.max(0, Math.floor(args.promptTokenEstimate || 0)),
  ...(args.affinityInputs?.length ? { affinityInputs: args.affinityInputs } : {}),
  mirrorTargets: args.mirrorTargets || [],
  ...(isFiniteNumber(args.temperature) ? { temperature: args.temperature } : {}),
  ...(Number.isFinite(args.maxTokens) && (args.maxTokens || 0) > 0 ? { maxTokens: Math.floor(args.maxTokens!) } : {}),
  ...(normalizeExtraBody(args.extraBody) ? { extraBody: normalizeExtraBody(args.extraBody) } : {}),
  createdAt: args.createdAt ?? Date.now(),
});

const parseJobLike = (value: unknown, requireMessages = true): StoryBackgroundJobInput | null => {
  const raw = typeof value === 'string'
    ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })()
    : value;
  if (!isRecord(raw)
    || raw.v !== STORY_BACKGROUND_JOB_SCHEMA_VERSION
    || raw.kind !== STORY_BACKGROUND_REPLY_KIND
    || typeof raw.clientJobId !== 'string' || !raw.clientJobId
    || typeof raw.storyId !== 'string' || !raw.storyId
    || typeof raw.storyTitle !== 'string'
    || typeof raw.threadId !== 'string' || !raw.threadId
    || raw.charId !== raw.threadId
    || typeof raw.primaryCharId !== 'string' || !raw.primaryCharId
    || typeof raw.primaryCharName !== 'string'
    || !Number.isInteger(raw.markerMessageId) || Number(raw.markerMessageId) <= 0
    || !isOperation(raw.operation)
    || !isTurnKind(raw.turnKind)
    || !Array.isArray(raw.messages) || (requireMessages && raw.messages.length === 0)
    || typeof raw.assistantPrefill !== 'string'
    || !isFiniteNumber(raw.promptTokenEstimate)
    || !isFiniteNumber(raw.createdAt)) return null;

  const messages = raw.messages.filter(isRecord).map(message => ({
    role: typeof message.role === 'string' ? message.role : undefined,
    content: message.content,
  }));
  if (messages.length !== raw.messages.length) return null;
  const safeMessages = normalizeStoryBackgroundMessages(messages);
  if (requireMessages && safeMessages.length !== messages.length) return null;
  const mirrorTargets = normalizeMirrorTargets(raw.mirrorTargets);
  if (mirrorTargets.length !== (Array.isArray(raw.mirrorTargets) ? raw.mirrorTargets.length : 0)) return null;
  if (raw.operation === 'replace' && (!Number.isInteger(raw.targetAssistantMessageId) || !raw.targetAssistantFingerprint)) return null;

  return {
    v: STORY_BACKGROUND_JOB_SCHEMA_VERSION,
    kind: STORY_BACKGROUND_REPLY_KIND,
    clientJobId: raw.clientJobId,
    storyId: raw.storyId,
    storyTitle: raw.storyTitle,
    threadId: raw.threadId,
    charId: raw.threadId,
    primaryCharId: raw.primaryCharId,
    primaryCharName: raw.primaryCharName,
    markerMessageId: raw.markerMessageId as number,
    operation: raw.operation,
    turnKind: raw.turnKind,
    ...(Number.isInteger(raw.sourceUserMessageId) ? { sourceUserMessageId: raw.sourceUserMessageId as number } : {}),
    ...(Number.isInteger(raw.targetAssistantMessageId) ? { targetAssistantMessageId: raw.targetAssistantMessageId as number } : {}),
    ...(Number.isInteger(raw.expectedTailId) ? { expectedTailId: raw.expectedTailId as number } : {}),
    ...(isRole(raw.expectedTailRole) ? { expectedTailRole: raw.expectedTailRole } : {}),
    ...(typeof raw.expectedTailFingerprint === 'string' ? { expectedTailFingerprint: raw.expectedTailFingerprint } : {}),
    ...(typeof raw.targetAssistantFingerprint === 'string' ? { targetAssistantFingerprint: raw.targetAssistantFingerprint } : {}),
    ...(normalizeTargetMirrorIds(raw.targetMirrorIds) ? { targetMirrorIds: normalizeTargetMirrorIds(raw.targetMirrorIds) } : {}),
    messages: safeMessages,
    assistantPrefill: raw.assistantPrefill,
    promptTokenEstimate: raw.promptTokenEstimate,
    ...(normalizeAffinityInputs(raw.affinityInputs) ? { affinityInputs: normalizeAffinityInputs(raw.affinityInputs) } : {}),
    mirrorTargets,
    ...(isFiniteNumber(raw.temperature) ? { temperature: raw.temperature } : {}),
    ...(Number.isFinite(raw.maxTokens) && Number(raw.maxTokens) > 0 ? { maxTokens: Math.floor(Number(raw.maxTokens)) } : {}),
    ...(normalizeExtraBody(raw.extraBody) ? { extraBody: normalizeExtraBody(raw.extraBody) } : {}),
    createdAt: raw.createdAt,
  };
};

export const parseStoryBackgroundJobInput = (value: unknown): StoryBackgroundJobInput | null => parseJobLike(value);

export const buildStoryBackgroundJobResult = (args: {
  job: StoryBackgroundJobInput;
  text: string;
  generatedAt?: number;
}): StoryBackgroundJobResult => {
  const { messages: _messages, ...job } = args.job;
  return {
    ...job,
    resultKind: STORY_BACKGROUND_REPLY_RESULT_KIND,
    text: args.text,
    generatedAt: args.generatedAt ?? Date.now(),
  };
};

export const parseStoryBackgroundJobResult = (value: unknown): StoryBackgroundJobResult | null => {
  if (!isRecord(value)
    || value.v !== STORY_BACKGROUND_JOB_SCHEMA_VERSION
    || value.resultKind !== STORY_BACKGROUND_REPLY_RESULT_KIND
    || typeof value.text !== 'string'
    || !isFiniteNumber(value.generatedAt)) return null;
  const job = parseJobLike({
    ...value,
    kind: STORY_BACKGROUND_REPLY_KIND,
    // 结果不重复携带完整 prompt；这里的占位只用于复用输入契约的字段校验。
    messages: [{ role: 'system', content: 'result' }],
  }, false);
  if (!job) return null;
  const { messages: _messages, ...resultBase } = job;
  return {
    ...resultBase,
    resultKind: STORY_BACKGROUND_REPLY_RESULT_KIND,
    text: value.text,
    generatedAt: value.generatedAt,
  };
};
