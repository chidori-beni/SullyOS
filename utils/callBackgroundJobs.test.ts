import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  getMessagesByCharId: vi.fn(),
  saveMessage: vi.fn(),
  updateMessageMetadata: vi.fn(),
}));

vi.mock('./db', () => ({ DB: dbMock }));
vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: {
    probeBackgroundJobSupportDetailed: vi.fn(),
    scheduleBackgroundJob: vi.fn(),
    cancelTask: vi.fn(),
  },
}));
vi.mock('./amsgLlmCredentials', () => ({ buildCharInstantCredRow: vi.fn(() => null) }));

import { applyCallBackgroundResult } from './callBackgroundJobs';
import { endCallSession, resetCallLifecycleForTests, startCallSession } from './callSessionLifecycle';

describe('call background result bridge', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    resetCallLifecycleForTests();
    values.clear();
    dbMock.getMessagesByCharId.mockReset();
    dbMock.saveMessage.mockReset();
    dbMock.updateMessageMetadata.mockReset();
    dbMock.saveMessage.mockResolvedValue(88);
    dbMock.updateMessageMetadata.mockResolvedValue(undefined);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });

  const reply = (overrides: Record<string, unknown> = {}) => ({
    resultKind: 'call-reply',
    v: 1,
    jobId: 'call-job-1',
    charId: 'char-1',
    charName: '小鹿',
    sessionId: 'session-1',
    callMode: 'voice',
    phase: 'reply',
    text: '<think>内部</think>我还在。',
    generatedAt: 2_000,
    sourceUserMessageId: 12,
    ...overrides,
  });

  it('把 Worker 结果保存成 call assistant，并可被再次通知幂等去重', async () => {
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 10, charId: 'char-1', role: 'user', type: 'text', content: '你在吗？', timestamp: 1_000, metadata: { source: 'call', callSessionId: 'session-1' } },
    ]);

    await expect(applyCallBackgroundResult(reply())).resolves.toBe(true);
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      charId: 'char-1', role: 'assistant', content: '我还在。',
      metadata: expect.objectContaining({
        source: 'call', callSessionId: 'session-1', backgroundGenerated: true,
        backgroundJobId: 'call-job-1', backgroundSourceUserMessageId: 12,
      }),
    }));

    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 88, charId: 'char-1', role: 'assistant', type: 'text', content: '我还在。', timestamp: 2_000, metadata: { source: 'call', callSessionId: 'session-1', backgroundJobId: 'call-job-1' } },
    ]);
    dbMock.saveMessage.mockClear();
    await expect(applyCallBackgroundResult(reply())).resolves.toBe(true);
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
  });

  it('正常结束卡拦住取消竞态的迟到结果', async () => {
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 20, charId: 'char-1', role: 'system', type: 'system', content: '通话结束', timestamp: 1_900, metadata: { source: 'call-end-popup', callSessionId: 'session-1', sleepEndReason: 'normal' } },
    ]);

    await expect(applyCallBackgroundResult(reply())).resolves.toBe(true);
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
  });

  it('结束墓碑先于结束卡片写入时也拦住迟到结果', async () => {
    startCallSession('char-1', 'session-1');
    endCallSession('char-1', 'session-1');
    dbMock.getMessagesByCharId.mockResolvedValue([]);

    await expect(applyCallBackgroundResult(reply())).resolves.toBe(true);
    expect(dbMock.getMessagesByCharId).not.toHaveBeenCalled();
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
  });

  it('中断/恢复卡允许梦话迟到，并更新卡片的实际梦话数量', async () => {
    dbMock.getMessagesByCharId.mockResolvedValue([
      { id: 21, charId: 'char-1', role: 'assistant', type: 'text', content: '晚安。', timestamp: 1_500, metadata: { source: 'call', callSessionId: 'session-1', sleepPhase: 'lullaby' } },
      { id: 22, charId: 'char-1', role: 'system', type: 'system', content: '陪睡通话已结束', timestamp: 1_800, metadata: { source: 'call-end-popup', callSessionId: 'session-1', callInterrupted: true, sleepRecovered: true, sleepDreamCount: 0 } },
    ]);

    await expect(applyCallBackgroundResult(reply({
      resultKind: 'sleep-dream', phase: 'dream', dreamIndex: 0, text: '别怕，我在。',
    }))).resolves.toBe(true);
    expect(dbMock.updateMessageMetadata).toHaveBeenCalledWith(22, expect.any(Function));
    const update = dbMock.updateMessageMetadata.mock.calls[0][1];
    expect(update({ sleepDreamCount: 0 })).toEqual(expect.objectContaining({ sleepCompanion: true, sleepDreamCount: 1 }));
  });
});
