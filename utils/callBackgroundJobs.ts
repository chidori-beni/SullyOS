/**
 * 浏览器侧的通话后台任务桥。
 *
 * 这层只负责三件事：保存尚未完成的任务快照、把快照交给 ActiveMsgClient、以及把 Worker
 * 的 result outbox 结果幂等写入 IndexedDB。真正的 LLM 调用在 worker/amsg/src/callFire.ts。
 */

import type { APIConfig, CharacterProfile, Message } from '../types';
import { DB } from './db';
import { ActiveMsgClient } from './activeMsgClient';
import {
  buildCharInstantCredRow,
  type LlmCredentialRow,
} from './amsgLlmCredentials';
import {
  CALL_BACKGROUND_REPLY_KIND,
  CALL_BACKGROUND_REPLY_RESULT_KIND,
  SLEEP_DREAM_KIND,
  SLEEP_DREAM_RESULT_KIND,
  callJobKey,
  parseCallJobResult,
  type CallBackgroundMode,
  type CallJobResult,
  type CallJobInput,
  type CallJobMessage,
} from './amsgCallJob';
import { parseCallAssistantMessage, stripCallTextFormatting } from './callReplyFormat';
import { loadSleepCompanionSession, updateSleepCompanionSession } from './sleepCompanionSession';
import { enqueueCallSessionWrite, isCallSessionEnded } from './callSessionLifecycle';

const PENDING_KEY = 'sully-call-background-jobs-v1';
const MAX_PENDING = 12;
const HEADER = '[call-background]';

export interface PendingCallBackgroundJob {
  jobId: string;
  input: CallJobInput;
  taskUuid?: string;
  firstSendTime?: string;
  createdAt: number;
}

const safeRead = (): PendingCallBackgroundJob[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingCallBackgroundJob => (
      !!item && typeof item === 'object'
      && typeof item.jobId === 'string' && item.jobId
      && !!item.input && typeof item.input === 'object'
    ));
  } catch {
    return [];
  }
};

const safeWrite = (jobs: PendingCallBackgroundJob[]): void => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(jobs.slice(-MAX_PENDING))); } catch { /* private WebView */ }
};

export const listPendingCallBackgroundJobs = (): PendingCallBackgroundJob[] => safeRead();

export const getPendingCallBackgroundJob = (jobId: string): PendingCallBackgroundJob | null => (
  safeRead().find(job => job.jobId === jobId) || null
);

export const savePendingCallBackgroundJob = (job: PendingCallBackgroundJob): void => {
  const jobs = safeRead().filter(item => item.jobId !== job.jobId);
  jobs.push(job);
  safeWrite(jobs);
};

export const removePendingCallBackgroundJob = (jobId: string): void => {
  safeWrite(safeRead().filter(job => job.jobId !== jobId));
};

export const updatePendingCallBackgroundJob = (
  jobId: string,
  patch: Partial<Pick<PendingCallBackgroundJob, 'taskUuid'>>,
): PendingCallBackgroundJob | null => {
  const jobs = safeRead();
  const index = jobs.findIndex(job => job.jobId === jobId);
  if (index < 0) return null;
  const next = { ...jobs[index], ...patch };
  jobs[index] = next;
  safeWrite(jobs);
  return next;
};

const scheduling = new Set<string>();

export const makeCallBackgroundJobId = (sessionId: string, sourceUserMessageId?: number, suffix = '') => (
  `call-${sessionId}-${sourceUserMessageId || suffix || Date.now()}`
);

const normalizeMessages = (messages: Array<{ role: string; content: unknown }>): CallJobMessage[] => (
  messages
    .filter(message => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role as CallJobMessage['role'],
      content: typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content
            .filter((part: any) => part?.type === 'text')
            .map((part: any) => part.text || '')
            .join('\n').trim() || '[图片]'
          : String(message.content ?? ''),
    }))
    .filter(message => message.content.trim())
);

export const buildCallBackgroundInput = (args: {
  charId: string;
  charName: string;
  sessionId: string;
  callMode: CallBackgroundMode;
  phase: 'reply' | 'dream';
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  sourceUserMessageId?: number;
  autoHangupAt?: number | null;
  dreamIndex?: number;
}): CallJobInput => ({
  v: 1,
  charId: args.charId,
  charName: args.charName,
  sessionId: args.sessionId,
  callMode: args.callMode,
  phase: args.phase,
  systemPrompt: args.systemPrompt,
  messages: normalizeMessages(args.messages),
  ...(args.sourceUserMessageId ? { sourceUserMessageId: args.sourceUserMessageId } : {}),
  ...(args.autoHangupAt !== undefined ? { autoHangupAt: args.autoHangupAt } : {}),
  ...(args.dreamIndex !== undefined ? { dreamIndex: args.dreamIndex } : {}),
  createdAt: Date.now(),
});

