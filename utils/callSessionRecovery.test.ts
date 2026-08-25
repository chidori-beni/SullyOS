import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  getMessagesByCharId: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock('./db', () => ({ DB: dbMock }));

import {
  clearPersistedCallSession,
  loadPersistedCallSession,
  recoverInterruptedCallSession,
  savePersistedCallSession,
} from './callSessionRecovery';

describe('persisted call session recovery', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    dbMock.getMessagesByCharId.mockReset();
    dbMock.saveMessage.mockReset();
    dbMock.saveMessage.mockResolvedValue(99);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it('进程被中断后按已落库正文补一张中断卡，并清掉恢复标记', async () => {
    savePersistedCallSession({
      charId: 'char-1', charName: '小鹿', sessionId: 'call-1', startedAt: 1_000,
      callMode: 'voice',
    });
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 1, charId: 'char-1', role: 'user', type: 'text', content: '你还在吗？', timestamp: 2_000, metadata: { source: 'call', callSessionId: 'call-1' } },
      { id: 2, charId: 'char-1', role: 'assistant', type: 'text', content: '我在。', timestamp: 3_000, metadata: { source: 'call', callSessionId: 'call-1' } },
    ]);

    const result = await recoverInterruptedCallSession(5_000);

    expect(result).toMatchObject({ created: true, sessionId: 'call-1', interrupted: true });
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('通话已中断并保存'),
      metadata: expect.objectContaining({
        source: 'call-end-popup',
        callSessionId: 'call-1',
        callInterrupted: true,
        turnCount: 1,
      }),
    }));
    expect(loadPersistedCallSession()).toBeNull();
  });

  it('没有任何通话正文时不伪造结束卡', async () => {
    savePersistedCallSession({
      charId: 'char-1', charName: '小鹿', sessionId: 'call-empty', startedAt: 1_000,
      callMode: 'voice',
    });
    dbMock.getMessagesByCharId.mockResolvedValue([]);

    await expect(recoverInterruptedCallSession(5_000)).resolves.toBeNull();
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
    expect(loadPersistedCallSession()).toBeNull();
  });

  it('已有同 session 卡片时只清残留，不重复落库', async () => {
    savePersistedCallSession({
      charId: 'char-1', charName: '小鹿', sessionId: 'call-done', startedAt: 1_000,
      callMode: 'voice',
    });
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 9, charId: 'char-1', role: 'system', type: 'system', content: '通话结束', timestamp: 4_000, metadata: { source: 'call-end-popup', callSessionId: 'call-done', callInterrupted: true } },
    ]);

    const result = await recoverInterruptedCallSession(5_000);

    expect(result).toMatchObject({ created: false, sessionId: 'call-done', interrupted: true });
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
    expect(loadPersistedCallSession()).toBeNull();
  });

  it('清理带 session 条件，不会误删新通话标记', () => {
    savePersistedCallSession({
      charId: 'char-1', charName: '小鹿', sessionId: 'new-call', startedAt: 1_000,
      callMode: 'voice',
    });
    clearPersistedCallSession('old-call');
    expect(loadPersistedCallSession()?.sessionId).toBe('new-call');
  });
});
