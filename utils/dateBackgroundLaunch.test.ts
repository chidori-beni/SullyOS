import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('见面后台通知直达', () => {
  it('OSContext 会把 date 通知切到 DateApp，并携带同一场 encounter', () => {
    const source = read('../context/OSContext.tsx');
    expect(source).toContain("openApp === 'date' && encounterId");
    expect(source).toContain("dateLaunch.request({");
    expect(source).toContain('setActiveApp(AppID.Date);');
  });

  it('DateApp 不会把上一场同文本用户消息误认成当前场景的重试', () => {
    const source = read('../apps/DateApp.tsx');
    expect(source).toContain("recentCheck[0].metadata?.dateEncounterId === encounterSnapshot.id");
  });
});
