import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./activeMsgRuntime.ts', import.meta.url), 'utf8');

describe('前台主动消息收件补偿', () => {
  it('前台定时冲刷本地 inbox 并拉云端 outbox', () => {
    expect(source).toContain('FOREGROUND_ACTIVE_MSG_CATCH_UP_INTERVAL_MS = 30_000');
    expect(source).toContain('foregroundActiveMsgCatchUpTimer');
    expect(source).toContain('await flushInboxToChat();');
    expect(source).toContain("await catchUpMissedPushes('foreground');");
    expect(source).toContain('scheduleForegroundActiveMsgCatchUp();');
  });

  it('退到后台会清除定时器，回到前台和冷启动会重新排上', () => {
    expect(source).toContain('stopForegroundActiveMsgCatchUp();');
    expect(source).toMatch(
      /if \(document\.visibilityState !== 'visible'\) \{[\s\S]{0,120}stopForegroundActiveMsgCatchUp\(\);[\s\S]{0,120}return;/,
    );
    expect(source).toMatch(
      /document\.addEventListener\('visibilitychange',[\s\S]{0,450}scheduleForegroundActiveMsgCatchUp\(\);/,
    );
    expect(source).toMatch(
      /void catchUpMissedPushes\('startup'\);[\s\S]{0,220}scheduleForegroundActiveMsgCatchUp\(\);/,
    );
  });
});
