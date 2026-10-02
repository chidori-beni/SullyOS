import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translateUi, type UiStatusMessage } from './uiLocale';

it.each([0, 1, 123])('renders model counts without changing values: %s', count => {
  expect(translateUi('zh-CN', 'settings.api.modelsFound', { count })).toBe(`获取到 ${count} 个模型`);
  expect(translateUi('ja-JP', 'settings.api.modelsFound', { count })).toBe(`${count} 件のモデルを取得しました`);
  expect(translateUi('ja-JP', 'settings.model.search', { count })).toContain(String(count));
});

it.each([
  ['settings.api.connecting', undefined],
  ['settings.api.saved', undefined],
  ['settings.api.modelsEmpty', undefined],
  ['settings.api.success', { reply: '原始回复 {detail} 日本語 🌸' }],
  ['settings.api.httpError', { status: 429, detail: 'Rate limit {reply}: 原始错误' }],
  ['settings.api.testFailed', { detail: 'Failed to fetch {count}' }],
  ['settings.api.failed', { detail: '：HTTP 401' }],
  ['settings.model.noMatch', { query: 'vendor/model-{reply}' }],
] satisfies Array<[UiStatusMessage['key'], UiStatusMessage['params']]>)('translates the same stored semantic message without translating raw parameters: %s', (key, params) => {
  const state: UiStatusMessage = { key, params };
  const before = JSON.stringify(state);
  const chinese = translateUi('zh-CN', state.key, state.params);
  const japanese = translateUi('ja-JP', state.key, state.params);
  // HTTP status and server response contain no localized wrapper.
  if (key === 'settings.api.httpError') expect(japanese).toBe(chinese);
  else expect(japanese).not.toBe(chinese);
  for (const value of Object.values(params ?? {})) {
    expect(chinese).toContain(String(value));
    expect(japanese).toContain(String(value));
  }
  expect(JSON.stringify(state)).toBe(before);
  expect(translateUi('zh-CN', state.key, state.params)).toBe(chinese);
});

it('keeps main API requests, raw reply truncation and model identities wired unchanged', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain('t(statusMsg.key, statusMsg.params)');
  expect(source).toContain('t(testApiResult.key, testApiResult.params)');
  expect(source).toContain('testApiResult.success ?');
  expect(source).not.toContain("testApiResult.startsWith('✅')");
  expect(source).toContain('reply: reply.slice(0, 30)');
  expect(source).toContain('detail: text.slice(0, 100)');
  expect(source).toContain("messages: [{ role: 'user', content: 'Hi' }]");
  expect(source).toContain('model: localModel.trim()');
  // 上游 3b5fff33：模型弹窗里点一项就保存生效（以前是只填进表单、再手动点保存）。
  expect(source).toContain('onClick={() => confirmModelPicker(m)}');
  expect(source).toContain('title={m}');
  expect(source).toContain("t('settings.model.noMatch', { query: modelFilter })");
});