const toCredentialRow = (api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>, charId: string): LlmCredentialRow | null => (
  buildCharInstantCredRow(charId, api)
);

/**
 * 交给 Worker。能力探测失败时不抛，让前台原来的本地请求继续完成；明确支持但排程失败也
 * 不会阻塞当前通话，下一次回前台仍可由 pending job 重试。
 */
export const schedulePendingCallBackgroundJob = async (args: {
  jobId: string;
  char: Pick<CharacterProfile, 'id' | 'name'>;
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
  firstSendTime?: string;
}): Promise<{ uuid: string } | null> => {
  const pending = getPendingCallBackgroundJob(args.jobId);
  if (!pending || pending.taskUuid || scheduling.has(args.jobId)) return pending?.taskUuid ? { uuid: pending.taskUuid } : null;
  const credRow = toCredentialRow(args.api, args.char.id);
  if (!credRow) return null;
  scheduling.add(args.jobId);
  try {
    if ((await ActiveMsgClient.probeBackgroundJobSupportDetailed()) !== 'supported') return null;
    const scheduled = await ActiveMsgClient.scheduleBackgroundJob({
      kind: pending.input.phase === 'dream' ? SLEEP_DREAM_KIND : CALL_BACKGROUND_REPLY_KIND,
      charId: pending.input.charId,
      charName: pending.input.charName || args.char.name,
      jobKey: callJobKey(args.jobId),
      jobId: args.jobId,
      jobInput: pending.input,
      credRow,
      temperature: 0.85,
      maxTokens: 8000,
      ...(args.firstSendTime ? { firstSendTime: args.firstSendTime } : {}),
    });
    updatePendingCallBackgroundJob(args.jobId, { taskUuid: scheduled.uuid });
    return scheduled;
  } catch (error) {
    console.warn(`${HEADER} 排队失败（保留本地 pending，回前台可再试）`, args.jobId, error);
    return null;
  } finally {
    scheduling.delete(args.jobId);
  }
};

export const schedulePendingCallBackgroundJobs = async (args: {
  characters: Array<Pick<CharacterProfile, 'id' | 'name'>>;
  api: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
}): Promise<void> => {
  const pending = listPendingCallBackgroundJobs().filter(job => !job.taskUuid);
  await Promise.all(pending.map(async job => {
    const char = args.characters.find(item => item.id === job.input.charId);
    if (!char) return;
    await schedulePendingCallBackgroundJob({
      jobId: job.jobId,
      char,
      api: args.api,
      ...(job.firstSendTime ? { firstSendTime: job.firstSendTime } : {}),
    });
  }));
};

export const cancelPendingCallBackgroundJob = async (jobId: string): Promise<void> => {
  const pending = getPendingCallBackgroundJob(jobId);
  if (!pending) return;
  if (pending.taskUuid) {
    try { await ActiveMsgClient.cancelTask(pending.taskUuid); } catch (error) {
      console.warn(`${HEADER} 取消远端任务失败（Worker 会用会话卡片拦住迟到结果）`, jobId, error);
    }
  }
  removePendingCallBackgroundJob(jobId);
};

export const cancelAllPendingCallBackgroundJobs = async (sessionId: string): Promise<void> => {
  const jobs = safeRead().filter(job => job.input.sessionId === sessionId);
  await Promise.all(jobs.map(job => cancelPendingCallBackgroundJob(job.jobId)));
};

const findCallEndCard = (messages: Message[], sessionId: string): Message | undefined => messages.find(message => (
  message.metadata?.source === 'call-end-popup'
  && String(message.metadata?.callSessionId || '') === sessionId
));

/**
 * 正常挂断后迟到的 Worker 结果不应再把一通已结束的电话改写；但进程被系统杀掉时，
 * 恢复器可能已经先写了「已保存」卡片，随后 outbox 才把最后一条梦话/回复送回来。
 * 这两类恢复卡允许补写正文，避免“卡片有了、结果却丢了”的竞态。
 */
const canAppendAfterEndCard = (card: Message | undefined): boolean => {
  if (!card) return true;
  const metadata = card.metadata || {};
  return metadata.callInterrupted === true
    || metadata.sleepRecovered === true
    || metadata.sleepEndReason === 'app-interrupted'
    || metadata.sleepEndReason === 'auto-hangup';
};

