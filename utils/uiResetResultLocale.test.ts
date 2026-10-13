import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi } from './uiLocale';
it.each([false, true])('preserves cloud-first gating and force choice: %s', async force => {
  const source = readFileSync(resolve(process.cwd(), 'context/OSContext.tsx'), 'utf8');
  const start = source.indexOf('const resetSystem = async');
  const body = source.slice(start, source.indexOf('const openApp =', start));
  const js = ts.transpileModule(body + '\nreturn resetSystem;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const events: string[] = [];
  const reasons = [{ key: 'settings.resetResult.tasks' }];
  const toast = vi.fn();
  const reset = new Function('wipeAmsgCloudDataForReset', 'DB', 'ActiveMsgStore', 'localStorage', 'window', 'addToast', 'translateUi', 'loadUiLocale', js)(async () => { events.push('cloud'); return { status: 'failed', workerUrl: 'raw', detail: 'raw detail', uiReasons: reasons }; }, { deleteDB: async () => events.push('db') }, { deleteDB: async () => events.push('active') }, { clear: () => events.push('storage') }, { location: { reload: () => events.push('reload') } }, toast, translateUi, () => 'ja-JP');
  const result = await reset({ force });
  if (!force) {
    expect(events).toEqual(['cloud']);
    expect(result).toEqual({ status: 'cloud-cleanup-failed', workerUrl: 'raw', detail: 'raw detail', uiReasons: reasons });
  } else {
    expect(events).toEqual(['cloud', 'db', 'active', 'storage', 'reload']);
    expect(result).toEqual({ status: 'done' });
  }
});
