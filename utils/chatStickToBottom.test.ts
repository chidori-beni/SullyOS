import { describe, expect, it } from 'vitest';
import { nextStickToBottom, shouldFollowNewMessage } from './chatStickToBottom';

describe('nextStickToBottom', () => {
  it('手指往上翻、离开底部 → 不再跟', () => {
    expect(nextStickToBottom(true, 500, 800, 300)).toBe(false);
  });

  it('翻回底部附近 → 重新跟', () => {
    expect(nextStickToBottom(false, 900, 500, 40)).toBe(true);
  });

  it('平滑滚动半路（往下走、离底部还远）→ 不算用户翻上去', () => {
    expect(nextStickToBottom(true, 600, 500, 400)).toBe(true);
  });

  it('翻上去之后继续往下滑但还没到底 → 仍然不跟', () => {
    expect(nextStickToBottom(false, 600, 500, 400)).toBe(false);
  });
});

describe('shouldFollowNewMessage', () => {
  it('用户翻上去时，角色的新消息不拽人', () => {
    expect(shouldFollowNewMessage(false, 10, false)).toBe(false);
  });

  it('用户在底部时跟着滚', () => {
    expect(shouldFollowNewMessage(true, 10, false)).toBe(true);
  });

  it('用户自己发的，翻上去也要滚', () => {
    expect(shouldFollowNewMessage(false, 10, true)).toBe(true);
  });

  it('刚打开这段聊天一律到底', () => {
    expect(shouldFollowNewMessage(false, null, false)).toBe(true);
  });
});
