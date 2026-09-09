import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('全局错误弹窗的导航生命周期', () => {
  it('切换 App 或聊天角色时自动清理旧界面的长报错', () => {
    const source = read('../context/OSContext.tsx');
    const stateStart = source.indexOf('const [errorDialog, setErrorDialog]');
    const nextState = source.indexOf('const [lastMsgTimestamp', stateStart);
    expect(stateStart).toBeGreaterThanOrEqual(0);
    expect(nextState).toBeGreaterThan(stateStart);

    const lifecycle = source.slice(stateStart, nextState);
    expect(lifecycle).toContain('setErrorDialog(null);');
    expect(lifecycle).toContain('}, [activeApp, activeCharacterId]);');
  });

  it('保留手动关闭入口和全局弹窗挂载', () => {
    const source = read('../context/OSContext.tsx');
    expect(source).toContain('const dismissError = () => { setErrorDialog(null); };');
    expect(read('../components/PhoneShell.tsx')).toContain('onClose={dismissError}');
  });
});
