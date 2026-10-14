import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import { formatXhsConnectionStatus } from './uiXhsConnectionStatus';
import UserHolidaySettings from '../components/settings/UserHolidaySettings';
const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ locale: state.locale, t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params) }) }));
it.each(['zh-CN', 'ja-JP'] as const)('renders holiday form with stable country codes in %s', locale => {
  state.locale = locale;
  const value = { enabled: true, countryCode: 'JP', homeCountryCode: 'CN', timeZone: 'Asia/Tokyo' };
  const change = vi.fn();
  const html = renderToStaticMarkup(React.createElement(UserHolidaySettings, { value, onChange: change }));
  expect(html).toContain(translateUi(locale, 'settings.holiday.title'));
  expect(html).toContain('value="JP" selected=""');
  expect(html).toContain(translateUi(locale, 'settings.holiday.unavailable'));
  if (locale === 'ja-JP') expect(html).toContain('日本');
  expect(value).toEqual({ enabled: true, countryCode: 'JP', homeCountryCode: 'CN', timeZone: 'Asia/Tokyo' });
  expect(change).not.toHaveBeenCalled();
});
it('keeps holiday calendar fetch and prompt previews unchanged', () => {
  const source = readFileSync(resolve(process.cwd(), 'components/settings/UserHolidaySettings.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:components/settings/UserHolidaySettings.tsx'], { encoding: 'utf8' });
  const effect = (s: string) => s.slice(s.indexOf('useEffect(() =>'), s.indexOf('const regions =')).replace(/\r/g, '');
  expect(effect(source)).toBe(effect(baseline));
  for (const token of ['renderUserHoliday(value,', 'renderHomeFestival(value,', 'subdivisionCode: undefined, timeZone: deviceTimeZone()', 'value={value.countryCode}', 'value={value.homeCountryCode']) expect(source).toContain(token);
});
it.each([0, 1, 20])('keeps XHS account, ID and function count literal: %s', count => {
  const info = { count, loggedIn: true, nickname: 'raw{count} 🌸', userId: 'id{info}', platform: 'rednote', hasXsecToken: true };
  expect(formatXhsConnectionStatus('zh-CN', info)).toBe(`连接成功! ${count} 个功能可用 | 平台: RedNote | 账号: raw{count} 🌸 (ID: id{info}) | xsecToken 已获取`);
  const ja = formatXhsConnectionStatus('ja-JP', info);
  expect(ja).toContain('raw{count} 🌸');
  expect(ja).toContain('id{info}');
  expect(ja).toContain(String(count));
});
it('keeps XHS request and credential update logic unchanged beyond explicit display metadata', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const slice = (s: string) => s.slice(s.indexOf('const testXhsMcp ='), s.indexOf('// 麦当劳', s.indexOf('const testXhsMcp ='))).replace(/\r/g, '');
  let actual = slice(source);
  if (!slice(baseline).includes('setRtXhsTestInfo({')) {
    actual = actual.replace(/, \{ key: 'settings\.(?:xhs|realtime)\.[^']+'(?:, params: \{[^}]*\})? \}/g, '')
      .replace('              setRtXhsTestInfo({ count: toolCount, loggedIn: Boolean(result.loggedIn), nickname: result.nickname, userId: result.userId, platform: result.platform, hasXsecToken: Boolean(result.xsecToken) });\n', '');
  }
  expect(actual.length).toBeGreaterThan(2000);
  expect(actual).toBe(slice(baseline));
});
it('preserves cookie guide protocol names, addresses and enable confirmation', () => {
  const ja = translateUi('ja-JP', 'settings.xhs.guide');
  for (const token of ['a1=', 'web_session=', 'document.cookie', 'httpOnly', 'www.rednote.com', 'www.xiaohongshu.com', 'Copy value']) expect(ja).toContain(token);
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain("if (!window.confirm(XHS_RISK_TEXT + '\\n\\n' + t('settings.xhs.enable'))) return;");
  expect(source).toContain('navigator.clipboard.writeText(XHS_COOKIE_GUIDE)');
  expect(source).toContain('value={rtXhsCookie}');
});
