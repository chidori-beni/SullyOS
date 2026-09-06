/**
 * 浏览器侧的见面后台回复桥。
 *
 * pending 只放 localStorage 做恢复索引，真正的结果仍以 IndexedDB messages 为准；
 * Worker 结果可能通过 push 和 outbox 各到一次，所以落库按 clientJobId 去重。
 */

import type { APIConfig, CharacterProfile, DateEncounterPresence, Message } from '../types';
import { DB } from './db';
import { getActiveDatePresence, makeDateEncounterPresence, setActiveDatePresence } from './datePresence';
import {
  ActiveMsgClient,
  mayHaveCreatedBackgroundJob,
  type BackgroundJobProbeOutcome,
} from './activeMsgClient';
import { buildCharInstantCredRow, type LlmCredentialRow } from './amsgLlmCredentials';
import {
  DATE_BACKGROUND_REPLY_KIND,
  buildDateBackgroundJobInput,
  dateBackgroundJobKey,
  parseDateBackgroundJobInput,
  parseDateBackgroundJobResult,
  type DateBackgroundJobInput,
  type DateBackgroundJobResult,
} from './amsgDateJob';
import { stripFaceToFacePhoneSourceTags } from './sanitize';
import { stripMessageReactionTags } from './messageReactions';
import { extractObservation } from './datePrompts';
import { resolveDialogueSceneClock } from './dateObservationClock';

const PENDING_KEY = 'sully-date-background-jobs-v1';
const MAX_PENDING = 8;
const HEADER = '[date-background]';
const MAX_JOB_JSON_CHARS = 1_500_000;

export interface PendingDateBackgroundJob {
  jobId: string;
  input: DateBackgroundJobInput;
  taskUuid?: string;
  /** unknown 表示 schedule 请求可能已到远端，不能回退到本地再生成一份。 */
  remoteState?: 'pending' | 'scheduled' | 'unknown';
  createdAt: number;
}

const safeRead = (): PendingDateBackgroundJob[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PendingDateBackgroundJob[] => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const input = parseDateBackgroundJobInput(raw.input);
      if (!input || typeof raw.jobId !== 'string' || !raw.jobId) return [];
      return [{
        jobId: raw.jobId,
        input,
        ...(typeof raw.taskUuid === 'string' && raw.taskUuid ? { taskUuid: raw.taskUuid } : {}),
        ...(raw.remoteState === 'scheduled' || raw.remoteState === 'unknown' ? { remoteState: raw.remoteState } : {}),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : input.createdAt,
      }];
    });
  } catch {
    return [];
  }
};

const safeWrite = (jobs: PendingDateBackgroundJob[]): void => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(jobs.slice(-MAX_PENDING))); } catch { /* private WebView */ }
};

export const listPendingDateBackgroundJobs = (): PendingDateBackgroundJob[] => safeRead();

export const getPendingDateBackgroundJob = (jobId: string): PendingDateBackgroundJob | null => (
  safeRead().find(job => job.jobId === jobId) || null
);

export const getPendingDateBackgroundJobForEncounter = (
  encounterId: string,
): PendingDateBackgroundJob | null => (
  safeRead().find(job => job.input.encounterId === encounterId) || null
);

export const savePendingDateBackgroundJob = (job: PendingDateBackgroundJob): void => {
  const jobs = safeRead().filter(item => item.jobId !== job.jobId);
  jobs.push({ remoteState: 'pending', ...job });
  safeWrite(jobs);
};

export const removePendingDateBackgroundJob = (jobId: string): void => {
  safeWrite(safeRead().filter(job => job.jobId !== jobId));
};

export const updatePendingDateBackgroundJob = (
  jobId: string,
  patch: Partial<Pick<PendingDateBackgroundJob, 'taskUuid' | 'remoteState'>>,
): PendingDateBackgroundJob | null => {
  const jobs = safeRead();
  const index = jobs.findIndex(job => job.jobId === jobId);
  if (index < 0) return null;
  const next = { ...jobs[index], ...patch };
  jobs[index] = next;
  safeWrite(jobs);
  return next;
};

export const makeDateBackgroundJobId = (encounterId: string, sourceUserMessageId: number): string => (
  `date-${encounterId}-${sourceUserMessageId}`
);

