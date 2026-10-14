import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi, type UiMessageKey } from './uiLocale';
const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
const start = source.indexOf('const handleSaveProxyWorker =');
const body = source.slice(start, source.indexOf('const handleCloudBackup =', start));
it.each(['zh-CN', 'ja-JP'] as const)('preserves validation, default fallback and sync in %s', locale => {
  for (const input of ['bad://raw', '', '  https://custom.invalid  ']) {
    let applied = 'https://default.invalid';
    const setter = vi.fn((value: string) => { applied = value || 'https://default.invalid'; });
    const sync = vi.fn(), toast = vi.fn(), track = vi.fn(), setInput = vi.fn();
    const js = ts.transpileModule(body + '\nreturn { handleSaveProxyWorker, handleResetProxyWorker };', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const fns = new Function('proxyWorkerInput', 'addToast', 'trackEvent', 'setProxyWorkerUrl', 'getProxyWorkerUrl', 'setProxyWorkerInput', 'syncAmsgToolConfig', 'realtimeConfig', 'DEFAULT_PROXY_WORKER', 't', js)(input, toast, track, setter, () => applied, setInput, sync, { fake: true }, 'https://default.invalid', (key: UiMessageKey) => translateUi(locale, key));
    fns.handleSaveProxyWorker();
    if (input.startsWith('bad')) {
      expect(setter).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(translateUi(locale, 'settings.proxy.invalid'), 'error');
    } else {
      expect(setter).toHaveBeenCalledWith(input.trim());
      expect(sync).toHaveBeenCalledWith({ fake: true });
      expect(setInput).toHaveBeenCalledWith(applied);
    }
    fns.handleResetProxyWorker();
    expect(setter).toHaveBeenLastCalledWith('');
    expect(toast).toHaveBeenLastCalledWith(translateUi(locale, 'settings.proxy.restored'), 'info');
  }
});
it('keeps owner names literal in cloud switch messages', () => {
  expect(translateUi('ja-JP', 'settings.proxy.github', { owner: 'raw{owner}' })).toBe('GitHub @raw{owner} に切り替えました');
  expect(source).toContain('placeholder={DEFAULT_PROXY_WORKER}');
  expect(source).toContain('value={proxyWorkerInput}');
});
