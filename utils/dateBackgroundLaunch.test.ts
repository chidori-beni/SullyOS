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

  it('前台排队只保留轻量等待状态，不弹后台生成提醒', () => {
    const dateApp = read('../apps/DateApp.tsx');
    const session = read('../components/date/DateSession.tsx');
    expect(dateApp).not.toContain('已交给后台生成，切到后台也会继续');
    expect(dateApp).not.toContain('后台任务正在确认，稍后会自动补收结果');
    expect(session).toContain("setCurrentText('正在回复…')");
    expect(session).toContain("backgroundPending ? '正在回复…' : '此时此刻'");
    expect(session).not.toContain('后台生成中 · 离开后也会继续');
    expect(session).not.toContain('后台正在延续此刻');
  });
});
