import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getMessagesByCharId: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock('./db', () => ({ DB: dbMock }));
vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: {
    probeDateBackgroundJobSupportDetailed: vi.fn(),
    scheduleBackgroundJob: vi.fn(),
    cancelTask: vi.fn(),
  },
  mayHaveCreatedBackgroundJob: vi.fn(() => false),
}));
vi.mock('./amsgLlmCredentials', () => ({
  buildCharInstantCredRow: vi.fn(() => ({
    credId: 'char:char-1/instant',
    value: { apiUrl: 'https://api.example/chat/completions', apiKey: 'key', primaryModel: 'model' },
  })),
}));

import { applyDateBackgroundResult } from './dateBackgroundJobs';

describe('date background result bridge', () => {
  beforeEach(() => {
    dbMock.getCharacter.mockReset().mockResolvedValue({
      id: 'char-1',
      name: '小满',
      activeDateEncounter: {
        encounterId: 'enc-1',
        startedAt: 1_000,
        status: 'active',
        sceneClockAt: 2_000,
        sceneClockAdvancedMs: 0,
        sceneClockRevision: 3,
      },
    });
    dbMock.getMessagesByCharId.mockReset().mockResolvedValue([
      {
        id: 42,
        charId: 'char-1',
        role: 'user',
        type: 'text',
        content: '我来了。',
        timestamp: 2_100,
        metadata: { source: 'date', dateEncounterId: 'enc-1' },
      },
    ]);
    dbMock.saveMessage.mockReset().mockResolvedValue(43);
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  const result = (overrides: Record<string, unknown> = {}) => ({
    v: 1,
    resultKind: 'date-reply',
    clientJobId: 'date-enc-1-42',
    charId: 'char-1',
    charName: '小满',
    encounterId: 'enc-1',
    encounterStartedAt: 1_000,
    sourceUserMessageId: 42,
    turnKind: 'reply',
    sceneClockAt: 2_000,
    sceneClockAdvancedMs: 0,
    sceneClockRevision: 3,
    text: '<think>内部</think>[normal] 我回来了。[[END_MEETING:天亮了]]',
    generatedAt: 2_200,
    ...overrides,
  });

  it('保存见面 assistant，清理协议标记并保留结束建议', async () => {
    await expect(applyDateBackgroundResult(result())).resolves.toBe(true);
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: '[normal] 我回来了。',
      metadata: expect.objectContaining({
        source: 'date',
        dateEncounterId: 'enc-1',
        backgroundGenerated: true,
        backgroundJobId: 'date-enc-1-42',
        endMeetingReason: '天亮了',
      }),
    }));
  });

  it('结果重复或时钟版本已变化时不再次写入', async () => {
    dbMock.getMessagesByCharId.mockResolvedValueOnce([
      {
        id: 42,
        charId: 'char-1',
        role: 'user',
        type: 'text',
        content: '我来了。',
        timestamp: 2_100,
        metadata: { source: 'date', dateEncounterId: 'enc-1' },
      },
      {
        id: 43,
        charId: 'char-1',
        role: 'assistant',
        type: 'text',
        content: '我回来了。',
        timestamp: 2_200,
        metadata: { source: 'date', dateBackgroundClientJobId: 'date-enc-1-42' },
      },
    ]);
    await expect(applyDateBackgroundResult(result())).resolves.toBe(true);
    expect(dbMock.saveMessage).not.toHaveBeenCalled();

    dbMock.getMessagesByCharId.mockResolvedValueOnce([{
      id: 42,
      charId: 'char-1',
      role: 'user',
      type: 'text',
      content: '我来了。',
      timestamp: 2_100,
      metadata: { source: 'date', dateEncounterId: 'enc-1' },
    }]);
    dbMock.getCharacter.mockResolvedValueOnce({
      id: 'char-1',
      activeDateEncounter: { encounterId: 'enc-1', startedAt: 1_000, status: 'active', sceneClockRevision: 4 },
    });
    await expect(applyDateBackgroundResult(result())).resolves.toBe(true);
    expect(dbMock.saveMessage).not.toHaveBeenCalled();
  });
});
