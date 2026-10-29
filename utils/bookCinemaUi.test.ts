// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import Cinema from '../apps/CinemaApp';
const state = vi.hoisted(() => ({ locale: 'ja-JP', toast: vi.fn(), update: vi.fn(), close: vi.fn(), register: vi.fn(() => () => {}) }));
const config = { characters: [], apiConfig: { baseUrl: '', apiKey: '', model: '' }, apiPresets: [], userProfile: {name:'原用户'}, groups: [], realtimeConfig: {}, memoryPalaceConfig: {}, updateCharacter: state.update, addToast: state.toast, closeApp:state.close, registerBackHandler:state.register };
vi.mock('../context/OSContext', () => ({ useOS: () => config }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ locale:state.locale }) }));
vi.mock('../utils/cinema/cinemaDb', () => ({ getCinemaPairing:vi.fn().mockResolvedValue(undefined), listCinemaSessions:vi.fn().mockResolvedValue([]), clearCinemaPairing:vi.fn(),deleteCinemaSession:vi.fn(), saveCinemaPairing:vi.fn(),saveCinemaSession:vi.fn(),backfillSessionToChat:vi.fn(),removeLinesFromChat:vi.fn(),removeSessionFromChat:vi.fn() }));
const element = document.createElement('div'); let root = createRoot(element);
beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Unexpected real request'))); });
afterAll(() => vi.unstubAllGlobals());
afterEach(async () => { await act(async () => root.unmount());root=createRoot(element); });
const click = async (text:string) => {
  const button=[...element.querySelectorAll('button')].find(x=>x.textContent===text);
  expect(button,text).toBeTruthy();await act(async()=>button!.click());
};
it('shows all three real cinema home tabs in Japanese and switches back without pairing or model calls', async () => {
  await act(async () => root.render(React.createElement(Cinema)));
  expect(element.textContent).toContain('パソコン');
  await click('上映を始める');
  expect(element.textContent).toContain('何を見る？');
  expect(element.textContent).toContain('この上映を記録する？');
  await click('視聴リスト');
  expect(element.textContent).toContain('まだ一緒に見た作品がありません。');
  state.locale='zh-CN';await act(async()=>root.render(React.createElement(Cinema)));
  expect(element.textContent).toContain('还没一起看过什么。');
  expect(fetch).not.toHaveBeenCalled();expect(state.update).not.toHaveBeenCalled();expect(state.toast).not.toHaveBeenCalled();
});