export const buildPendingDateBackgroundJob = (args: {
  char: Pick<CharacterProfile, 'id' | 'name'>;
  encounter: Pick<DateEncounterPresence, 'encounterId' | 'startedAt' | 'sceneClockAt' | 'sceneClockAdvancedMs' | 'sceneClockRevision'>;
  sourceUserMessageId: number;
  messages: Array<{ role?: string; content?: unknown }>;
}): PendingDateBackgroundJob | null => {
  const jobId = makeDateBackgroundJobId(args.encounter.encounterId, args.sourceUserMessageId);
  const input = buildDateBackgroundJobInput({
    clientJobId: jobId,
    charId: args.char.id,
    charName: args.char.name,
    encounterId: args.encounter.encounterId,
    encounterStartedAt: args.encounter.startedAt,
    sourceUserMessageId: args.sourceUserMessageId,
    sceneClockAt: args.encounter.sceneClockAt || args.encounter.startedAt,
    sceneClockAdvancedMs: args.encounter.sceneClockAdvancedMs,
    sceneClockRevision: args.encounter.sceneClockRevision || 0,
    messages: args.messages,
  });
  if (!input.messages.length || JSON.stringify(input).length > MAX_JOB_JSON_CHARS) return null;
  return { jobId, input, remoteState: 'pending', createdAt: input.createdAt };
};

export type DateBackgroundScheduleOutcome =
  | { status: 'queued'; uuid: string }
  | { status: 'uncertain' }
  | { status: 'fallback'; reason: 'unsupported' | 'unknown' | 'error' };

const scheduling = new Set<string>();

const toCredentialRow = (
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
  charId: string,
): LlmCredentialRow | null => buildCharInstantCredRow(charId, api);

const probeToFallbackReason = (outcome: BackgroundJobProbeOutcome): 'unsupported' | 'unknown' => (
  outcome === 'unsupported' ? 'unsupported' : 'unknown'
);

/**
 * 把已经写入本地的 pending 交给 Worker。能力探测或明确拒绝都允许调用方回本地生成；
 * 只有 schedule 请求本身可能已被远端接收时才返回 uncertain。
 */
export const schedulePendingDateBackgroundJob = async (args: {
  jobId: string;
  char: Pick<CharacterProfile, 'id' | 'name'>;
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
}): Promise<DateBackgroundScheduleOutcome> => {
  const pending = getPendingDateBackgroundJob(args.jobId);
  if (!pending) return { status: 'fallback', reason: 'error' };
  if (pending.taskUuid) return { status: 'queued', uuid: pending.taskUuid };
  if (pending.remoteState === 'unknown') return { status: 'uncertain' };
  if (scheduling.has(args.jobId)) return { status: 'uncertain' };

  const credRow = toCredentialRow(args.api, args.char.id);
  if (!credRow) return { status: 'fallback', reason: 'error' };

  scheduling.add(args.jobId);
  try {
    const probe = await ActiveMsgClient.probeDateBackgroundJobSupportDetailed();
    if (probe !== 'supported') return { status: 'fallback', reason: probeToFallbackReason(probe) };

    const scheduled = await ActiveMsgClient.scheduleBackgroundJob({
      kind: DATE_BACKGROUND_REPLY_KIND,
      charId: pending.input.charId,
      charName: pending.input.charName || args.char.name,
      jobKey: dateBackgroundJobKey(args.jobId),
      jobId: args.jobId,
      jobInput: pending.input,
      credRow,
      temperature: 0.85,
      maxTokens: 8000,
    });
    updatePendingDateBackgroundJob(args.jobId, { taskUuid: scheduled.uuid, remoteState: 'scheduled' });
    return { status: 'queued', uuid: scheduled.uuid };
  } catch (error) {
    if (mayHaveCreatedBackgroundJob(error)) {
      updatePendingDateBackgroundJob(args.jobId, { remoteState: 'unknown' });
      console.warn(`${HEADER} schedule 响应不确定，保留 pending 防止本地双生成`, args.jobId, error);
      return { status: 'uncertain' };
    }
    console.warn(`${HEADER} 排队失败，回退前台生成`, args.jobId, error);
    return { status: 'fallback', reason: 'error' };
  } finally {
    scheduling.delete(args.jobId);
  }
};

export const schedulePendingDateBackgroundJobs = async (args: {
  characters: Array<Pick<CharacterProfile, 'id' | 'name'>>;
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
}): Promise<void> => {
  const pending = listPendingDateBackgroundJobs().filter(job => !job.taskUuid && job.remoteState !== 'unknown');
  await Promise.all(pending.map(async job => {
    const char = args.characters.find(item => item.id === job.input.charId);
    if (!char) return;
    await schedulePendingDateBackgroundJob({ jobId: job.jobId, char, api: args.api });
  }));
};

