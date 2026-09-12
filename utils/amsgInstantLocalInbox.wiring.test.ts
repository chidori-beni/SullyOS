import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./activeMsgRuntime.ts', import.meta.url), 'utf8');

describe('iOS 前台即时对话本地 inbox 保险丝', () => {
  it('只在前台且有待收回复时，每秒检查一次本地收件箱', () => {
    expect(source).toContain('INSTANT_CHAT_LOCAL_INBOX_CHECK_INTERVAL_MS = 1_000');
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain('listInstantChatPendings().length === 0');
    // 上游 f39d7cc6 起 drainOutboxAndFlush 要带一个 FlushTrigger（排障时要分清是谁把消息捞回来的）。
    expect(source).toContain("drainOutboxAndFlush('轮询补收').finally(() => scheduleLocalInstantChatInboxCheck())");
  });

  it('受理新任务时同时排上 60s 云端点名与 1s 本地检查', () => {
    expect(source).toMatch(
      /AMSG_INSTANT_CHAT_PENDING_EVENT[\s\S]{0,180}scheduleNextInstantChatStatusCheck\(\);[\s\S]{0,100}scheduleLocalInstantChatInboxCheck\(\);/,
    );
  });

  it('回到前台和冷启动恢复 pending 时都会重启本地检查', () => {
    const calls = source.match(/scheduleLocalInstantChatInboxCheck\(\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // 回到前台这条路：上游 67b2c106 把「记时刻 + flush + 补收 + 点名」抽成了
    // handlePageBecameVisible()，flush 不再直接写在 visibilitychange 里。这里改成钉
    // 「本地检查排上了，紧接着就走那个入口」——保的还是同一件事：回前台会重启本地检查。
    expect(source).toMatch(
      /scheduleLocalInstantChatInboxCheck\(\);[\s\S]{0,200}handlePageBecameVisible\(\);/,
    );
    expect(source).toContain("await flushInboxToChat('回到前台');");
    expect(source).toMatch(
      /if \(listInstantChatPendings\(\)\.length > 0\) \{[\s\S]{0,100}scheduleLocalInstantChatInboxCheck\(\);/,
    );
  });
});
