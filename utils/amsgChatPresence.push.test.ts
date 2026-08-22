import { describe, it, expect } from 'vitest';
import {
  isForegroundForPush,
  isFreshChatPresence,
  CHAT_PRESENCE_PUSH_FRESH_MS,
  CHAT_PRESENCE_TTL_MS,
  CHAT_PRESENCE_HEARTBEAT_MS,
  type AmsgChatPresence,
} from './amsgChatPresence';

const NOW = 1_700_000_000_000;
const presence = (over: Partial<AmsgChatPresence> = {}): AmsgChatPresence => ({
  v: 1,
  charId: 'c1',
  activeAt: NOW,
  lastUserMessageAt: NOW - 1000,
  ...over,
});

describe('isForegroundForPush — 决定要不要发系统通知', () => {
  it('刚续过租 → 认为在前台（不发系统通知）', () => {
    expect(isForegroundForPush(presence(), 'c1', NOW)).toBe(true);
  });

  it('心跳停了超过窗口 → 认为人已离开（发系统通知）', () => {
    const gone = presence({ activeAt: NOW - CHAT_PRESENCE_PUSH_FRESH_MS - 1 });
    expect(isForegroundForPush(gone, 'c1', NOW)).toBe(false);
  });

  it('窗口边界内仍算前台', () => {
    const edge = presence({ activeAt: NOW - CHAT_PRESENCE_PUSH_FRESH_MS });
    expect(isForegroundForPush(edge, 'c1', NOW)).toBe(true);
  });

  it('关键回归：45s TTL 里但超过推送窗口 —— 旧逻辑会误判成前台，新逻辑必须判为离开', () => {
    // 「发完消息立刻切后台，回复 20 秒后才到」正是之前收不到通知的场景
    const backgrounded = presence({ activeAt: NOW - 20_000 });
    expect(isFreshChatPresence(backgrounded, 'c1', NOW)).toBe(true);   // 旧判定：还算新鲜
    expect(isForegroundForPush(backgrounded, 'c1', NOW)).toBe(false);  // 新判定：人已经走了
  });

  it('显式下线标记（activeAt=0）立刻判为离开', () => {
    expect(isForegroundForPush(presence({ activeAt: 0 }), 'c1', NOW)).toBe(false);
  });

  it('角色对不上 / 空值 → 判为离开（保留系统通知）', () => {
    expect(isForegroundForPush(presence(), 'c2', NOW)).toBe(false);
    expect(isForegroundForPush(null, 'c1', NOW)).toBe(false);
    expect(isForegroundForPush(undefined, 'c1', NOW)).toBe(false);
  });

  it('推送窗口必须明显短于 TTL，否则这次修的问题会复发', () => {
    expect(CHAT_PRESENCE_PUSH_FRESH_MS).toBeLessThan(CHAT_PRESENCE_TTL_MS);
  });

  it('窗口要容得下丢一拍心跳，否则前台会被误判成后台', () => {
    expect(CHAT_PRESENCE_PUSH_FRESH_MS).toBeGreaterThan(CHAT_PRESENCE_HEARTBEAT_MS * 2);
  });
});
