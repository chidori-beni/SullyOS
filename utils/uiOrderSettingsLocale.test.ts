import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi, type UiStatusMessage } from './uiLocale';

const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8').replace(/\r/g, '');
const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' }).replace(/\r/g, '');
const block = (s: string, name: string) => {
  const start = s.indexOf(`const ${name} =`);
  return s.slice(start, s.indexOf('\n  };', start) + 5);
};

it.each(['Mcd', 'Luckin'])('preserves %s token storage, toggles, reset and analytics', provider => {
  for (const name of [`handle${provider}TokenChange`, `handle${provider}EnabledChange`]) {
    expect(block(source, name)).toBe(block(baseline, name));
  }
  const normalized = (s: string) => block(s, `test${provider}Api`)
    .replace(/, \{ key: (?:names \? 'settings\.order\.[^']+' : )?'settings\.order\.[^']+'(?:, params: \{[^\n]*?\})? \}/g, '');
  expect(normalized(source)).toBe(normalized(baseline));
});

it.each(['Mcd', 'Luckin'])('runs %s test handler with fake responses only', async provider => {
  const lower = provider.toLowerCase();
  const js = ts.transpileModule(block(source, `test${provider}Api`) + `\nreturn test${provider}Api;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const make = (token: string, response: unknown, error?: Error) => {
    const status = vi.fn(), testing = vi.fn(), track = vi.fn();
    const connection = vi.fn(async () => { if (error) throw error; return response; });
    const handler = new Function(`${lower}Token`, `set${provider}TestStatus`, `set${provider}Testing`, `test${provider}Connection`, 'trackEvent', js)(token, status, testing, connection, track);
    return { handler, status, testing, connection, track };
  };
  const missing = make('  ', null);
  await missing.handler();
  expect(missing.connection).not.toHaveBeenCalled();
  expect(missing.status.mock.calls[0][1].key).toBe('settings.order.tokenRequired');
  for (const count of [0, 1, 7]) {
    const tools = Array.from({ length: count }, (_, i) => ({ name: `raw_{tool}${i}` }));
    const run = make('fake-token', { ok: true, message: 'original result', tools });
    await run.handler();
    expect(run.connection).toHaveBeenCalledTimes(1);
    expect(run.testing.mock.calls).toEqual([[true], [false]]);
    expect(run.track.mock.calls[0][1].result).toBe('ok');
    const ui = run.status.mock.calls.at(-1)![1] as UiStatusMessage;
    for (const locale of ['zh-CN', 'ja-JP'] as const) {
      const shown = translateUi(locale, ui.key, ui.params);
      expect(shown).toContain('✅');
      if (count) {
        expect(shown).toContain(String(count));
        expect(shown).toContain('raw_{tool}0');
        expect(shown).not.toContain('raw_{tool}6');
        expect(shown.includes(' ...')).toBe(count > 6);
      }
    }
  }
  for (const exception of [false, true]) {
    const detail = 'HTTP 401 原错误 {detail}';
    const run = make('fake', { ok: false, message: detail }, exception ? new Error(detail) : undefined);
    await run.handler();
    const ui = run.status.mock.calls.at(-1)![1] as UiStatusMessage;
    expect(translateUi('ja-JP', ui.key, ui.params)).toBe(`❌ ${detail}`);
    expect(run.track.mock.calls[0][1].result).toBe(exception ? 'exception' : 'failed');
    expect(run.testing).toHaveBeenLastCalledWith(false);
  }
});

it.each(['Mcd', 'Luckin'])('clears %s localized metadata on reset or raw status', provider => {
  const js = ts.transpileModule(block(source, `set${provider}TestStatus`) + `\nreturn set${provider}TestStatus;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const raw = vi.fn(), ui = vi.fn();
  const setter = new Function(`setRaw${provider}TestStatus`, `set${provider}TestUi`, js)(raw, ui);
  setter('wait', { key: 'settings.order.testing' });
  setter('');
  expect(ui).toHaveBeenLastCalledWith(null);
  expect(raw).toHaveBeenLastCalledWith('');
  setter('unknown response');
  expect(ui).toHaveBeenLastCalledWith(null);
});

it('keeps activation phrases, links, payment warnings and original form wiring', () => {
  for (const locale of ['zh-CN', 'ja-JP'] as const) {
    expect(translateUi(locale, 'settings.order.mcdHelp')).toContain('麦请求');
    expect(translateUi(locale, 'settings.order.luckinHelp')).toContain('瑞一杯');
    expect(translateUi(locale, 'settings.order.proxy')).toContain('/mcp/luckin');
  }
  expect(translateUi('ja-JP', 'settings.order.payment')).toContain('実際の支払い');
  expect(translateUi('ja-JP', 'settings.order.payment')).toContain('確認を待って');
  for (const text of ['https://open.mcd.cn/mcp', 'https://open.lkcoffee.com', 'value={mcdToken}', 'value={luckinToken}', 'onClick={testMcdApi}', 'onClick={testLuckinApi}', "mcdTestStatus.startsWith('✅')", "luckinTestStatus.startsWith('❌')"]) expect(source).toContain(text);
  for (const provider of ['mcd', 'luckin']) expect(source).toContain(`${provider}TestUi ? t(${provider}TestUi.key, ${provider}TestUi.params) : ${provider}TestStatus`);
});
