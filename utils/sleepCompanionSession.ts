import type { Message } from '../types';
import { DB } from './db';

const SLEEP_SESSION_KEY = 'sully-call-sleep-session-v2';

export interface PersistedSleepCompanionSession {
  version: 2;
  charId: string;
  charName: string;
  charAvatar?: string;
  sessionId: string;
  startedAt: number;
  callMode: 'voice' | 'video';
  autoHangupAt: number | null;
  dreamEnabled: boolean;
  dreamCount: number;
  nextDreamCheckAt: number | null;
  updatedAt: number;
}

export interface RecoveredSleepCompanionResult {
  created: boolean;
  charId: string;
  sessionId: string;
  dreamCount: number;
}

const isFiniteTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
);

/**
 * Worker 任务已经排上但还没到触发时刻时，先不要在启动恢复里抢跑结束卡；到点后 outbox
 * 结果会先落库，下一次恢复再按实际梦话数量收尾。到点已过的任务不拦恢复——它可能是
 * Worker 按 25% 机会静默跳过，也可能结果正在补收，结束卡的幂等闸会挡住迟到结果。
 */
export const hasFutureBackgroundDreamJob = (sessionId: string, now = Date.now()): boolean => {
  try {
    const parsed = JSON.parse(localStorage.getItem('sully-call-background-jobs-v1') || '[]');
    return Array.isArray(parsed) && parsed.some((job: any) => (
      job?.input?.sessionId === sessionId
      && typeof job?.firstSendTime === 'string'
      && Number.isFinite(Date.parse(job.firstSendTime))
      && Date.parse(job.firstSendTime) > now
    ));
  } catch {
    return false;
  }
};

export const loadSleepCompanionSession = (): PersistedSleepCompanionSession | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SLEEP_SESSION_KEY) || 'null');
    if (!parsed || parsed.version !== 2) return null;
    if (typeof parsed.charId !== 'string' || typeof parsed.sessionId !== 'string') return null;
    if (!isFiniteTimestamp(parsed.startedAt)) return null;
    return {
      version: 2,
      charId: parsed.charId,
      charName: typeof parsed.charName === 'string' && parsed.charName ? parsed.charName : '对方',
      charAvatar: typeof parsed.charAvatar === 'string' ? parsed.charAvatar : undefined,
      sessionId: parsed.sessionId,
      startedAt: parsed.startedAt,
      callMode: parsed.callMode === 'video' ? 'video' : 'voice',
      autoHangupAt: isFiniteTimestamp(parsed.autoHangupAt) ? parsed.autoHangupAt : null,
      dreamEnabled: parsed.dreamEnabled !== false,
      dreamCount: Math.max(0, Math.floor(Number(parsed.dreamCount) || 0)),
      nextDreamCheckAt: isFiniteTimestamp(parsed.nextDreamCheckAt) ? parsed.nextDreamCheckAt : null,
      updatedAt: isFiniteTimestamp(parsed.updatedAt) ? parsed.updatedAt : parsed.startedAt,
    };
  } catch {
    return null;
  }
};

export const saveSleepCompanionSession = (
  session: Omit<PersistedSleepCompanionSession, 'version' | 'updatedAt'> & { updatedAt?: number },
): PersistedSleepCompanionSession => {
  const value: PersistedSleepCompanionSession = {
    ...session,
    version: 2,
    updatedAt: session.updatedAt || Date.now(),
  };
  try { localStorage.setItem(SLEEP_SESSION_KEY, JSON.stringify(value)); } catch { /* private WebView */ }
  return value;
};

export const updateSleepCompanionSession = (
  patch: Partial<Omit<PersistedSleepCompanionSession, 'version' | 'charId' | 'sessionId' | 'startedAt'>>,
): PersistedSleepCompanionSession | null => {
  const current = loadSleepCompanionSession();
  if (!current) return null;
  return saveSleepCompanionSession({ ...current, ...patch, updatedAt: Date.now() });
};

