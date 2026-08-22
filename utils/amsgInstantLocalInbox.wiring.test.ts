import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./activeMsgRuntime.ts', import.meta.url), 'utf8');

describe('iOS 前台即时对话本地 inbox 保险丝', () => {
  it('只在前台且有待收回复时，每秒检查一次本地收件箱', () => {
    expect(source).toContain('INSTANT_CHAT_LOCAL_INBOX_CHECK_INTERVAL_MS = 1_000');
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain('listInstantChatPendings().length === 0');
    expect(source).toContain('drainOutboxAndFlush().finally(() => scheduleLocalInstantChatInboxCheck())');
  });

  it('受理新任务时同时排上 60s 云端点名与 1s 本地检查', () => {
    expect(source).toMatch(
      /AMSG_INSTANT_CHAT_PENDING_EVENT[\s\S]{0,180}scheduleNextInstantChatStatusCheck\(\);[\s\S]{0,100}scheduleLocalInstantChatInboxCheck\(\);/,
    );
  });

  it('回到前台和冷启动恢复 pending 时都会重启本地检查', () => {
    const calls = source.match(/scheduleLocalInstantChatInboxCheck\(\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(
      /await flushInboxToChat\(\);[\s\S]{0,100}scheduleLocalInstantChatInboxCheck\(\);/,
    );
    expect(source).toMatch(
      /if \(listInstantChatPendings\(\)\.length > 0\) \{[\s\S]{0,100}scheduleLocalInstantChatInboxCheck\(\);/,
    );
  });
});