export const cancelPendingDateBackgroundJobs = async (encounterId: string): Promise<void> => {
  const jobs = listPendingDateBackgroundJobs().filter(job => job.input.encounterId === encounterId);
  await Promise.all(jobs.map(async job => {
    if (job.taskUuid) {
      try { await ActiveMsgClient.cancelTask(job.taskUuid); } catch (error) {
        console.warn(`${HEADER} 取消远端见面任务失败，结果将由 encounter 闸门丢弃`, job.jobId, error);
      }
    }
    removePendingDateBackgroundJob(job.jobId);
  }));
};

const cleanGeneratedText = (raw: string): { content: string; endReason?: string } => {
  const endMatch = raw.match(/\[\[END_MEETING:\s*([^\]]{1,200})\]\]/i);
  const content = stripFaceToFacePhoneSourceTags(stripMessageReactionTags(raw))
    .replace(/<think(?:ing|ought)?\b[^>]*>[\s\S]*?<\/think(?:ing|ought)?\s*>/gi, '')
    .replace(/<think(?:ing|ought)?\b[^>]*>[\s\S]*$/gi, '')
    .replace(/\[\[END_MEETING:\s*[^\]]*\]\]/gi, '')
    .trim();
  return {
    content,
    ...(endMatch?.[1]?.trim() ? { endReason: endMatch[1].trim() } : {}),
  };
};

const findActiveEncounter = (char: CharacterProfile): DateEncounterPresence | null => {
  const presence = getActiveDatePresence(char.id) || char.activeDateEncounter;
  return presence?.status === 'active' || presence?.status === 'paused' ? presence : null;
};

const hasDateMessageAfter = (messages: Message[], source: Message, encounterId: string): boolean => (
  messages.some(message => message.id !== source.id
    && message.metadata?.source === 'date'
    && message.metadata?.dateEncounterId === encounterId
    && (message.id > source.id || message.timestamp > source.timestamp))
);