const updateEndCardForBackgroundResult = async (
  card: Message | undefined,
  all: Message[],
  result: CallJobResult,
): Promise<void> => {
  if (!card) return;
  const transcript = all.filter(message => message.metadata?.source === 'call'
    && String(message.metadata?.callSessionId || '') === result.sessionId);
  const dreamCount = transcript.filter(message => message.metadata?.sleepPhase === 'dream').length
    + (result.phase === 'dream' ? 1 : 0);
  const turnCount = transcript.filter(message => message.role === 'user').length;
  await DB.updateMessageMetadata(card.id, previous => ({
    ...(previous || {}),
    ...(result.phase === 'dream' ? {
      sleepCompanion: true,
      sleepDreamCount: dreamCount,
    } : {}),
    ...(turnCount > 0 ? { turnCount } : {}),
    ...(card.metadata?.callInterrupted === true ? { endedAt: Math.max(Number(previous?.endedAt) || 0, result.generatedAt) } : {}),
  }));
};

/** Worker result → 本地消息库。返回 true 表示可以销账；落库失败返回 false 让 outbox 下次重试。 */
export const applyCallBackgroundResult = async (payload: unknown): Promise<boolean> => {
  const result = parseCallJobResult(payload);
  if (!result) {
    console.warn(`${HEADER} 结果形状不对，销账丢弃`, payload);
    return true;
  }
  // finishCall 先写内存里的结束墓碑，再异步取消 Worker / 保存结束卡片。
  // 结果 push 可能正好夹在这两个 await 之间；不要等 DB 结束卡片出现后才拦，
  // 否则迟到的台词会先落库，下一次普通聊天就会误把它当成仍在通话中。
  if (isCallSessionEnded(result.sessionId)) {
    removePendingCallBackgroundJob(result.jobId);
    return true;
  }
  const all = await DB.getMessagesByCharId(result.charId, true);
  const duplicate = all.find(message => message.metadata?.backgroundJobId === result.jobId);
  if (duplicate) {
    removePendingCallBackgroundJob(result.jobId);
    return true;
  }
  // 结束卡已经落库时，说明用户明确挂断或启动恢复已经收尾；不要让取消竞态把梦话/回复
  // 又接到一张已经完成的卡片后面。
  const endCard = findCallEndCard(all, result.sessionId);
  if (endCard && !canAppendAfterEndCard(endCard)) {
    removePendingCallBackgroundJob(result.jobId);
    return true;
  }
  const duplicateBySource = result.sourceUserMessageId
    ? all.find(message => message.metadata?.source === 'call'
      && message.role === 'assistant'
      && String(message.metadata?.callSessionId || '') === result.sessionId
      && Number(message.metadata?.backgroundSourceUserMessageId) === result.sourceUserMessageId)
    : undefined;
  if (duplicateBySource) {
    removePendingCallBackgroundJob(result.jobId);
    return true;
  }
  const parsed = parseCallAssistantMessage({ content: result.text }, false);
  const text = stripCallTextFormatting(parsed.text || result.text).trim();
  if (!text) {
    removePendingCallBackgroundJob(result.jobId);
    return true;
  }
  const savedId = await enqueueCallSessionWrite(result.sessionId, () => DB.saveMessage({
    charId: result.charId,
    role: 'assistant',
    type: 'text',
    content: text,
    timestamp: result.generatedAt,
    metadata: {
      source: 'call',
      callSessionId: result.sessionId,
      callMode: result.callMode,
      backgroundGenerated: true,
      backgroundJobId: result.jobId,
      backgroundSourceUserMessageId: result.sourceUserMessageId,
      ...(result.phase === 'dream' ? { sleepPhase: 'dream', dreamIndex: result.dreamIndex } : {}),
      ...(parsed.performance ? { avatarPerformance: parsed.performance } : {}),
      ...(parsed.performanceCues ? { avatarPerformanceCues: parsed.performanceCues } : {}),
      generatedAt: result.generatedAt,
    },
  }));
  if (savedId == null) {
    removePendingCallBackgroundJob(result.jobId);
    return true;
  }
  // 恢复卡片可能先于 outbox 到达；把梦话数量/轮次同步到卡片元数据，聊天页与通话记录
  // 两边都能看见这条迟到的结果。正常挂断卡片不会走到这里（上面的闸已拦住）。
  await updateEndCardForBackgroundResult(endCard, all, result);
  if (result.phase === 'dream' && loadSleepCompanionSession()?.sessionId === result.sessionId) {
    const dreamCount = all.filter(message => message.metadata?.source === 'call'
      && String(message.metadata?.callSessionId || '') === result.sessionId
      && message.metadata?.sleepPhase === 'dream').length + 1;
    updateSleepCompanionSession({ dreamCount, nextDreamCheckAt: Date.now() });
  }
  removePendingCallBackgroundJob(result.jobId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('active-msg-progress', {
      detail: {
        charId: result.charId,
        callSessionId: result.sessionId,
        backgroundCall: true,
        phase: result.phase,
      },
    }));
  }
  return true;
};

export const isCallBackgroundResultKind = (kind: string): boolean => (
  kind === CALL_BACKGROUND_REPLY_RESULT_KIND || kind === SLEEP_DREAM_RESULT_KIND
);
