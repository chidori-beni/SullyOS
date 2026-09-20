/**
 * 【见面·剧情】后台回复桥。
 *
 * localStorage 只保存“哪些任务还在等”的轻量索引；真正的幂等锚点是剧情线程里的
 * 隐藏 marker。结果到达时，marker、剧情尾部、中央回复和角色镜像在同一个 IndexedDB
 * transaction 中检查与提交，因此页面被切走、推送与 outbox 同时到达、或旧结果迟到，
 * 都不会把正文重复写入或接到新一轮后面。
 */

import type { APIConfig, CharacterProfile, Message, StoryTheaterEntry } from '../types';
import { DB, openDB } from './db';
import {
  ActiveMsgClient,
  mayHaveCreatedBackgroundJob,
  type BackgroundJobProbeOutcome,
} from './activeMsgClient';
import { AMSG_JOB_NAMESPACE } from './amsgTaskKinds';
import { buildCharInstantCredRow, type LlmCredentialRow } from './amsgLlmCredentials';
import {
  STORY_BACKGROUND_REPLY_KIND,
  buildStoryBackgroundJobInput,
  normalizeStoryBackgroundMessages,
  parseStoryBackgroundJobInput,
  parseStoryBackgroundJobResult,
  storyBackgroundJobKey,
  type StoryBackgroundAffinityInput,
  type StoryBackgroundJobInput,
  type StoryBackgroundJobResult,
  type StoryBackgroundMessageRole,
  type StoryBackgroundMirrorTarget,
  type StoryBackgroundOperation,
  type StoryBackgroundTurnKind,
} from './amsgStoryJob';
import { storyTheaterThreadId } from './storyTheater';
import { getMemoryPalaceHighWaterMark } from './memoryPalace/pipeline';

const PENDING_KEY = 'sully-story-background-jobs-v1';
const MAX_PENDING = 8;
const MAX_JOB_JSON_CHARS = 1_500_000;
const HEADER = '[story-background]';

export interface PendingStoryBackgroundJob {
  jobId: string;
  input: StoryBackgroundJobInput;
  taskUuid?: string;
  /** unknown 表示 schedule 请求可能已经到达远端，不能回退前台再生成一份。 */
  remoteState?: 'pending' | 'scheduled' | 'unknown';
  /** cancel-requested 表示本地已落取消墓碑，不再允许恢复成新的后台排程。 */
  lifecycle?: 'active' | 'cancel-requested';
  cancelRequestedAt?: number;
  createdAt: number;
}

const safeRead = (): PendingStoryBackgroundJob[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PendingStoryBackgroundJob[] => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      const input = parseStoryBackgroundJobInput(raw.input);
      if (!input || typeof raw.jobId !== 'string' || !raw.jobId) return [];
      return [{
        jobId: raw.jobId,
        input,
        ...(typeof raw.taskUuid === 'string' && raw.taskUuid ? { taskUuid: raw.taskUuid } : {}),
        ...(raw.remoteState === 'scheduled' || raw.remoteState === 'unknown' ? { remoteState: raw.remoteState } : {}),
        ...(raw.lifecycle === 'cancel-requested' ? { lifecycle: raw.lifecycle } : {}),
        ...(typeof raw.cancelRequestedAt === 'number' ? { cancelRequestedAt: raw.cancelRequestedAt } : {}),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : input.createdAt,
      }];
    });
  } catch {
    return [];
  }
};

const safeWrite = (jobs: PendingStoryBackgroundJob[]): void => {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(jobs.slice(-MAX_PENDING))); } catch { /* 私密 WebView 可能禁用 storage */ }
};

export const listPendingStoryBackgroundJobs = (): PendingStoryBackgroundJob[] => safeRead();

export const getPendingStoryBackgroundJob = (jobId: string): PendingStoryBackgroundJob | null => (
  safeRead().find(job => job.jobId === jobId) || null
);

export const getPendingStoryBackgroundJobForStory = (storyId: string): PendingStoryBackgroundJob | null => (
  safeRead().find(job => job.input.storyId === storyId) || null
);