/** Worker result → 本地见面历史。true 表示可以销账；false 表示让 outbox 下次重试。 */
export const applyDateBackgroundResult = async (payload: unknown): Promise<boolean> => {
  const result = parseDateBackgroundJobResult(payload);
  if (!result) {
    console.warn(`${HEADER} 结果形状不对，销账丢弃`, payload);
    return true;
  }

  const char = await DB.getCharacter(result.charId);
  if (!char) {
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }
  const presence = findActiveEncounter(char);
  if (!presence || presence.encounterId !== result.encounterId) {
    // 已结束 / 已丢弃的见面不能被迟到结果复活。
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }

  const all = await DB.getMessagesByCharId(result.charId, true);
  const duplicate = all.find(message => (
    message.metadata?.dateBackgroundClientJobId === result.clientJobId
      || message.metadata?.backgroundJobId === result.clientJobId
  ));
  if (duplicate) {
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }

  const sourceUser = all.find(message => (
    message.id === result.sourceUserMessageId
      && message.role === 'user'
      && message.metadata?.source === 'date'
      && message.metadata?.dateEncounterId === result.encounterId
  ));
  if (!sourceUser) {
    // 结果可能比用户消息的本地事务更早到；保留 outbox 等下一次补收。
    return false;
  }
  if (hasDateMessageAfter(all, sourceUser, result.encounterId)) {
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }
  if (typeof presence.sceneClockRevision === 'number'
    && presence.sceneClockRevision !== result.sceneClockRevision) {
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }

  const { content, endReason } = cleanGeneratedText(result.text);
  if (!content) {
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }

  const { observation } = extractObservation(content, {
    lenient: char.dateObserve?.enabled === true,
    custom: char.dateObserve?.custom,
  });
  const resolved = resolveDialogueSceneClock({
    rawContent: content,
    observation,
    currentAt: result.sceneClockAt,
    currentAdvancedMs: result.sceneClockAdvancedMs,
    timeZone: presence.sceneClockTimeZone,
  });
  const visibleContent = resolved.content.trim();
  if (!visibleContent) {
    removePendingDateBackgroundJob(result.clientJobId);
    return true;
  }
  const nextSceneClockAt = resolved.advanced ? resolved.sceneClockAt : result.sceneClockAt;
  const nextSceneClockAdvancedMs = resolved.advanced
    ? resolved.sceneClockAdvancedMs
    : result.sceneClockAdvancedMs;
  const nextSceneClockRevision = resolved.advanced
    ? result.sceneClockRevision + 1
    : result.sceneClockRevision;
  const nextSceneClockUpdatedAt = resolved.advanced
    ? Date.now()
    : (typeof presence.sceneClockUpdatedAt === 'number' ? presence.sceneClockUpdatedAt : presence.updatedAt);
  const savedMessageId = await DB.saveMessage({
    charId: result.charId,
    role: 'assistant',
    type: 'text',
    content: visibleContent,
    timestamp: result.generatedAt,
    metadata: {
      source: 'date',
      dateEncounterId: result.encounterId,
      dateEncounterStartedAt: result.encounterStartedAt,
      sceneClockAt: nextSceneClockAt,
      sceneClockAdvancedMs: nextSceneClockAdvancedMs,
      sceneClockRevision: nextSceneClockRevision,
      sceneClockUpdatedAt: nextSceneClockUpdatedAt,
      ...(presence.sceneClockTimeZone ? { sceneClockTimeZone: presence.sceneClockTimeZone } : {}),
      sceneClockBefore: result.sceneClockAt,
      sceneClockBeforeAdvancedMs: result.sceneClockAdvancedMs,
      sceneClockAfter: nextSceneClockAt,
      sceneClockAdvancedDeltaMs: resolved.sceneClockAdvancedDeltaMs,
      sceneClockResolution: resolved.resolution,
      ...(resolved.advanced
        ? (resolved.source ? { sceneClockSource: resolved.source } : {})
        : (presence.sceneClockSource ? { sceneClockSource: presence.sceneClockSource } : {})),
      ...(resolved.requestedSceneClockAt !== undefined ? { requestedSceneClockAt: resolved.requestedSceneClockAt } : {}),
      ...(resolved.observedSceneClockText ? { observedSceneClockText: resolved.observedSceneClockText.slice(0, 240) } : {}),
      dateTurnKind: result.turnKind === 'reply' ? 'dialogue' : result.turnKind,
      backgroundGenerated: true,
      backgroundJobId: result.clientJobId,
      dateBackgroundClientJobId: result.clientJobId,
      backgroundSourceUserMessageId: result.sourceUserMessageId,
      generatedAt: result.generatedAt,
      ...(endReason ? { endMeetingReason: endReason } : {}),
    },
  });

  if (resolved.advanced) {
    // 消息保存和角色保存不是同一 IndexedDB 事务，所以在第二个写入点再做一次
    // encounter/revision 闸门。过期结果只清理自己刚写的消息，不碰新剧情。
    const latestChar = await DB.getCharacter(result.charId);
    const latestPresence = latestChar ? findActiveEncounter(latestChar) : null;
    if (!latestChar
      || !latestPresence
      || latestPresence.encounterId !== result.encounterId
      || (typeof latestPresence.sceneClockRevision === 'number'
        && latestPresence.sceneClockRevision !== result.sceneClockRevision)) {
      await DB.deleteMessage(savedMessageId).catch(error => {
        console.warn(`${HEADER} 清理过期后台见面回复失败`, error);
      });
      removePendingDateBackgroundJob(result.clientJobId);
      return true;
    }
    const nextPresence = makeDateEncounterPresence(
      result.encounterId,
      result.encounterStartedAt,
      latestPresence.status,
      {
        sceneClockAt: nextSceneClockAt,
        sceneClockAdvancedMs: nextSceneClockAdvancedMs,
        sceneClockRevision: nextSceneClockRevision,
        sceneClockUpdatedAt: nextSceneClockUpdatedAt,
        sceneClockTimeZone: latestPresence.sceneClockTimeZone,
      },
    );
    try {
      await DB.saveCharacter({ ...latestChar, activeDateEncounter: nextPresence });
    } catch (error) {
      await DB.deleteMessage(savedMessageId).catch(cleanupError => {
        console.warn(`${HEADER} 回滚后台见面回复失败`, cleanupError);
      });
      console.warn(`${HEADER} 保存后台见面剧情时钟失败，保留 pending 等待重试`, error);
      return false;
    }
    setActiveDatePresence(result.charId, nextPresence);
  }
  removePendingDateBackgroundJob(result.clientJobId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('active-msg-progress', {
      detail: {
        charId: result.charId,
        dateEncounterId: result.encounterId,
        dateBackground: true,
        clientJobId: result.clientJobId,
        sceneClockAt: nextSceneClockAt,
        sceneClockAdvancedMs: nextSceneClockAdvancedMs,
        sceneClockRevision: nextSceneClockRevision,
        sceneClockUpdatedAt: nextSceneClockUpdatedAt,
        ...(presence.sceneClockTimeZone ? { sceneClockTimeZone: presence.sceneClockTimeZone } : {}),
        sceneClockResolution: resolved.resolution,
        messageId: savedMessageId,
        ...(endReason ? { endMeetingReason: endReason } : {}),
      },
    }));
  }
  return true;
};

export const isDateBackgroundResultKind = (kind: string): boolean => kind === 'date-reply';

export type { DateBackgroundJobInput, DateBackgroundJobResult };
