import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi } from './uiLocale';
const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
const handlers = (s: string) => s.slice(s.indexOf('const confirmReset ='), s.indexOf('// 保存实时感知配置')).replace(/\r/g, '');
it('keeps both reset handlers byte-identical to the remote baseline', () => {
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  expect(handlers(source).length).toBeGreaterThan(500);
  expect(handlers(source)).toBe(handlers(baseline));
});
it('preserves cloud failure branching and explicit force choice using mocks only', async () => {
  const reset = vi.fn(async (..._args: unknown[]) => ({ status: 'cloud-cleanup-failed', workerUrl: 'raw{error}', detail: 'raw detail' }));
  const busy = vi.fn(), close = vi.fn(), failure = vi.fn();
  const js = ts.transpileModule(handlers(source) + '\nreturn { confirmReset, confirmResetAnyway };', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const fns = new Function('setResetting', 'resetSystem', 'setShowResetConfirm', 'setResetCloudFailure', js)(busy, reset, close, failure);
  await fns.confirmReset();
  expect(reset).toHaveBeenCalledWith();
  expect(close).toHaveBeenCalledWith(false);
  expect(failure).toHaveBeenCalledWith({ workerUrl: 'raw{error}', detail: 'raw detail' });
  expect(busy).toHaveBeenLastCalledWith(false);
  await fns.confirmResetAnyway();
  expect(reset).toHaveBeenLastCalledWith({ force: true });
  expect(failure).toHaveBeenLastCalledWith(null);
});
it('keeps irreversible deletion, cloud tasks and API-cost warnings explicit', () => {
  expect(translateUi('ja-JP', 'settings.reset.after')).toContain('元に戻すことはできません');
  expect(translateUi('ja-JP', 'settings.reset.risk')).toContain('API');
  expect(translateUi('ja-JP', 'settings.reset.risk')).toContain('D1');
  expect(source).toContain('{resetCloudFailure?.detail}');
  expect(source).toContain('{resetCloudFailure?.workerUrl}');
  expect(source).toContain("{t('settings.reset.permanent')}</span>");
});
