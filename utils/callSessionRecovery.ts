/**
 * 普通通话的进程级恢复标记。
 *
 * 通话正文每轮都会先写 IndexedDB，但结束卡以前只在 finishCall 的 React 闭包里写。PWA
 * 被系统回收时那一步不存在，所以这里只保存“哪一通还活着”的小元数据，下一次启动按
 * sessionId 从 messages 表重建结束卡。所有写入都幂等，正常挂断会主动清掉标记。
 */

import type { Message } from '../types';
import { DB } from './db';
import { loadSleepCompanionSession } from './sleepCompanionSession';

const CALL_SESSION_KEY = 'sully-call-session-v1';

export interface PersistedCallSession {
  v: 1;
  charId: string;
  charName: string;
  charAvatar?: string;
  sessionId: string;
  startedAt: number;
  callMode: 'voice' | 'video';
  updatedAt: number;
}

const timestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
);

export const loadPersistedCallSession = (): PersistedCallSession | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CALL_SESSION_KEY) || 'null');
    if (!parsed || parsed.v !== 1
      || typeof parsed.charId !== 'string' || !parsed.charId
      || typeof parsed.sessionId !== 'string' || !parsed.sessionId
      || !timestamp(parsed.startedAt)) return null;
    return {
      v: 1,
      charId: parsed.charId,
      charName: typeof parsed.charName === 'string' && parsed.charName ? parsed.charName : '对方',
      charAvatar: typeof parsed.charAvatar === 'string' ? parsed.charAvatar : undefined,
      sessionId: parsed.sessionId,
      startedAt: parsed.startedAt,
      callMode: parsed.callMode === 'video' ? 'video' : 'voice',
      updatedAt: timestamp(parsed.updatedAt) ? parsed.updatedAt : parsed.startedAt,
    };
  } catch {
    return null;
  }
};

export const savePersistedCallSession = (
  session: Omit<PersistedCallSession, 'v' | 'updatedAt'> & { updatedAt?: number },
): PersistedCallSession => {
  const value: PersistedCallSession = { ...session, v: 1, updatedAt: session.updatedAt || Date.now() };
  try { localStorage.setItem(CALL_SESSION_KEY, JSON.stringify(value)); } catch { /* private WebView */ }
  return value;
};

export const updatePersistedCallSession = (
  patch: Partial<Omit<PersistedCallSession, 'v' | 'charId' | 'sessionId' | 'startedAt'>>,
): PersistedCallSession | null => {
  const current = loadPersistedCallSession();
  if (!current) return null;
  return savePersistedCallSession({ ...current, ...patch, updatedAt: Date.now() });
};

export const clearPersistedCallSession = (sessionId?: string): void => {
  try {
    if (sessionId) {
      const current = loadPersistedCallSession();
      if (current && current.sessionId !== sessionId) return;
    }
    localStorage.removeItem(CALL_SESSION_KEY);
  } catch { /* private WebView */ }
};

const callTranscript = (messages: Message[], sessionId: string): Message[] => messages
  .filter(message => message.metadata?.source === 'call'
    && String(message.metadata?.callSessionId || '') === sessionId)
  .sort((a, b) => a.timestamp - b.timestamp);

const summarize = (transcript: Message[], charName: string): string => {
  const assistant = [...transcript].reverse().find(message => message.role === 'assistant' && message.content.trim());
  if (!assistant) return `这通电话我会悄悄收藏，下次也记得来找我。 —— ${charName}`;
  const compact = assistant.content.replace(/\s+/g, ' ').trim();
  const end = compact.search(/[。！？!?]/);
  const sentence = end >= 0 ? compact.slice(0, end + 1) : compact.slice(0, 42);
  return `“${sentence.length > 48 ? `${sentence.slice(0, 48)}…` : sentence}” —— ${charName}`;
};

export interface RecoveredCallSessionResult {
  created: boolean;
  charId: string;
  sessionId: string;
  interrupted: boolean;
  dreamCount: number;
}

/** 启动时补一张普通/陪睡通话结束卡；已有卡片、没有正文都不会重复制造。 */
export const recoverInterruptedCallSession = async (now = Date.now()): Promise<RecoveredCallSessionResult | null> => {
  const session = loadPersistedCallSession();
  if (!session) return null;
  // 陪睡有自己的恢复器：它需要先判断未来梦话任务是否仍在 Worker 排队。普通通话
  // 恢复器不能在它返回「暂缓」时抢先写一张中断卡，否则 OSContext 随后会把未来梦话
  // 任务一并取消。只要睡眠 session 标记仍在，就把决定权留给 sleepCompanionSession。
  if (loadSleepCompanionSession()?.sessionId === session.sessionId) return null;
  const all = await DB.getMessagesByCharId(session.charId, true);
  const existing = all.find(message => message.metadata?.source === 'call-end-popup'
    && String(message.metadata?.callSessionId || '') === session.sessionId);
  if (existing) {
    clearPersistedCallSession(session.sessionId);
    return {
      created: false,
      charId: session.charId,
      sessionId: session.sessionId,
      interrupted: existing.metadata?.callInterrupted === true,
      dreamCount: Number(existing.metadata?.sleepDreamCount) || 0,
    };
  }
  const transcript = callTranscript(all, session.sessionId);
  if (transcript.length === 0) {
    clearPersistedCallSession(session.sessionId);
    return null;
  }
  const dreamCount = transcript.filter(message => message.metadata?.sleepPhase === 'dream').length;
  const sleepCompanion = transcript.some(message => (
    message.metadata?.sleepPhase === 'dream' || message.metadata?.sleepPhase === 'lullaby'
  ));
  const lastMessageAt = transcript[transcript.length - 1]?.timestamp || session.startedAt;
  const endedAt = Math.max(session.startedAt + 1000, Math.min(now, Math.max(lastMessageAt, session.updatedAt)));
  const durationSec = Math.max(1, Math.floor((endedAt - session.startedAt) / 1000));
  const turnCount = transcript.filter(message => message.role === 'user').length;
  await DB.saveMessage({
    charId: session.charId,
    role: 'system',
    type: 'system',
    content: sleepCompanion
      ? `陪睡通话已结束 · ${session.charName}｜${Math.floor(durationSec / 60)}分${durationSec % 60}秒｜梦话${dreamCount}句`
      : `通话已中断并保存 · ${session.charName}｜${Math.floor(durationSec / 60)}分${durationSec % 60}秒｜${turnCount}轮对话`,
    metadata: {
      source: 'call-end-popup',
      callSessionId: session.sessionId,
      characterId: session.charId,
      characterName: session.charName,
      characterAvatar: session.charAvatar,
      durationSec,
      turnCount,
      keepsakeLine: summarize(transcript, session.charName),
      callMode: session.callMode,
      endedAt,
      callInterrupted: true,
      ...(sleepCompanion ? {
        sleepCompanion: true,
        sleepDreamCount: dreamCount,
        sleepRecovered: true,
        sleepEndReason: 'app-interrupted',
      } : {}),
    },
  });
  clearPersistedCallSession(session.sessionId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: session.charId } }));
  }
  return { created: true, charId: session.charId, sessionId: session.sessionId, interrupted: true, dreamCount };
};
