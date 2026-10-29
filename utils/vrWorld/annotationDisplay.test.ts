// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AnnotationText } from '../../components/reader/AnnotationText';
import { translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from '../uiLocale';
import type { VRNovelAnnotation } from '../../types';
const mock = vi.hoisted(() => ({ locale: 'ja-JP' as UiLocale, read: vi.fn(), subscribe: vi.fn() }));
vi.mock('../../context/UiLocaleContext', () => ({ useUiLocale: () => ({ locale: mock.locale, t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(mock.locale, key, params) }) }));
vi.mock('../../context/OSContext', () => ({ useOS: () => ({ apiConfig: { baseUrl: 'https://example.invalid', apiKey: 'fake', model: 'test' } }) }));
vi.mock('../safeApi', () => ({ safeFetchJson: vi.fn() }));
vi.mock('./annotationLocale', async original => ({ ...await original<typeof import('./annotationLocale')>(), annotationTranslator: { read: mock.read }, subscribeAnnotationTranslation: mock.subscribe }));
const note: VRNovelAnnotation = { id: 'a', novelId: 'b', authorId: 'char', authorName: '角色', segIdx: 0, content: '原批注', createdAt: 1 };
const node = document.createElement('div'); let root = createRoot(node);
let observe!: (entries: Array<{ isIntersecting: boolean }>) => void;
beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof observe) { observe = callback; } observe() {} disconnect() {} });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(node); vi.resetAllMocks(); mock.locale = 'ja-JP'; });
it('requests only visible old character notes and switches immediately back to original Chinese', async () => {
  let done!: (text: string) => void;
  const cancel = vi.fn(); mock.subscribe.mockImplementation((_a, _api, callback) => { done = callback; return cancel; });
  await act(async () => root.render(React.createElement(AnnotationText, { annotation: note })));
  expect(mock.subscribe).not.toHaveBeenCalled();
  await act(async () => observe([{ isIntersecting: true }]));
  expect(mock.subscribe).toHaveBeenCalledTimes(1);
  await act(async () => done('日本語の書き込み'));
  expect(node.textContent).toContain('日本語の書き込み');
  mock.locale = 'zh-CN';
  await act(async () => root.render(React.createElement(AnnotationText, { annotation: note })));
  expect(node.textContent).toBe('原批注'); expect(cancel).toHaveBeenCalled();
});
it.each([{ ...note, authorId: 'user' }, { ...note, contentLocale: 'ja-JP' as const }])('never automatically translates user/new Japanese annotations', async annotation => {
  await act(async () => root.render(React.createElement(AnnotationText, { annotation })));
  await act(async () => observe([{ isIntersecting: true }]));
  expect(mock.subscribe).not.toHaveBeenCalled(); expect(node.textContent).toContain('原批注');
});
it('reuses cache without a request and unsubscribes queued notes when scrolled out', async () => {
  mock.read.mockReturnValue({ summary: 'キャッシュ訳' });
  await act(async () => root.render(React.createElement(AnnotationText, { annotation: note })));
  expect(node.textContent).toBe('キャッシュ訳'); expect(mock.subscribe).not.toHaveBeenCalled();
  mock.read.mockReturnValue(undefined);
  const cancel = vi.fn(); mock.subscribe.mockReturnValue(cancel);
  await act(async () => observe([{ isIntersecting: true }]));
  await act(async () => observe([{ isIntersecting: false }]));
  expect(cancel).toHaveBeenCalled();
});
