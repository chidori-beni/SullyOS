import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OUTBOX_GATE_MAX_WAIT_MS,
  catchUpMissedPushes,
  flushInboxToChat,
  isLandingForAbsentUser,
  notePageBecameVisible,
  resetOutboxCatchUpThrottleForTesting,
} from './activeMsgRuntime';
import { AMSG_INSTANT_CHAT_PENDING_LS_KEY, AMSG_OUTBOX_ADOPTED_LS_KEY } from './amsgInstantChat';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { DB } from './db';

// 用户原话：「一下午没开，晚上打开十几条一口气上屏，最先收到的那条反而在最末尾」。
//
// 聊天流的先后只看写库先后（自增 id），不看消息上的时间。推送有的到了本机收件箱、有的
// 丢在路上只留在云端账本——而苹果的推送服务在设备不方便收时只留最新的那条，丢的往往
// 正是**早的**。以前开 App 先冲本机收件箱、再去拉账本，早的那几条就永远排在最后。
describe('打开 App 时的上屏顺序（走真库）', () => {
  const HOUR = 3_600_000;
  const WORKER_URL = 'https://amsg-order.example.workers.dev';

  const envelope = (charId: string, messageId: string, sentAt: number, body: string) => ({
    messageKind: 'content',
    messageType: 'scheduled',
    source: 'scheduled',
    message: body,
    contactName: '自然主动角色',
    messageId,
    taskUuid: `uuid-${messageId}`,
    timestamp: new Date(sentAt).toISOString(),
    metadata: { charId, charName: '自然主动角色' },
  });

  const ledgerEntry = (charId: string, messageId: string, sentAt: number, body: string) => ({
    id: sentAt,
    messageId,
    taskUuid: `uuid-${messageId}`,
    createdAt: sentAt,
    deliveredAt: sentAt,
    push: envelope(charId, messageId, sentAt, body),
  });

  const pushInInbox = (charId: string, messageId: string, sentAt: number, body: string) => ({
    messageId,
    charId,
    charName: '自然主动角色',
    body,
    messageType: 'scheduled',
    source: 'scheduled',
    taskUuid: `uuid-${messageId}`,
    metadata: { charId },
    sentAt,
    receivedAt: sentAt + 1_000,
  }) as any;

  const chatBodies = async (charId: string) =>
    (await DB.getRecentMessagesByCharId(charId, 50))
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content);

  beforeAll(() => {
    (globalThis as any).window ??= { dispatchEvent: () => true, addEventListener: () => {} };
  });

  beforeEach(async () => {
    localStorage.removeItem(AMSG_INSTANT_CHAT_PENDING_LS_KEY);
    localStorage.setItem(AMSG_OUTBOX_ADOPTED_LS_KEY, JSON.stringify({ at: Date.now() }));
    resetOutboxCatchUpThrottleForTesting();
    await ActiveMsgStore.saveGlobalConfig({ workerUrl: WORKER_URL });
    vi.spyOn(ActiveMsgClient, 'ackOutboxMessages').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await ActiveMsgStore.saveGlobalConfig({ workerUrl: '' });
    notePageBecameVisible(0);
  });

  it('早的只在账本上、晚的已到本机：打开后仍按发送时间排', async () => {
    const charId = 'char-order-basic';
    await DB.saveCharacter({ id: charId, name: '自然主动角色' } as any);
    const base = Date.now() - 6 * HOUR;
    // 下午一点、两点那两条的推送丢了；五点那条到了本机收件箱。
    await ActiveMsgStore.saveInboxMessage(pushInInbox(charId, 'order-17', base + 4 * HOUR, '五点那条'));
    vi.spyOn(ActiveMsgClient, 'listOutboxEntries').mockResolvedValue([
      ledgerEntry(charId, 'order-13', base, '一点那条'),
      ledgerEntry(charId, 'order-14', base + HOUR, '两点那条'),
      ledgerEntry(charId, 'order-17', base + 4 * HOUR, '五点那条'),
    ] as any);

    // 跟 init / handlePageBecameVisible 同样的调用次序。
    const catchUp = catchUpMissedPushes('startup');
    await flushInboxToChat('启动');
    await catchUp;
    await flushInboxToChat('本地巡查');

    expect(await chatBodies(charId)).toEqual(['一点那条', '两点那条', '五点那条']);
  }, 20000);

  it('云端账本一直不回话：等到上限就先放本机这批，不能让人干等', async () => {
    const charId = 'char-order-timeout';
    await DB.saveCharacter({ id: charId, name: '自然主动角色' } as any);
    await ActiveMsgStore.saveInboxMessage(pushInInbox(charId, 'timeout-1', Date.now() - HOUR, '本机这条'));
    vi.spyOn(ActiveMsgClient, 'listOutboxEntries').mockImplementation(() => new Promise(() => {}));

    const startedAt = Date.now();
    void catchUpMissedPushes('startup');
    await flushInboxToChat('启动');

    expect(await chatBodies(charId)).toEqual(['本机这条']);
    expect(Date.now() - startedAt).toBeLessThan(OUTBOX_GATE_MAX_WAIT_MS + 3_000);
  }, 20000);
});

