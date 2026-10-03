// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UiLocaleProvider, useUiLocale } from '../context/UiLocaleContext';
import { translateUi, type UiStatusMessage } from './uiLocale';

it.each([0, 1, 102])('keeps model counts unchanged: %s', count => {
  expect(translateUi('zh-CN', 'settings.vision.modelsFound', { count })).toBe(`获取到 ${count} 个识图模型`);
  expect(translateUi('ja-JP', 'settings.vision.modelsFound', { count })).toBe(`${count} 件の画像認識モデルを取得しました`);
});

const statusCases: UiStatusMessage[] = [
  { key: 'settings.vision.fetching' },
  { key: 'settings.vision.disabled' },
  { key: 'settings.vision.success', params: { description: '紫色圆点 {detail} 🌸' } },
  { key: 'settings.vision.failure', params: { detail: 'HTTP 401 {description} 原文' } },
  { key: 'settings.vision.presetLoaded', params: { name: '私有预设 {count}' } },
  { key: 'settings.model.noMatch', params: { query: 'vendor/{description}' } },
  { key: 'settings.vision.unknownFailure' },
];
it.each(statusCases)('rerenders an existing status when locale changes: $key', state => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  const container = document.createElement('div');
  const root = createRoot(container);
  let change: ReturnType<typeof useUiLocale>['setLocale'];
  const Display = () => { const { t, setLocale } = useUiLocale(); change = setLocale; return React.createElement('span', null, t(state.key, state.params)); };
  try {
    act(() => root.render(React.createElement(UiLocaleProvider, null, React.createElement(Display))));
    const chinese = container.textContent;
    act(() => change('ja-JP'));
    expect(container.textContent).not.toBe(chinese);
    for (const value of Object.values(state.params ?? {})) expect(container.textContent).toContain(String(value));
    act(() => change('zh-CN'));
    expect(container.textContent).toBe(chinese);
  } finally { act(() => root.unmount()); localStorage.clear(); }
});

it('keeps independent vision configuration, model IDs, request and telemetry wiring', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain('t(visionStatusMsg.key, visionStatusMsg.params)');
  expect(source).toContain('t(visionTestResult.key, visionTestResult.params)');
  expect(source).toContain('visionTestResult.success ?');
  expect(source).not.toContain("visionTestResult.startsWith('✅')");
  expect(source).toContain('description: description.slice(0, 80)');
  expect(source).toContain('describeImageWithVisionApi(VISION_API_TEST_IMAGE_DATA_URL, config)');
  expect(source).toContain("trackEvent('测试识图 API', { result: '成功' })");
  expect(source).toContain('setAvailableVisionModels(models)');
  expect(source).toContain('localStorage.setItem(VISION_MODEL_LIST_STORAGE_KEY, JSON.stringify(models))');
  expect(source).toContain('visionApiConfigFromPreset(preset)');
  expect(source).toContain('title={model}');
  expect(source).toContain('confirmModelPicker(m)');
  expect(source).toContain('handleSaveApi(model)');
  expect(source).toContain("t('settings.model.noMatch', { query: visionModelFilter })");
});