export const savePendingStoryBackgroundJob = (job: PendingStoryBackgroundJob): void => {
  const jobs = safeRead().filter(item => item.jobId !== job.jobId && item.input.storyId !== job.input.storyId);
  jobs.push({ remoteState: 'pending', ...job });
  safeWrite(jobs);
};

export const removePendingStoryBackgroundJob = (jobId: string): void => {
  safeWrite(safeRead().filter(job => job.jobId !== jobId));
};

export const updatePendingStoryBackgroundJob = (
  jobId: string,
  patch: Partial<Pick<PendingStoryBackgroundJob, 'taskUuid' | 'remoteState' | 'lifecycle' | 'cancelRequestedAt'>>,
): PendingStoryBackgroundJob | null => {
  const jobs = safeRead();
  const index = jobs.findIndex(job => job.jobId === jobId);
  if (index < 0) return null;
  jobs[index] = { ...jobs[index], ...patch };
  safeWrite(jobs);
  return jobs[index];
};

/** 结果处理失败回退前台时，清掉尚未交给 Worker 的隐藏 marker。 */
export const deleteStoryBackgroundJobMarker = async (markerMessageId: number): Promise<void> => {
  if (!Number.isInteger(markerMessageId) || markerMessageId <= 0) return;
  await DB.deleteMessage(markerMessageId).catch(error => {
    console.warn(`${HEADER} 清理隐藏任务 marker 失败`, markerMessageId, error);
  });
};

type StoryBackgroundMarkerState = 'active' | 'canceled' | 'missing' | 'mismatch';

/**
 * 取消的事实必须落在和结果桥同一张 messages 表里，不能只放 localStorage：
 * localStorage 既不能和正文写入原子竞争，也可能在结果走 outbox 重放前被清掉。
 */
const getStoryBackgroundMarkerState = async (
  markerMessageId: number,
  jobId: string,
): Promise<StoryBackgroundMarkerState> => {
  if (!Number.isInteger(markerMessageId) || markerMessageId <= 0 || !jobId) return 'mismatch';
  const db = await openDB();
  return new Promise<StoryBackgroundMarkerState>((resolve, reject) => {
    const transaction = db.transaction('messages', 'readonly');
    const request = transaction.objectStore('messages').get(markerMessageId);
    request.onsuccess = () => {
      const marker = request.result as Message | undefined;
      if (!marker) {
        resolve('missing');
        return;
      }
      if (marker.metadata?.source !== 'story_theater_background_job'
        || marker.metadata?.storyBackgroundClientJobId !== jobId) {
        resolve('mismatch');
        return;
      }
      resolve(marker.metadata?.storyBackgroundJobState === 'canceled' ? 'canceled' : 'active');
    };
    request.onerror = () => reject(request.error || new Error('读取剧情后台 marker 失败'));
    transaction.onerror = () => reject(transaction.error || new Error('读取剧情后台 marker 事务失败'));
  });
};

/** 在 IndexedDB 事务提交后才报告成功，避免取消状态只写进了未提交的 request。 */
export const markStoryBackgroundJobCanceled = async (
  job: PendingStoryBackgroundJob,
): Promise<StoryBackgroundMarkerState> => {
  const markerMessageId = job.input.markerMessageId;
  if (!Number.isInteger(markerMessageId) || markerMessageId <= 0) return 'mismatch';
  const db = await openDB();
  return new Promise<StoryBackgroundMarkerState>((resolve, reject) => {
    const transaction = db.transaction('messages', 'readwrite');
    const store = transaction.objectStore('messages');
    let state: StoryBackgroundMarkerState = 'missing';
    const request = store.get(markerMessageId);
    request.onsuccess = () => {
      const marker = request.result as Message | undefined;
      if (!marker) {
        state = 'missing';
        return;
      }
      if (marker.metadata?.source !== 'story_theater_background_job'
        || marker.metadata?.storyBackgroundClientJobId !== job.jobId) {
        state = 'mismatch';
        return;
      }
      state = marker.metadata?.storyBackgroundJobState === 'canceled' ? 'canceled' : 'active';
      if (state === 'active') {
        store.put({
          ...marker,
          metadata: {
            ...(marker.metadata || {}),
            storyBackgroundJobState: 'canceled',
            storyBackgroundCanceledAt: Date.now(),
          },
        });
      }
    };
    request.onerror = () => reject(request.error || new Error('读取剧情后台 marker 失败'));
    transaction.oncomplete = () => resolve(state);
    transaction.onerror = () => reject(transaction.error || new Error('取消剧情后台任务事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('取消剧情后台任务事务已撤销'));
  });
};

const waitForRemoteCancellation = async (operation: Promise<unknown>, timeoutMs = 8000): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(ok);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      operation.then(() => finish(true)).catch(() => finish(false));
    });
  } catch {
    if (timer) clearTimeout(timer);
    return false;
  }
};

