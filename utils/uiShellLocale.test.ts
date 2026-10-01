// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLocaleProvider, useUiLocale } from '../context/UiLocaleContext';
import { getAppDisplayName, INSTALLED_APPS } from '../constants';
import { AppID } from '../types';
import { translateUi, UI_MESSAGES, UI_LOCALE_STORAGE_KEY } from './uiLocale';
import AppIcon from '../components/os/AppIcon';
import WorldBroadcast from '../components/WorldBroadcast';
import VRBroadcast from '../components/VRBroadcast';
import ChatBroadcast from '../components/ChatBroadcast';
import SuspendedCallBar from '../components/os/SuspendedCallBar';
import AppErrorBoundary from '../components/os/AppErrorBoundary';

vi.mock('../context/OSContext', () => ({ useOS: () => ({ customIcons: {}, theme: {} }), isPaperWallpaper: () => false }));
vi.mock('./blobRef', () => ({ useBlobRefUrl: () => undefined }));
vi.mock('../components/os/appPreload', () => ({ preloadApp: vi.fn() }));
vi.mock('./amsgInstantChat', () => ({ AMSG_INSTANT_CHAT_PENDING_EVENT: 'test-pending', listInstantChatPendings: () => [] }));
vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let setLocale: ReturnType<typeof useUiLocale>['setLocale'];
const Controls = () => { setLocale = useUiLocale().setLocale; return null; };
const mount = (child: React.ReactNode) => act(() => root.render(React.createElement(UiLocaleProvider, null, React.createElement(Controls), child)));
const switchTo = (locale: string) => act(() => setLocale(locale));
const dispatch = (name: string, detail: object) => act(() => { window.dispatchEvent(new CustomEvent(name, { detail })); });

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('Japanese shell display without changing business data', () => {
  it('covers every registered app and preserves original registry names', () => {
    const before = JSON.stringify(INSTALLED_APPS);
    for (const app of INSTALLED_APPS) {
      expect(getAppDisplayName(app.id)).toBe(app.name);
      expect(getAppDisplayName(app.id, 'ja-JP')).not.toMatch(/^apps\./);
    }
    expect(getAppDisplayName(AppID.Bookroom, 'ja-JP')).toBe('書斎');
    expect(getAppDisplayName(AppID.Cinema, 'ja-JP')).toBe('映画館');
    expect(getAppDisplayName('unknown' as AppID, 'ja-JP')).toBe('unknown');
    expect(JSON.stringify(INSTALLED_APPS)).toBe(before);
  });

  it('has matching parameters and Japanese coverage for all catalog keys', () => {
    for (const key of Object.keys(UI_MESSAGES['zh-CN']) as Array<keyof typeof UI_MESSAGES['zh-CN']>) {
      const zh = UI_MESSAGES['zh-CN'][key]!;
      const ja = UI_MESSAGES['ja-JP'][key]!;
      expect(ja, key).toBeTruthy();
      expect(ja.match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(zh.match(/\{\w+\}/g)?.sort() ?? []);
    }
    for (const count of [0, 1, 7]) {
      expect(translateUi('ja-JP', 'broadcast.chat.count', { count })).toBe(` 計 ${count} 件`);
      expect(translateUi('zh-CN', 'broadcast.vr.count', { count })).toBe(` 等 ${count} 人`);
    }
  });

  it('updates a memoized AppIcon with unchanged props and persists language', () => {
    const app = INSTALLED_APPS.find(app => app.id === AppID.Settings)!;
    mount(React.createElement(AppIcon, { app, onClick: () => {} }));
    expect(container.textContent).toBe('设置');
    switchTo('ja-JP');
    expect(container.textContent).toBe('設定');
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('設定');
    expect(localStorage.getItem(UI_LOCALE_STORAGE_KEY)).toBe('ja-JP');
    expect(document.documentElement.lang).toBe('ja-JP');
    switchTo('zh-CN');
    expect(container.textContent).toBe('设置');
  });

  it('translates a running world default name and progress while preserving explicit names', () => {
    mount(React.createElement(WorldBroadcast));
    expect(container.textContent).toBe('');
    dispatch('world-episode-start', { worldId: 'w', total: 3 });
    expect(container.textContent).toContain('「家园」世界引擎运转中');
    switchTo('ja-JP');
    expect(container.textContent).toContain('「ホームワールド」');
    dispatch('world-beat-done', { worldId: 'w', charName: '萧逸 {name}', done: 0, total: 3 });
    expect(container.textContent).toContain('萧逸 {name} の物語を進行中 · 0/3');
    dispatch('world-chapter-start', { worldId: 'w', index: 2 });
    expect(container.textContent).toContain('第 2 巻');
    dispatch('world-episode-start', { worldId: 'w', worldName: '家园' });
    expect(container.textContent).toContain('「家园」');
  });

  it('handles zero, one and multiple VR sessions with dynamic titles intact', () => {
    mount(React.createElement(VRBroadcast));
    expect(container.textContent).toBe('');
    dispatch('vr-session-start', { charId: 'a', charName: '千夜', room: 'library', novelTitle: '原书名 {title}' });
    expect(container.textContent).toContain('读《原书名 {title}》');
    switchTo('ja-JP');
    expect(container.textContent).toContain('千夜 彼方を散策中 · 図書館');
    expect(container.textContent).toContain('『原书名 {title}』を読書中');
    expect(container.textContent).not.toContain('計 1');
    dispatch('vr-session-start', { charId: 'b', charName: '萧逸', room: 'unknown-room' });
    expect(container.textContent).toContain('萧逸 計 2 人 彼方を散策中 · 彼方');
  });

  it('translates chat state and counts after generation has started', async () => {
    const { CHAT_GEN_EVENTS } = await import('./chatGenEvents');
    mount(React.createElement(ChatBroadcast));
    expect(container.textContent).toBe('');
    dispatch(CHAT_GEN_EVENTS.replyStart, { charId: 'a', charName: '原角色名' });
    expect(container.textContent).toContain('原角色名 正在回应');
    switchTo('ja-JP');
    expect(container.textContent).toContain('原角色名 返信を作成中');
    dispatch(CHAT_GEN_EVENTS.replyStart, { charId: 'b', charName: '第二位' });
    expect(container.textContent).toContain('計 2 件');
  });

  it('keeps suspended-call routing and character names unchanged', () => {
    const resume = vi.fn();
    mount(React.createElement(SuspendedCallBar, { charName: '萧逸', onResume: resume }));
    switchTo('ja-JP');
    const button = document.querySelector('[data-testid="suspended-call-return"]')!;
    expect(button.textContent).toContain('通話中 · 萧逸');
    expect(button.getAttribute('aria-label')).toBe('萧逸 との通話に戻る');
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(resume).toHaveBeenCalledOnce();
  });

  it('keeps an existing crash and its raw message when changing language', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => { throw new Error('原始报错 RAW_ERROR'); };
    mount(React.createElement(AppErrorBoundary, { resetKey: 'settings', onCloseApp: () => {}, children: React.createElement(Broken) }));
    expect(container.textContent).toContain('应用运行错误');
    switchTo('ja-JP');
    expect(container.textContent).toContain('アプリ実行エラー');
    expect(container.textContent).toContain('原始报错 RAW_ERROR');
    expect(container.textContent).toContain('エラー情報をコピー');
  });
});