export const clearSleepCompanionSession = (sessionId?: string): void => {
  try {
    if (sessionId) {
      const current = loadSleepCompanionSession();
      if (current && current.sessionId !== sessionId) return;
    }
    localStorage.removeItem(SLEEP_SESSION_KEY);
  } catch { /* private WebView */ }
};

export const summarizeCallKeepsake = (
  transcript: Array<Pick<Message, 'role' | 'content'>>,
  charName: string,
): string => {
  const assistantLine = [...transcript].reverse().find(item => item.role === 'assistant' && item.content.trim());
  if (!assistantLine) return `这通电话我会悄悄收藏，下次也记得来找我。 —— ${charName}`;
  const normalized = assistantLine.content.replace(/\s+/g, ' ').trim();
  const cutAt = normalized.search(/[。！？!?]/);
  const sentence = cutAt >= 0 ? normalized.slice(0, cutAt + 1) : normalized.slice(0, 42);
  const polished = sentence.length > 48 ? `${sentence.slice(0, 48)}…` : sentence;
  return `“${polished.replace(/^[“”"']+|[“”"']+$/g, '')}” —— ${charName}`;
};

/**
 * PWA 被 iOS 冻结/回收后，页面内 setTimeout 无法再调用 finishCall。
 * 下次启动时用已落库的通话消息幂等地补一张结束卡：
 * 已有同 session 卡片就只清理残留状态，绝不重复生成。
 */
export async function recoverInterruptedSleepCompanionSession(
  now = Date.now(),
): Promise<RecoveredSleepCompanionResult | null> {
  const session = loadSleepCompanionSession();
  if (!session) return null;
  if (hasFutureBackgroundDreamJob(session.sessionId, now)) return null;

  const all = await DB.getMessagesByCharId(session.charId, true);
  const existing = all.find(message => (
    message.metadata?.source === 'call-end-popup'
    && String(message.metadata?.callSessionId || '') === session.sessionId
  ));
  if (existing) {
    clearSleepCompanionSession(session.sessionId);
    return { created: false, charId: session.charId, sessionId: session.sessionId, dreamCount: Number(existing.metadata?.sleepDreamCount) || 0 };
  }

  const transcript = all
    .filter(message => message.metadata?.source === 'call' && String(message.metadata?.callSessionId || '') === session.sessionId)
    .sort((a, b) => a.timestamp - b.timestamp);
  const dreamMessages = transcript.filter(message => message.metadata?.sleepPhase === 'dream');
  const endedAt = session.autoHangupAt && session.autoHangupAt <= now ? session.autoHangupAt : now;
  const lastMessageAt = transcript[transcript.length - 1]?.timestamp || session.startedAt;
  const effectiveEnd = Math.max(session.startedAt + 1000, Math.min(now, Math.max(endedAt, lastMessageAt)));
  const durationSec = Math.max(1, Math.floor((effectiveEnd - session.startedAt) / 1000));
  const turnCount = transcript.filter(message => message.role === 'user').length;
  const dreamCount = dreamMessages.length;
  const keepsakeLine = summarizeCallKeepsake(transcript, session.charName);

  await DB.saveMessage({
    charId: session.charId,
    role: 'system',
    type: 'system',
    content: `陪睡通话已结束 · ${session.charName}｜${Math.floor(durationSec / 60)}分${durationSec % 60}秒｜梦话${dreamCount}句`,
    metadata: {
      source: 'call-end-popup',
      callSessionId: session.sessionId,
      characterId: session.charId,
      characterName: session.charName,
      characterAvatar: session.charAvatar,
      durationSec,
      turnCount,
      keepsakeLine,
      callMode: session.callMode,
      endedAt: effectiveEnd,
      sleepCompanion: true,
      sleepDreamCount: dreamCount,
      sleepRecovered: true,
      sleepEndReason: session.autoHangupAt && session.autoHangupAt <= now ? 'auto-hangup' : 'app-interrupted',
    },
  });
  clearSleepCompanionSession(session.sessionId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: session.charId } }));
  }
  return { created: true, charId: session.charId, sessionId: session.sessionId, dreamCount };
}
