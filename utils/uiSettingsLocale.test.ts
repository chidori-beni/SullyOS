// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UiLocaleProvider, useUiLocale } from '../context/UiLocaleContext';
import SettingsSection from '../components/settings/SettingsSection';
import PersonaSimIndicator from '../components/os/PersonaSimIndicator';
import DreamSimIndicator from '../components/os/DreamSimIndicator';
import { translateUi } from './uiLocale';
import { AppID } from '../types';

const mocked = vi.hoisted(() => ({ guide: null as number | null, status: 'idle', name: '', open: vi.fn(), personaOpen: vi.fn(), dreamOpen: vi.fn() }));
vi.mock('./firstUseGuide', () => ({ useFirstUseGuideStep: () => mocked.guide }));
vi.mock('../context/OSContext', () => ({ useOS: () => ({ openApp: mocked.open }) }));
vi.mock('./personaSimStore', () => ({ usePersonaSim: () => ({ status: mocked.status, charName: mocked.name }), personaSimStore: { requestOpen: mocked.personaOpen } }));
vi.mock('./dreamSimStore', () => ({ useDreamSim: () => ({ status: mocked.status, charName: mocked.name }), dreamSimStore: { requestOpen: mocked.dreamOpen } }));
let root: Root;
let container: HTMLDivElement;
let changeLocale: ReturnType<typeof useUiLocale>['setLocale'];
const Controls = () => { changeLocale = useUiLocale().setLocale; return null; };
const Section = ({ api = true }: { api?: boolean }) => {
  const { t } = useUiLocale();
  return React.createElement(SettingsSection, { title: t('settings.section.api'), icon: null, sectionProps: api ? { 'data-guide': 'api' } : undefined, children: '原内容' });
};
const mount = (child: React.ReactNode) => act(() => root.render(React.createElement(UiLocaleProvider, null, React.createElement(Controls), child)));
const japanese = () => act(() => changeLocale('ja-JP'));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  mocked.guide = null;
  mocked.status = 'idle';
  mocked.name = '';
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('keeps a section expanded across title translations and preserves its contents', () => {
  mount(React.createElement(Section));
  expect(container.textContent).toBe('API 配置');
  act(() => container.querySelector('button')!.click());
  japanese();
  expect(container.textContent).toBe('API 設定原内容');
  expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  act(() => changeLocale('zh-CN'));
  expect(container.textContent).toBe('API 配置原内容');
});

it('uses stable data-guide identity even when the guide is activated in Japanese', () => {
  localStorage.setItem('sullyos.uiLocale.v1', 'ja-JP');
  mocked.guide = 0;
  mount(React.createElement(Section));
  expect(container.textContent).toBe('API 設定原内容');
  act(() => container.querySelector('button')!.click());
  expect(container.textContent).toBe('API 設定');
  act(() => { window.dispatchEvent(new Event('sully:guide-navigate')); });
  expect(container.textContent).toBe('API 設定原内容');
});

it('does not identify a section by its translated or Chinese title', () => {
  mocked.guide = 0;
  mount(React.createElement(Section, { api: false }));
  japanese();
  act(() => { window.dispatchEvent(new Event('sully:guide-navigate')); });
  expect(container.textContent).toBe('API 設定');
});

it('keeps side actions separate from expanding the section', () => {
  const action = vi.fn();
  mount(React.createElement(SettingsSection, { icon: null, title: '原始标题', actions: React.createElement('button', { onClick: action }, '侧边操作'), children: '原内容' }));
  act(() => container.querySelectorAll('button')[1].click());
  expect(action).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain('原内容');
});

it.each([
  [PersonaSimIndicator, '演出生成中', '演出を生成中', '演出の準備完了 · 開く', AppID.CheckPhone, 'personaOpen'],
  [DreamSimIndicator, '梦正在成形', '夢を生成中', '夢が完成しました · 開く', AppID.Room, 'dreamOpen'],
] as const)('localizes indicator loading/ready states without changing its route', (Component, zh, ja, ready, route, callback) => {
  mount(React.createElement(Component));
  expect(container.textContent).toBe('');
  mocked.status = 'loading';
  mount(React.createElement(Component));
  expect(container.textContent).toBe(zh);
  mocked.name = '萧逸 {name}';
  mount(React.createElement(Component));
  japanese();
  expect(container.textContent).toBe(`${ja} · 萧逸 {name}`);
  mocked.status = 'ready';
  mount(React.createElement(Component));
  expect(container.textContent).toBe(ready);
  act(() => container.querySelector('button')!.click());
  expect(mocked[callback]).toHaveBeenCalledOnce();
  expect(mocked.open).toHaveBeenCalledWith(route);
});

it('interpolates preset names without modifying user text or re-interpolating braces', () => {
  const name = '我的 API {name} / 日本語';
  expect(translateUi('ja-JP', 'settings.preset.switched', { name })).toBe(`「${name}」に切り替えました。すぐに反映されます`);
  expect(translateUi('zh-CN', 'settings.preset.deleteAgainAria', { name })).toBe(`再点一次 × 删除预设 ${name}`);
});

it('keeps Settings wiring to the locale provider and leaves model identifiers raw', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain("title={t('settings.section.api')}");
  expect(source).toContain("sectionProps={{ 'data-guide': 'api' }}");
  expect(source).toContain("addToast(t('settings.preset.switched', { name: preset.name }), 'success')");
  expect(source).toContain('{preset.name}');
  expect(source).toContain('title={m}');
  expect(source).toContain("t('settings.preset.description')");
  expect(source).not.toContain("title === 'API 配置'");
});
