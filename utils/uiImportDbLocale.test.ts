import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi } from './uiLocale';
const source = readFileSync(resolve(process.cwd(), 'utils/db.ts'), 'utf8');
it('passes display markers to progress and assets without changing labels or section counts', async () => {
  const start = source.indexOf('let sectionDone = 0;');
  const body = source.slice(start, source.indexOf('const clearStore =', start)) + '\nreturn { runSection, beforeWrite };';
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const onProgress = vi.fn(), beforeWrite = vi.fn();
  const fns = new Function('options', 'sectionTotal', js)({ onProgress, beforeWrite }, 3);
  const marker = { key: 'settings.importDb.characters' };
  await fns.runSection('角色资料', true, async () => {
    await fns.beforeWrite(['fake'], '角色资料', true);
    await fns.beforeWrite(['media'], '角色媒体', true, { key: 'settings.importDb.media' });
  }, 1, marker);
  expect(beforeWrite).toHaveBeenCalledWith(['fake'], '角色资料', marker);
  expect(beforeWrite).toHaveBeenCalledWith(['media'], '角色媒体', { key: 'settings.importDb.media' });
  expect(onProgress.mock.calls[0][0]).toMatchObject({ label: '角色资料', uiMessage: marker, stage: 'start', sectionDone: 0, sectionTotal: 3 });
  expect(onProgress.mock.calls[1][0]).toMatchObject({ label: '角色资料', stage: 'done', sectionDone: 1 });
  await fns.runSection('未覆盖分类', true, async () => { await fns.beforeWrite(['other'], '未覆盖分类', true); });
  expect(beforeWrite).toHaveBeenLastCalledWith(['other'], '未覆盖分类', undefined);
  expect(onProgress.mock.calls[3][0].uiMessage).toBeUndefined();
});
it.each([['characters', '角色资料'], ['groups', '角色分组'], ['messages', '聊天记录'], ['media', '角色媒体']] as const)('keeps core database label literal: %s', (key, label) => {
  expect(source).toContain(`key: 'settings.importDb.${key}'`);
  expect(translateUi('zh-CN', `settings.importDb.${key}`)).toBe(label);
  expect(translateUi('ja-JP', `settings.importDb.${key}`)).not.toBe(label);
});
