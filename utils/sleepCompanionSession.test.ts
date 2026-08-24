import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  getMessagesByCharId: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock('./db', () => ({ DB: dbMock }));

import {
  clearSleepCompanionSession,
  loadSleepCompanionSession,
  recoverInterruptedSleepCompanionSession,
  saveSleepCompanionSession,
  updateSleepCompanionSession,
} from './sleepCompanionSession';

describe('persisted sleep companion session', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    dbMock.getMessagesByCharId.mockReset();
    dbMock.saveMessage.mockReset();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it('持久化时保留 session/梦话/挂断截止时间', () => {
    saveSleepCompanionSession({
      charId: 'char-1', charName: '萧逸', sessionId: 'call-1', startedAt: 1000,
      callMode: 'voice', autoHangupAt: 5000, dreamEnabled: true, dreamCount: 0,
      nextDreamCheckAt: 3000,
    });
    updateSleepCompanionSession({ dreamCount: 1, nextDreamCheckAt: 6000 });
    expect(loadSleepCompanionSession()).toMatchObject({
      charId: 'char-1', sessionId: 'call-1', autoHangupAt: 5000,
      dreamCount: 1, nextDreamCheckAt: 6000,
    });
  });

  it('只清理指定的 session，不会误删新一晚的状态', () => {
    saveSleepCompanionSession({
      charId: 'char-1', charName: '萧逸', sessionId: 'new-call', startedAt: 1000,
      callMode: 'voice', autoHangupAt: null, dreamEnabled: true, dreamCount: 0,
      nextDreamCheckAt: null,
    });
    clearSleepCompanionSession('old-call');
    expect(loadSleepCompanionSession()?.sessionId).toBe('new-call');
    clearSleepCompanionSession('new-call');
    expect(loadSleepCompanionSession()).toBeNull();
  });

  it('重启后根据已落库通话内容补结束卡，并统计真正生成的梦话', async () => {
    saveSleepCompanionSession({
      charId: 'char-1', charName: '萧逸', charAvatar: 'avatar', sessionId: 'call-1', startedAt: 1000,
      callMode: 'voice', autoHangupAt: 10_000, dreamEnabled: true, dreamCount: 1,
      nextDreamCheckAt: 20_000,
    });
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 1, charId: 'char-1', role: 'assistant', type: 'text', content: '晚安。', timestamp: 2000, metadata: { source: 'call', callSessionId: 'call-1', sleepPhase: 'lullaby' } },
      { id: 2, charId: 'char-1', role: 'assistant', type: 'text', content: '别走……', timestamp: 5000, metadata: { source: 'call', callSessionId: 'call-1', sleepPhase: 'dream' } },
    ]);
    dbMock.saveMessage.mockResolvedValue(3);

    const result = await recoverInterruptedSleepCompanionSession(12_000);

    expect(result).toMatchObject({ created: true, sessionId: 'call-1', dreamCount: 1 });
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        source: 'call-end-popup', callSessionId: 'call-1', sleepCompanion: true,
        sleepDreamCount: 1, sleepRecovered: true, sleepEndReason: 'auto-hangup',
      }),
    }));
    expect(loadSleepCompanionSession()).toBeNull();
  });

  it('已有同 session 结束卡时幂等去残留，不重复落库', async () => {
    saveSleepCompanionSession({
      charId: 'char-1', charName: '萧逸', sessionId: 'call-1', startedAt: 1000,
      callMode: 'voice', autoHangupAt: 10_000, dreamEnabled: true, dreamCount: 1,
      nextDreamCheckAt: null,
    });
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 9, charId: 'char-1', role: 'system', type: 'system', content: '通话结束', timestamp: 10_000, metadata: { source: 'call-end-popup', callSessionId: 'call-1', sleepDreamCount: 1 } },
    ]);

    const result = await recoverInterruptedSleepCompanionSession(12_000);

    expect(result?.created).toBe(false);
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
    expect(loadSleepCompanionSession()).toBeNull();
  });
});