// 用户原话：「在后台已经弹过系统通知的，打开时应该已经显示在那里，而不是一条一条落」；
// 「开着 App 时收到的可以有时间差」。
describe('离开期间的消息整批上屏', () => {
  const HOUR = 3_600_000;

  const dispatched: Array<{ type: string; detail: any }> = [];

  beforeAll(() => {
    (globalThis as any).window ??= { addEventListener: () => {} };
  });

  beforeEach(() => {
    dispatched.length = 0;
    vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
      dispatched.push({ type: event.type, detail: (event as CustomEvent).detail });
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    notePageBecameVisible(0);
  });

  const saveInbox = (charId: string, messageId: string, sentAt: number, receivedAt: number, body: string) =>
    ActiveMsgStore.saveInboxMessage({
      messageId, charId, charName: '角色', body, messageType: 'scheduled', source: 'scheduled',
      metadata: { charId }, sentAt, receivedAt,
    } as any);

  it('三条都是离开时到的：界面只刷新一次，且排在全部落库之后', async () => {
    const charId = 'char-batch-away';
    await DB.saveCharacter({ id: charId, name: '角色' } as any);
    const base = Date.now() - 3 * HOUR;
    notePageBecameVisible(Date.now() - 1_000);
    await saveInbox(charId, 'away-1', base, base + 1_000, '第一条');
    await saveInbox(charId, 'away-2', base + HOUR, base + HOUR + 1_000, '第二条');
    await saveInbox(charId, 'away-3', base + 2 * HOUR, base + 2 * HOUR + 1_000, '第三条');

    await flushInboxToChat('启动');

    const progress = dispatched.filter((e) => e.type === 'active-msg-progress');
    expect(progress).toHaveLength(1);
    expect(progress[0].detail.charId).toBe(charId);
    const received = dispatched.filter((e) => e.type === 'active-msg-received');
    expect(received).toHaveLength(3);
    expect(received.every((e) => e.detail.quietUi === true)).toBe(true);
    expect(dispatched.map((e) => e.type).lastIndexOf('active-msg-received'))
      .toBeLessThan(dispatched.map((e) => e.type).lastIndexOf('active-msg-progress'));
  }, 20000);

  it('开着 App 时刚到的：照旧逐条刷新，不并进整批', async () => {
    const charId = 'char-batch-live';
    await DB.saveCharacter({ id: charId, name: '角色' } as any);
    const now = Date.now();
    notePageBecameVisible(now - HOUR);
    await saveInbox(charId, 'live-1', now - 500, now - 100, '刚到的');

    await flushInboxToChat('SW通知');

    const received = dispatched.filter((e) => e.type === 'active-msg-received');
    expect(received).toHaveLength(1);
    expect(received[0].detail.quietUi).toBeFalsy();
  }, 20000);
});

describe('isLandingForAbsentUser', () => {
  const NOW = 1_700_000_000_000;
  const VISIBLE_AT = NOW - 10_000;

  it('送达早于回到前台 → 不在场', () => {
    expect(isLandingForAbsentUser({ sentAt: VISIBLE_AT - 60_000, receivedAt: VISIBLE_AT - 50_000 }, NOW, VISIBLE_AT)).toBe(true);
  });

  it('账本补回来的（到达时间是现在）只要发送早于回到前台，也算不在场', () => {
    expect(isLandingForAbsentUser({ sentAt: VISIBLE_AT - 3_600_000, receivedAt: NOW }, NOW, VISIBLE_AT)).toBe(true);
  });

  it('人在前台时才发出的，即使走账本回来也算在场（前台本来就不发推送）', () => {
    expect(isLandingForAbsentUser({ sentAt: NOW - 2_000, receivedAt: NOW }, NOW, VISIBLE_AT)).toBe(false);
  });

  it('还没记录过回到前台的时刻：保守算在场', () => {
    expect(isLandingForAbsentUser({ sentAt: NOW - 2_000, receivedAt: NOW - 1_000 }, NOW, 0)).toBe(false);
  });

  it('在收件箱里躺了很久才被捞：算不在场', () => {
    expect(isLandingForAbsentUser({ sentAt: NOW - 3_600_000, receivedAt: NOW - 3_600_000 }, NOW, 0)).toBe(true);
  });
});
