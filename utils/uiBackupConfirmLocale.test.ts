import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi, type UiLocale } from './uiLocale';

const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
const exportCode = source.slice(source.indexOf('const handleExport ='), source.indexOf('const handleImport ='));
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

it.each(['zh-CN', 'ja-JP'] as UiLocale[])('retains all mode/backend warnings and cancel/continue behavior in %s', async locale => {
  for (const mode of ['full', 'text_only', 'media_only'] as const) {
    for (const backend of [false, true]) {
      for (const accepted of [false, true]) {
        const confirm = vi.fn(() => accepted);
        const exportSystem = vi.fn(async () => new Blob(['mock']));
        const share = vi.fn(async () => 'cancelled');
        const t = (key: Parameters<typeof translateUi>[1], params?: Parameters<typeof translateUi>[2]) => translateUi(locale, key, params);
        const handler = new Function('t', 'window', 'trackEvent', 'exportBackendConnection', 'exportSystem', 'Capacitor', 'shareOrDownloadBlob',
          compile(exportCode) + ';return handleExport;')(t, { confirm }, vi.fn(), backend, exportSystem, { isNativePlatform: () => true }, share);
        await handler(mode);
        const key = mode === 'media_only' ? 'settings.backup.exportMedia' : backend ? 'settings.backup.exportBackend' : 'settings.backup.exportKeys';
        expect(confirm).toHaveBeenCalledWith(t('settings.backup.exportConfirm', { warning: t(key) }));
        expect(exportSystem).toHaveBeenCalledTimes(accepted ? 1 : 0);
        expect(share).toHaveBeenCalledTimes(accepted ? 1 : 0);
        if (accepted) expect(exportSystem).toHaveBeenCalledWith(mode, { includeBackendConnection: backend });
      }
    }
  }
});

it.each(['zh-CN', 'ja-JP'] as UiLocale[])('retains restore callback decisions and raw worker URL in %s', async locale => {
  const start = source.indexOf('const handleImport =');
  const end = source.indexOf('\n  };', start) + '\n  };'.length;
  const confirm = vi.fn(() => false);
  let options: any;
  const importSystem = vi.fn(async (_file: unknown, supplied: unknown) => { options = supplied; });
  const ref = { current: { value: 'selected.zip' } };
  const t = (key: Parameters<typeof translateUi>[1], params?: Parameters<typeof translateUi>[2]) => translateUi(locale, key, params);
  const handler = new Function('t', 'window', 'importSystem', 'importInputRef', 'trackEvent', 'showError', 'addToast',
    compile(source.slice(start, end)) + ';return handleImport;')(t, { confirm }, importSystem, ref, vi.fn(), vi.fn(), vi.fn());
  const file = { name: 'own-backup.zip' };
  handler({ target: { files: [file] } });
  await Promise.resolve();
  const url = 'https://example.test/{warning}?原文';
  expect(options.confirmBackendRestore(url)).toBe(false);
  confirm.mockReturnValue(true);
  expect(options.confirmBackendRestore(url)).toBe(true);
  expect(confirm).toHaveBeenLastCalledWith(t('settings.backup.restoreConfirm', { workerUrl: url }));
  expect(importSystem).toHaveBeenCalledWith(file, options);
  expect(ref.current.value).toBe('');
});

it('keeps explicit privacy consequences and original Chinese copy', () => {
  const rawUrl = 'https://example.test/{workerUrl}';
  expect(translateUi('ja-JP', 'settings.backup.exportBackend')).toContain('誰にも送らない');
  const message = translateUi('ja-JP', 'settings.backup.restoreConfirm', { workerUrl: rawUrl });
  expect(message).toContain(rawUrl);
  expect(message).toContain('API キーとチャット履歴が相手のサーバーに書き込まれます');
  expect(message).toContain('接続しなくても他のデータは読み込めます');
  expect(translateUi('zh-CN', 'settings.backup.exportConfirm', { warning: '原文 {warning}' })).toBe('原文 {warning}\n\n点「确定」继续导出，「取消」中止。');
});

it('localizes only import failure packaging and preserves the raw stack and classification', async () => {
  const start = source.indexOf('const handleImport =');
  const end = source.indexOf('\n  };', start) + '\n  };'.length;
  const error = { message: '缺少 data.json：原始 {warning}', stack: 'Raw stack 原文 {workerUrl}' };
  const showError = vi.fn();
  const toast = vi.fn();
  const track = vi.fn();
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const t = (key: Parameters<typeof translateUi>[1], params?: Parameters<typeof translateUi>[2]) => translateUi('ja-JP', key, params);
  try {
    const handler = new Function('t', 'window', 'importSystem', 'importInputRef', 'trackEvent', 'showError', 'addToast',
      compile(source.slice(start, end)) + ';return handleImport;')(t, { confirm: vi.fn() }, vi.fn(() => Promise.reject(error)), { current: null }, track, showError, toast);
    handler({ target: { files: [{ name: 'Backup.ZIP' }] } });
    await Promise.resolve();
    await Promise.resolve();
    expect(showError).toHaveBeenCalledWith(t('settings.backup.importFailed'), error.stack);
    expect(toast).toHaveBeenCalledWith(t('settings.backup.importFailedToast'), 'error');
    expect(track).toHaveBeenCalledWith('导入备份失败', { source: 'zip', reason: 'missing_data_json' });
  } finally { logged.mockRestore(); }
});