export type StoryBackgroundCancelOutcome = {
  status: 'cancelled';
  /** false 表示本地已停止且迟到结果会被丢弃，但远端取消仍需由服务端自行收尾。 */
  remoteUncertain: boolean;
};

/**
 * 先写本地取消墓碑，再尽力删掉远端输入与任务。即使网络请求卡住，页面也不会被它
 * 永久锁住：迟到结果看到墓碑会销账但不写正文。
 */
export const cancelPendingStoryBackgroundJob = async (jobId: string): Promise<StoryBackgroundCancelOutcome> => {
  const pending = getPendingStoryBackgroundJob(jobId);
  if (!pending) return { status: 'cancelled', remoteUncertain: false };

  const markerState = await markStoryBackgroundJobCanceled(pending);
  if (markerState === 'active' || markerState === 'canceled') {
    updatePendingStoryBackgroundJob(jobId, {
      lifecycle: 'cancel-requested',
      cancelRequestedAt: Date.now(),
    });
  }

  const remoteOperations: Promise<unknown>[] = [
    ActiveMsgClient.clearClientStateValue(AMSG_JOB_NAMESPACE, storyBackgroundJobKey(jobId)),
  ];
  if (pending.taskUuid) remoteOperations.push(ActiveMsgClient.cancelTask(pending.taskUuid));
  const remoteResults = await Promise.all(remoteOperations.map(operation => waitForRemoteCancellation(operation)));

  // Tombstone 已经是本地的最终裁决，删掉轻量索引不会让迟到结果重新写回。
  removePendingStoryBackgroundJob(jobId);
  return {
    status: 'cancelled',
    remoteUncertain: markerState === 'missing'
      || markerState === 'mismatch'
      || pending.remoteState === 'unknown'
      || remoteResults.some(ok => !ok),
  };
};

