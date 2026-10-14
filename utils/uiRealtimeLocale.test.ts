import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi, type UiMessageKey, type UiMessageParams } from './uiLocale';
const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
it('keeps configuration, requests and prompt synchronization unchanged beyond explicit UI copy', () => {
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const slice = (s: string) => s.slice(s.indexOf('const handleSaveRealtimeConfig ='), s.indexOf('// 测试小红书 Bridge 连接')).replace(/\r/g, '').replace(/, getServiceConnectionUi\('(notion|feishu)', result.message\)/g, '');
  let actual = slice(source);
  if (!slice(baseline).includes("t('settings.realtime.saved')")) actual = actual.replace("t('settings.realtime.saved')", "'实时感知配置已保存'");
  if (!slice(baseline).includes("t('settings.realtime.countryRequired')")) actual = actual.replace("t('settings.realtime.countryRequired')", "'请选择生活所在的国家／地区，或关闭节假日感知'");
  if (!slice(baseline).includes("key: 'settings.realtime.cityRequired'")) actual = actual.replace(/, \{ key: 'settings\.realtime\.[^']+'(?:, params: \{[^}]*\})? \}/g, '');
  expect(actual.length).toBeGreaterThan(3000);
  expect(actual).toBe(slice(baseline));
});
it.each(['zh-CN', 'ja-JP'] as const)('keeps weather API choices, returned values and errors literal in %s', async locale => {
  const start = source.indexOf('const testWeatherApi =');
  const body = source.slice(start, source.indexOf('// 测试Notion连接', start));
  const js = ts.transpileModule(body + '\nreturn testWeatherApi;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const apiKey of ['', 'fake-key']) {
    const weather = { city: 'raw{city}', description: 'raw description', temp: 21 };
    const owm = vi.fn(async (..._args: unknown[]) => weather), meteo = vi.fn(async (..._args: unknown[]) => weather), status = vi.fn(), track = vi.fn();
    const handler = new Function('rtWeatherCity', 'rtWeatherKey', 'fetchOwmWeather', 'fetchOpenMeteoWeather', 'setRtTestStatus', 'trackEvent', js)('city', apiKey, owm, meteo, status, track);
    await handler();
    expect(apiKey ? owm : meteo).toHaveBeenCalled();
    const [raw, ui] = status.mock.calls[status.mock.calls.length - 1];
    expect(raw).toContain(weather.city);
    expect(translateUi(locale, ui.key, ui.params)).toContain(weather.city);
    expect(translateUi(locale, ui.key, ui.params)).toContain(weather.description);
    const error = new Error('Load failed {temp} 🌸');
    (apiKey ? owm : meteo).mockRejectedValueOnce(error);
    await handler();
    const [, failedUi] = status.mock.calls[status.mock.calls.length - 1];
    expect(translateUi(locale, failedUi.key, failedUi.params)).toContain(error.message);
  }
});
it('clears previous localized status when another tool returns an unknown raw message', () => {
  const start = source.indexOf('const setRtTestStatus =');
  const body = source.slice(start, source.indexOf('\n  };', start) + 5);
  const js = ts.transpileModule(body + '\nreturn setRtTestStatus;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const raw = vi.fn(), ui = vi.fn();
  const xhs = vi.fn();
  const setter = new Function('setRawRtTestStatus', 'setRtTestUi', 'setRtXhsTestInfo', js)(raw, ui, xhs);
  setter('正在测试...', { key: 'settings.realtime.testing' });
  setter('raw service message');
  expect(raw).toHaveBeenLastCalledWith('raw service message');
  expect(ui).toHaveBeenLastCalledWith(null);
  expect(xhs).toHaveBeenLastCalledWith(null);
});
it('keeps service field names, links and all form values unchanged', () => {
  for (const field of ['rtWeatherKey', 'rtWeatherCity', 'rtNewsApiKey', 'rtNotionKey', 'rtNotionDbId', 'rtNotionNotesDbId', 'rtFeishuAppId', 'rtFeishuAppSecret', 'rtFeishuBaseId', 'rtFeishuTableId']) expect(source).toContain(`value={${field}}`);
  expect(source).toContain('https://www.notion.so/my-integrations');
  expect(source).toContain('https://open.feishu.cn/app');
  for (const name of ['标题', '内容', '日期', '心情', '角色']) expect(translateUi('ja-JP', 'settings.realtime.feishu4')).toContain(name);
  for (const name of ['Name', 'Date']) expect(translateUi('ja-JP', 'settings.realtime.notion2')).toContain(name);
  expect(source).toContain("rtTestStatus.includes('成功')");
  expect(source).toContain('rtTestUi ? t(rtTestUi.key, rtTestUi.params) : rtTestStatus}');
});
