// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { useNaturalProfileDisplay } from '../hooks/useNaturalProfileDisplay';
const mock = vi.hoisted(() => ({ read: vi.fn(), translate: vi.fn() }));
vi.mock('./naturalProfileTranslation', async original => ({ ...await original<typeof import('./naturalProfileTranslation')>(), naturalProfileTranslator: mock }));
vi.mock('./safeApi', () => ({ safeFetchJson: vi.fn() }));
const source = { archetype: '中文标签', summary: '中文说明' };
const ja = { archetype: '日本語の分類', summary: '日本語の説明' };
const api = { baseUrl: 'https://example.invalid', apiKey: 'fake', model: 'test' };
let current: ReturnType<typeof useNaturalProfileDisplay>;
const Harness = ({ open = true, locale = 'ja-JP', id = 'a', text = source }: { open?: boolean; locale?: string; id?: string; text?: typeof source }) => {
  current = useNaturalProfileDisplay(open, locale, id, text, api);
  return React.createElement('p', null, current.text?.summary);
};
const container = document.createElement('div');
let root = createRoot(container);
beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterAll(() => vi.unstubAllGlobals());
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container); vi.resetAllMocks(); });
it('shows original immediately on Chinese switch and ignores a late Japanese result', async () => {
  let resolve!: (value: typeof ja) => void;
  mock.translate.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(React.createElement(Harness)));
  expect(current.loading).toBe(true);
  await act(async () => root.render(React.createElement(Harness, { locale: 'zh-CN' })));
  await act(async () => resolve(ja));
  expect(container.textContent).toBe(source.summary);
  expect(current.loading).toBe(false);
});
it('does not show the previous character or previous source after switching', async () => {
  const resolves: Array<(value: typeof ja) => void> = [];
  mock.translate.mockImplementation(() => new Promise(done => resolves.push(done)));
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => root.render(React.createElement(Harness, { id: 'b', text: { ...source, summary: '新画像' } })));
  await act(async () => resolves[0](ja));
  expect(container.textContent).toBe('新画像');
  await act(async () => resolves[1]({ ...ja, summary: '新しい画像の説明' }));
  expect(container.textContent).toBe('新しい画像の説明');
});
it('does not call a model in Chinese or when closed; cached copy renders without a request', async () => {
  await act(async () => root.render(React.createElement(Harness, { locale: 'zh-CN' })));
  await act(async () => root.render(React.createElement(Harness, { open: false })));
  expect(mock.translate).not.toHaveBeenCalled();
  mock.read.mockReturnValue(ja);
  await act(async () => root.render(React.createElement(Harness)));
  expect(container.textContent).toBe(ja.summary);
  expect(mock.translate).not.toHaveBeenCalled();
});
it('keeps manual retry scoped: reopening never forces another failed request', async () => {
  mock.translate.mockRejectedValue(new Error('HTTP 429'));
  await act(async () => root.render(React.createElement(Harness)));
  expect(current.error).toBe('HTTP 429');
  await act(async () => current.retry());
  expect(mock.translate.mock.calls.at(-1)?.[3]).toBe(true);
  await act(async () => root.render(React.createElement(Harness, { open: false })));
  await act(async () => root.render(React.createElement(Harness)));
  expect(mock.translate.mock.calls.at(-1)?.[3]).toBe(false);
});