const stableHash = (value: string): string => {
  // 不依赖 Web Crypto，保证 iOS WebView、测试环境和恢复路径都能得到同一个 jobId。
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const fingerprintStoryText = (value: string): string => stableHash(String(value));

export const makeStoryBackgroundJobId = (args: {
  storyId: string;
  operation: StoryBackgroundOperation;
  turnKind: StoryBackgroundTurnKind;
  anchorId?: number;
  messages: Array<{ role?: string; content?: unknown }>;
  assistantPrefill?: string;
  settings?: Record<string, unknown>;
}): string => {
  const anchor = args.anchorId && args.anchorId > 0 ? String(args.anchorId) : 'opening';
  const digest = stableHash(JSON.stringify({
    storyId: args.storyId,
    operation: args.operation,
    turnKind: args.turnKind,
    messages: normalizeStoryBackgroundMessages(args.messages),
    assistantPrefill: args.assistantPrefill || '',
    settings: args.settings || {},
  }));
  return `story-${args.storyId}-${args.operation}-${anchor}-${digest}`;
};

export const buildPendingStoryBackgroundJob = (args: {
  entry: Pick<StoryTheaterEntry, 'id' | 'title' | 'createdAt'>;
  threadId?: string;
  primaryChar: Pick<CharacterProfile, 'id' | 'name'>;
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
}): PendingStoryBackgroundJob | null => {
  const threadId = args.threadId || storyTheaterThreadId(args.entry.id);
  const jobId = makeStoryBackgroundJobId({
    storyId: args.entry.id,
    operation: args.operation,
    turnKind: args.turnKind,
    anchorId: args.operation === 'replace' ? args.targetAssistantMessageId : args.sourceUserMessageId,
    messages: args.messages,
    assistantPrefill: args.assistantPrefill,
    settings: {
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      extraBody: args.extraBody,
    },
  });
  const input = buildStoryBackgroundJobInput({
    clientJobId: jobId,
    storyId: args.entry.id,
    storyTitle: args.entry.title,
    threadId,
    primaryCharId: args.primaryChar.id,
    primaryCharName: args.primaryChar.name,
    // 创建 marker 后会在 createPendingStoryBackgroundJob 中替换成真实自增 id。
    markerMessageId: 1,
    operation: args.operation,
    turnKind: args.turnKind,
    sourceUserMessageId: args.sourceUserMessageId,
    targetAssistantMessageId: args.targetAssistantMessageId,
    expectedTailId: args.expectedTailId,
    expectedTailRole: args.expectedTailRole,
    expectedTailFingerprint: args.expectedTailFingerprint,
    targetAssistantFingerprint: args.targetAssistantFingerprint,
    targetMirrorIds: args.targetMirrorIds,
    messages: args.messages,
    assistantPrefill: args.assistantPrefill,
    promptTokenEstimate: args.promptTokenEstimate,
    affinityInputs: args.affinityInputs,
    mirrorTargets: args.mirrorTargets,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    extraBody: args.extraBody,
  });
  if (!input.messages.length || JSON.stringify(input).length > MAX_JOB_JSON_CHARS) return null;
  return { jobId, input, remoteState: 'pending', createdAt: input.createdAt };
};

/** 把 marker 和 pending 索引一起准备好，再允许调用方去 schedule。 */
export const createPendingStoryBackgroundJob = async (job: PendingStoryBackgroundJob): Promise<PendingStoryBackgroundJob> => {
  const markerMessageId = await DB.saveMessage({
    charId: job.input.threadId,
    role: 'system',
    type: 'system',
    content: '',
    timestamp: job.createdAt,
    metadata: {
      source: 'story_theater_background_job',
      storyId: job.input.storyId,
      storyBackgroundClientJobId: job.jobId,
      storyBackgroundOperation: job.input.operation,
      storyBackgroundTurnKind: job.input.turnKind,
    },
  });
  const next = {
    ...job,
    input: { ...job.input, markerMessageId },
  };
  savePendingStoryBackgroundJob(next);
  return next;
};

export type StoryBackgroundScheduleOutcome =
  | { status: 'queued'; uuid: string }
  | { status: 'uncertain' }
  | { status: 'cancelled' }
  | { status: 'fallback'; reason: 'unsupported' | 'unknown' | 'error' };

const scheduling = new Set<string>();

const toCredentialRow = (
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
  charId: string,
): LlmCredentialRow | null => buildCharInstantCredRow(charId, api);

const probeToFallbackReason = (outcome: BackgroundJobProbeOutcome): 'unsupported' | 'unknown' => (
  outcome === 'unsupported' ? 'unsupported' : 'unknown'
);

export const schedulePendingStoryBackgroundJob = async (args: {
  jobId: string;
  char: Pick<CharacterProfile, 'id' | 'name'>;
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
}): Promise<StoryBackgroundScheduleOutcome> => {
  const pending = getPendingStoryBackgroundJob(args.jobId);
  // 取消和排程可能同时在飞。pending 被取消函数删掉时，不能把这次竞态误判成
  // “后台不可用”再落回前台，否则会绕过取消墓碑产生第二次生成。
  if (!pending) return { status: 'cancelled' };
  if (pending.lifecycle === 'cancel-requested') return { status: 'cancelled' };
  if (pending.remoteState === 'unknown') return { status: 'uncertain' };
  if (scheduling.has(args.jobId)) return { status: 'uncertain' };

  scheduling.add(args.jobId);
  try {
    // taskUuid 可能是在取消请求发出前写入的；先确认墓碑仍然 active，避免把
    // 已取消的旧任务重新恢复成“排队中”。
    if (await getStoryBackgroundMarkerState(pending.input.markerMessageId, args.jobId) !== 'active') {
      return { status: 'cancelled' };
    }
    if (pending.taskUuid) return { status: 'queued', uuid: pending.taskUuid };
    const credRow = toCredentialRow(args.api, args.char.id);
    if (!credRow) return { status: 'fallback', reason: 'error' };
    const probe = await ActiveMsgClient.probeStoryBackgroundJobSupportDetailed();
    if (await getStoryBackgroundMarkerState(pending.input.markerMessageId, args.jobId) !== 'active') {
      return { status: 'cancelled' };
    }
    if (probe !== 'supported') return { status: 'fallback', reason: probeToFallbackReason(probe) };

    const scheduled = await ActiveMsgClient.scheduleBackgroundJob({
      kind: STORY_BACKGROUND_REPLY_KIND,
      // Worker 用剧情自己的 threadId 串行，不把多角色剧情塞进某一个角色的聊天队列。
      charId: pending.input.threadId,
      charName: pending.input.primaryCharName || args.char.name,
      jobKey: storyBackgroundJobKey(args.jobId),
      jobId: args.jobId,
      jobInput: pending.input,
      credRow,
      temperature: pending.input.temperature,
      maxTokens: pending.input.maxTokens,
      extraBody: pending.input.extraBody,
    });
    const markerState = await getStoryBackgroundMarkerState(pending.input.markerMessageId, args.jobId);
    const latestPending = getPendingStoryBackgroundJob(args.jobId);
    if (markerState !== 'active' || !latestPending || latestPending.lifecycle === 'cancel-requested') {
      await Promise.all([
        ActiveMsgClient.clearClientStateValue(AMSG_JOB_NAMESPACE, storyBackgroundJobKey(args.jobId)).catch(error => {
          console.warn(`${HEADER} 取消竞态中清理后台输入失败`, args.jobId, error);
        }),
        ActiveMsgClient.cancelTask(scheduled.uuid).catch(error => {
          console.warn(`${HEADER} 取消竞态中删除远端任务失败`, args.jobId, error);
        }),
      ]);
      removePendingStoryBackgroundJob(args.jobId);
      return { status: 'cancelled' };
    }
    if (!updatePendingStoryBackgroundJob(args.jobId, { taskUuid: scheduled.uuid, remoteState: 'scheduled' })) {
      await Promise.all([
        ActiveMsgClient.clearClientStateValue(AMSG_JOB_NAMESPACE, storyBackgroundJobKey(args.jobId)).catch(error => {
          console.warn(`${HEADER} 排程后清理孤儿后台输入失败`, args.jobId, error);
        }),
        ActiveMsgClient.cancelTask(scheduled.uuid).catch(error => {
          console.warn(`${HEADER} 排程后删除孤儿远端任务失败`, args.jobId, error);
        }),
      ]);
      return { status: 'cancelled' };
    }
    return { status: 'queued', uuid: scheduled.uuid };
  } catch (error) {
    if (mayHaveCreatedBackgroundJob(error)) {
      const markerState = await getStoryBackgroundMarkerState(pending.input.markerMessageId, args.jobId).catch(() => 'active' as StoryBackgroundMarkerState);
      if (markerState !== 'active' || getPendingStoryBackgroundJob(args.jobId)?.lifecycle === 'cancel-requested') {
        await ActiveMsgClient.clearClientStateValue(AMSG_JOB_NAMESPACE, storyBackgroundJobKey(args.jobId)).catch(cleanupError => {
          console.warn(`${HEADER} 不确定排程取消时清理后台输入失败`, args.jobId, cleanupError);
        });
        removePendingStoryBackgroundJob(args.jobId);
        return { status: 'cancelled' };
      }
      updatePendingStoryBackgroundJob(args.jobId, { remoteState: 'unknown' });
      console.warn(`${HEADER} schedule 响应不确定，保留 pending 防止本地双生成`, args.jobId, error);
      return { status: 'uncertain' };
    }
    console.warn(`${HEADER} 排队失败，回退前台生成`, args.jobId, error);
    return { status: 'fallback', reason: 'error' };
  } finally {
    scheduling.delete(args.jobId);
  }
};

const messageRowsForThread = (rows: Message[], threadId: string): Message[] => rows
  .filter(message => message.charId === threadId && message.metadata?.source === 'story_theater')
  .sort((a, b) => a.id - b.id);

const mirrorTimestamp = (target: StoryBackgroundMirrorTarget, generatedAt: number): number => (
  typeof target.anchorAt === 'number'
    ? target.anchorAt + Math.max(0, generatedAt - target.entryCreatedAt)
    : generatedAt
);

type StoryApplyOutcome = 'applied' | 'dropped' | 'retry';

/**
 * 在 messages + story_theaters 的同一事务内完成结果检查与写入。
 * 事务里的所有请求都只做同步判断/写入，不在中间 await，避免检查完尾部后被另一标签页插入新楼。
 */
const applyAtomically = async (
  result: StoryBackgroundJobResult,
  content: string,
): Promise<StoryApplyOutcome> => {
  const db = await openDB();
  const hasStoryStore = db.objectStoreNames.contains('story_theaters');
  return new Promise<StoryApplyOutcome>((resolve, reject) => {
    const stores = hasStoryStore ? ['messages', 'story_theaters'] : ['messages'];
    const transaction = db.transaction(stores, 'readwrite');
    const messageStore = transaction.objectStore('messages');
    const storyStore = hasStoryStore ? transaction.objectStore('story_theaters') : null;
    let threadRows: Message[] | undefined;
    let entry: StoryTheaterEntry | undefined;
    let mirrorRows = new Map<number, Message>();
    let readsReady = false;
    let storyReady = !storyStore;
    let evaluated = false;
    let outcome: StoryApplyOutcome = 'retry';

    const finishDropped = (preserveMarker = false) => {
      outcome = 'dropped';
      const marker = threadRows?.find(row => row.id === result.markerMessageId);
      if (marker && !preserveMarker) messageStore.delete(marker.id);
    };

    const onReady = () => {
      if (evaluated || !readsReady || !storyReady) return;
      evaluated = true;
      const rows = threadRows || [];
      const storyRows = messageRowsForThread(rows, result.threadId);
      const marker = rows.find(row => row.id === result.markerMessageId);
      const markerMatches = marker?.metadata?.source === 'story_theater_background_job'
        && marker.metadata?.storyBackgroundClientJobId === result.clientJobId;

      // 取消墓碑必须保留：同一结果可能先从推送直达、再从 outbox 重放。若第一次
      // 处理就删除墓碑，第二次会落入“marker 不见但剧情存在”的 retry 死循环。
      if (markerMatches && marker?.metadata?.storyBackgroundJobState === 'canceled') {
        finishDropped(true);
        return;
      }
      const duplicate = storyRows.find(message => (
        message.metadata?.storyBackgroundClientJobId === result.clientJobId
          || message.metadata?.backgroundJobId === result.clientJobId
      ));

      if (duplicate) {
        finishDropped();
        return;
      }
      if (!marker || !markerMatches) {
        // 任务已被删除/取消；如果只是结果比 marker 早到，则保留 outbox 重试。
        if (!marker && entry) {
          outcome = 'retry';
        } else {
          finishDropped();
        }
        return;
      }
      if (!entry || entry.id !== result.storyId) {
        finishDropped();
        return;
      }

      const latest = storyRows[storyRows.length - 1];
      if (result.operation === 'append') {
        const expectedTail = result.expectedTailId
          ? storyRows.find(message => message.id === result.expectedTailId)
          : undefined;
        const validOpening = !result.expectedTailId && storyRows.length === 0;
        const validTail = Boolean(expectedTail
          && latest?.id === expectedTail.id
          && (!result.expectedTailRole || expectedTail.role === result.expectedTailRole)
          && (!result.expectedTailFingerprint || fingerprintStoryText(expectedTail.content) === result.expectedTailFingerprint));
        if (!validOpening && !validTail) {
          finishDropped();
          return;
        }

        const replyMetadata: Record<string, unknown> = {
          source: 'story_theater',
          theaterId: result.storyId,
          storyBackgroundClientJobId: result.clientJobId,
          backgroundJobId: result.clientJobId,
          backgroundGenerated: true,
          ...(result.sourceUserMessageId ? { backgroundSourceUserMessageId: result.sourceUserMessageId } : {}),
          theaterPromptTokens: result.promptTokenEstimate,
          theaterPromptTokensExact: false,
          theaterPostProcessPending: true,
          ...(result.affinityInputs?.length ? { theaterAffinityInputs: result.affinityInputs } : {}),
        };
        const centralRequest = messageStore.add({
          charId: result.threadId,
          role: 'assistant',
          type: 'text',
          content,
          timestamp: result.generatedAt,
          metadata: replyMetadata,
        });
        outcome = 'applied';
        centralRequest.onsuccess = () => {
          const centralId = Number(centralRequest.result);
          const targets = [...new Map(result.mirrorTargets.map(target => [target.charId, target])).values()];
          const mirrorIds: Record<string, number> = {};
          if (targets.length === 0) {
            messageStore.put({
              charId: result.threadId,
              id: centralId,
              role: 'assistant',
              type: 'text',
              content,
              timestamp: result.generatedAt,
              metadata: { ...replyMetadata, theaterMirrorIds: {} },
            });
            messageStore.delete(result.markerMessageId);
            return;
          }
          let remaining = targets.length;
          targets.forEach(target => {
            const mirrorRequest = messageStore.add({
              charId: target.charId,
              role: 'assistant',
              type: 'text',
              content,
              timestamp: mirrorTimestamp(target, result.generatedAt),
              metadata: {
                source: 'story_theater_memory',
                theaterId: result.storyId,
                theaterTitle: result.storyTitle,
                theaterCentralId: centralId,
                storyBackgroundClientJobId: result.clientJobId,
                backgroundGenerated: true,
              },
            });
            mirrorRequest.onsuccess = () => {
              mirrorIds[target.charId] = Number(mirrorRequest.result);
              remaining -= 1;
              if (remaining > 0) return;
              messageStore.put({
                charId: result.threadId,
                id: centralId,
                role: 'assistant',
                type: 'text',
                content,
                timestamp: result.generatedAt,
                metadata: { ...replyMetadata, theaterMirrorIds: mirrorIds },
              });
              messageStore.delete(result.markerMessageId);
            };
          });
        };
        return;
      }

      const target = result.targetAssistantMessageId
        ? storyRows.find(message => message.id === result.targetAssistantMessageId)
        : undefined;
      if (!target
        || latest?.id !== target.id
        || target.role !== 'assistant'
        || !result.targetAssistantFingerprint
        || fingerprintStoryText(target.content) !== result.targetAssistantFingerprint) {
        finishDropped();
        return;
      }
      if (target.metadata?.theaterArchived === true) {
        finishDropped();
        return;
      }

      const targetMirrorIds = result.targetMirrorIds || {};
      for (const charId of Object.keys(targetMirrorIds)) {
        const mirrorId = Number(targetMirrorIds[charId]);
        const mirror = mirrorRows.get(mirrorId);
        if (!mirror || mirror.content !== target.content) {
          finishDropped();
          return;
        }
        // 对真实角色记忆镜像，水位线是当前端唯一的“已归档”事实；检查在同一
        // messages transaction 开始前读取，至少不会把明显已归档的旧 reroll 覆盖掉。
        if (result.mirrorTargets.some(item => item.charId === charId)
          && mirrorId <= getMemoryPalaceHighWaterMark(charId)) {
          finishDropped();
          return;
        }
      }

      const nextCentral = {
        ...target,
        content,
        metadata: {
          ...(target.metadata || {}),
          source: 'story_theater',
          theaterId: result.storyId,
          storyBackgroundClientJobId: result.clientJobId,
          backgroundJobId: result.clientJobId,
          backgroundGenerated: true,
          theaterPostProcessPending: true,
          ...(result.sourceUserMessageId ? { backgroundSourceUserMessageId: result.sourceUserMessageId } : {}),
          theaterPromptTokens: result.promptTokenEstimate,
          theaterPromptTokensExact: false,
          ...(result.affinityInputs?.length ? { theaterAffinityInputs: result.affinityInputs } : {}),
        },
      };
      messageStore.put(nextCentral);
      for (const mirrorId of Object.values(targetMirrorIds)) {
        const mirror = mirrorRows.get(Number(mirrorId));
        if (!mirror) continue;
        messageStore.put({
          ...mirror,
          content,
          metadata: {
            ...(mirror.metadata || {}),
            storyBackgroundClientJobId: result.clientJobId,
            backgroundGenerated: true,
          },
        });
      }
      messageStore.delete(result.markerMessageId);
      outcome = 'applied';
    };

    transaction.oncomplete = () => resolve(outcome);
    transaction.onerror = () => reject(transaction.error || new Error('剧情后台结果事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('剧情后台结果事务已撤销'));

    const rowsRequest = messageStore.index('charId').getAll(IDBKeyRange.only(result.threadId));
    rowsRequest.onsuccess = () => {
      threadRows = (rowsRequest.result || []) as Message[];
      const mirrorIds = result.operation === 'replace'
        ? Object.values(result.targetMirrorIds || {}).map(Number).filter(id => Number.isInteger(id) && id > 0)
        : [];
      if (mirrorIds.length === 0) {
        readsReady = true;
        onReady();
        return;
      }
      let remaining = mirrorIds.length;
      mirrorIds.forEach(id => {
        const request = messageStore.get(id);
        request.onsuccess = () => {
          if (request.result) mirrorRows.set(id, request.result as Message);
          remaining -= 1;
          if (remaining === 0) {
            readsReady = true;
            onReady();
          }
        };
      });
    };
    const entryRequest = storyStore?.get(result.storyId);
    if (entryRequest) {
      entryRequest.onsuccess = () => {
        entry = entryRequest.result as StoryTheaterEntry | undefined;
        storyReady = true;
        onReady();
      };
    }
  });
};

const applyContentPrefill = (result: StoryBackgroundJobResult): string => {
  const generated = result.text.trim();
  const prefill = result.assistantPrefill.trim();
  return prefill && !generated.startsWith(prefill) ? `${prefill}${generated}` : generated;
};

/** Worker result → 本地剧情原文。true 表示可以销账；false 表示保留 outbox 等下一次重试。 */
export const applyStoryBackgroundResult = async (payload: unknown): Promise<boolean> => {
  const result = parseStoryBackgroundJobResult(payload);
  if (!result) {
    console.warn(`${HEADER} 结果形状不对，销账丢弃`, payload);
    return true;
  }
  const content = applyContentPrefill(result);
  if (!content) return true;
  try {
    const outcome = await applyAtomically(result, content);
    if (outcome === 'retry') return false;
    removePendingStoryBackgroundJob(result.clientJobId);
    if (outcome === 'applied' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('active-msg-progress', {
        detail: {
          storyBackground: true,
          storyId: result.storyId,
          threadId: result.threadId,
          clientJobId: result.clientJobId,
        },
      }));
    }
    return true;
  } catch (error) {
    console.warn(`${HEADER} 结果落库失败，保留 outbox 等待重试`, result.clientJobId, error);
    return false;
  }
};

export const isStoryBackgroundResultKind = (kind: string): boolean => kind === 'story-reply';

export type { StoryBackgroundJobInput, StoryBackgroundJobResult };
