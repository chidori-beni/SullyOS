import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('SYSTEM ERROR 状态栏提示的导航生命周期', () => {
  it('切换 App 时收起旧提示并关闭调试终端', () => {
    const source = read('../components/os/StatusBar.tsx');

    expect(source).toContain('const { virtualTime, theme, activeApp, systemLogs, clearLogs } = useOS();');
    expect(source).toContain('setErrorIndicatorDismissed(true);');
    expect(source).toContain('setShowLogModal(false);');
    expect(source).toContain('}, [activeApp]);');
  });

  it('新日志出现时重新显示提示，即使日志数量已达到上限', () => {
    const source = read('../components/os/StatusBar.tsx');

    expect(source).toContain('const latestLogId = systemLogs[0]?.id ?? null;');
    expect(source).toContain('if (latestLogId !== null) setErrorIndicatorDismissed(false);');
    expect(source).toContain('const hasError = systemLogs.length > 0 && !errorIndicatorDismissed;');
  });
});
