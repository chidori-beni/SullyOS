import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
import { translateUi, type UiLocale, type UiMessageKey, type UiMessageParams, type UiStatusMessage } from './uiLocale';
import McpConnectionConsole from '../components/settings/McpConnectionConsole';
import type { McpServerConfig } from './mcpClient';

const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale, servers: [] as McpServerConfig[] }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ locale: state.locale, t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params) }) }));
vi.mock('../context/OSContext', () => ({ useOS: () => ({ characters: [{ id: 'char-id', name: '角色原名 {count}' }], groups: [{ id: 'group-id', name: '群名原样' }] }) }));
vi.mock('./mcpClient', () => ({ loadMcpServers: () => state.servers, getMcpUseNativeTools: () => true }));
vi.mock('@phosphor-icons/react', () => Object.fromEntries(['CaretDown', 'CheckCircle', 'GlobeHemisphereWest', 'LockKey', 'Plus', 'SpinnerGap', 'Trash', 'WarningCircle'].map(name => [name, () => null])));
const path = 'components/settings/McpConnectionConsole.tsx';
const source = readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r/g, '');
const baseline = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }).replace(/\r/g, '');
const block = (s: string, name: string) => {
  const start = s.indexOf(`const ${name} =`);
  return s.slice(start, s.indexOf('\n    };', start) + 7);
};
const server: McpServerConfig = { id: 'raw-id', name: '自定{count} 🌸', url: 'https://example.invalid/mcp', enabled: true, updatedAt: 2, customHeaders: [{ name: 'X-API-Key', value: 'fake-header' }], token: 'fake-token', proxyUrl: 'http://localhost:18061', proxyKey: 'fake-key', charIds: ['char-id'], tools: Array.from({ length: 13 }, (_, i) => ({ name: `raw_tool${i}`, title: `原工具${i}`, inputSchema: { type: 'object' } })), lastConnection: { testedAt: 12345, protocolVersion: '2025-03-26' } };

it.each(['zh-CN', 'ja-JP'] as const)('renders complete empty and expanded MCP console in %s without saving', locale => {
  state.locale = locale;
  const toast = vi.fn(), changed = vi.fn();
  state.servers = [];
  const empty = renderToStaticMarkup(React.createElement(McpConnectionConsole, { addToast: toast, onMcpConfigChanged: changed }));
  expect(empty).toContain(translateUi(locale, 'settings.mcp.empty'));
  state.servers = [server];
  const html = renderToStaticMarkup(React.createElement(McpConnectionConsole, { addToast: toast, onMcpConfigChanged: changed }));
  for (const key of ['name', 'auth', 'proxy', 'chats', 'token', 'privacy', 'retest', 'headerName', 'moreTools'] as const) expect(html).toContain(translateUi(locale, `settings.mcp.${key}`, { index: 1, count: 1 }));
  for (const raw of ['自定{count} 🌸', '角色原名 {count}', '群名原样', '原工具0', '原工具11', 'X-API-Key', '2025-03-26']) expect(html).toContain(raw);
  expect(html).not.toContain('原工具12');
  expect(html).toContain('type="password"');
  expect(toast).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

it('preserves storage, default persisted names, native tools switch and endpoint invalidation', () => {
  for (const name of ['persist', 'addServer']) expect(block(source, name)).toBe(block(baseline, name));
  const start = 'const endpointChanged =';
  const end = 'const formatTestTime =';
  expect(source.slice(source.indexOf(start), source.indexOf(end))).toBe(baseline.slice(baseline.indexOf(start), baseline.indexOf(end)));
  expect(block(source, 'update').replace(", uiMessage: { key: 'settings.mcp.stale' }", '')).toBe(block(baseline, 'update'));
  const toggle = (s: string) => s.slice(s.indexOf('onChange={next => {'), s.indexOf('trackEvent(\'切换原生工具调用\'') + 77);
  expect(toggle(source)).toBe(toggle(baseline));
  for (const text of ['token: event.target.value.trim()', 'url: event.target.value.trim()', 'proxyUrl: event.target.value.trim()', 'proxyKey: event.target.value.trim()', 'name: event.target.value', 'charIds: []', 'update(server.id, { enabled: next })']) expect(source).toContain(text);
});

it.each(['zh-CN', 'ja-JP'] as const)('tests connection stages and raw failures in %s with fakes only', async locale => {
  const js = ts.transpileModule(block(source, 'discover') + '\nreturn discover;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const t = (key: UiMessageKey, params?: UiMessageParams) => translateUi(locale, key, params);
  const make = (result: unknown) => {
    const states: { message: string; uiMessage?: UiStatusMessage; tone: string }[] = [];
    const testing = vi.fn(), update = vi.fn(), toast = vi.fn(), track = vi.fn();
    const connection = vi.fn(async (_s: unknown, stage: (s: string) => void) => { stage('initialize'); stage('tools'); return result; });
    const setStates = (setter: (current: unknown) => Record<string, typeof states[number]>) => { states.push(setter({})[server.id]); };
    const handler = new Function('t', 'addToast', 'setTestingId', 'setTestStates', 'testMcpConnection', 'stageCopy', 'update', 'trackEvent', js)(t, toast, testing, setStates, connection, (stage: string) => stage === 'initialize' ? 'settings.mcp.initialize' : 'settings.mcp.readingTools', update, track);
    return { handler, states, testing, update, toast, track, connection };
  };
  const missing = make(null);
  await missing.handler({ ...server, url: ' ' });
  expect(missing.connection).not.toHaveBeenCalled();
  expect(missing.toast).toHaveBeenCalledWith(t('settings.mcp.urlRequired'), 'error');
  for (const count of [0, 3]) {
    const tools = server.tools!.slice(0, count), connection = { ...server.lastConnection!, serverName: '服务原名{count}', serverVersion: 'v1.2' };
    const run = make({ ok: true, message: 'raw response', tools, connection });
    await run.handler(server);
    expect(run.connection).toHaveBeenCalledTimes(1);
    expect(run.states.map(s => s.uiMessage?.key)).toEqual(['settings.mcp.connecting', 'settings.mcp.initialize', 'settings.mcp.readingTools', count ? 'settings.mcp.connectedTools' : 'settings.mcp.connectedEmpty']);
    const ui = run.states.at(-1)!.uiMessage!;
    const shown = t(ui.key, ui.params);
    expect(shown).toContain('服务原名{count} v1.2');
    expect(shown).toContain(connection.protocolVersion);
    if (count) expect(shown).toContain(String(count));
    expect(run.update).toHaveBeenCalledWith(server.id, { tools, lastConnection: connection });
    expect(run.testing).toHaveBeenLastCalledWith(null);
  }
  const detail = '鉴权失败 HTTP 401 {detail}';
  const failed = make({ ok: false, message: detail });
  await failed.handler(server);
  expect(failed.states.at(-1)).toEqual({ tone: 'error', message: detail });
  expect(failed.update).not.toHaveBeenCalled();
  expect(failed.track).toHaveBeenCalledWith('测试 MCP 服务器连接', { result: 'failed', failureKind: 'auth-failed' });
  expect(failed.testing).toHaveBeenLastCalledWith(null);
});

it('requires localized deletion confirmation and does nothing on cancel', () => {
  const js = ts.transpileModule(block(source, 'removeServer') + '\nreturn removeServer;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const reset = vi.fn(), persist = vi.fn(), expanded = vi.fn(), track = vi.fn(), confirm = vi.fn((_message: string) => false);
  const t = (key: UiMessageKey, params?: UiMessageParams) => translateUi('ja-JP', key, params);
  const handler = new Function('window', 't', 'resetMcpSession', 'persist', 'servers', 'setExpandedId', 'trackEvent', js)({ confirm }, t, reset, persist, [server], expanded, track);
  handler(server);
  expect(confirm.mock.calls[0][0]).toContain(server.name);
  expect(reset).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  handler(server);
  expect(reset).toHaveBeenCalledWith(server.id);
  expect(persist).toHaveBeenCalledWith([]);
});

it('localizes help and copy text without altering the guide link or config synchronization', () => {
  const settings = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const original = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const sync = (s: string) => s.slice(s.indexOf('<McpConnectionConsole'), s.indexOf('{/* MCP 帮助 Modal')).replace(/\r/g, '');
  expect(sync(settings)).toBe(sync(original));
  expect(settings).toContain('href={MCP_USER_GUIDE_URL}');
  expect(settings).toContain("t('settings.mcp.aiPrompt', { url: MCP_USER_GUIDE_URL })");
  expect(settings).toContain('await navigator.clipboard.writeText(text)');
  for (const locale of ['zh-CN', 'ja-JP'] as const) {
    expect(translateUi(locale, 'settings.mcp.aiPrompt', { url: 'https://example.invalid/guide{url}' })).toContain('https://example.invalid/guide{url}');
    expect(translateUi(locale, 'settings.mcp.fetchTitle')).toContain('Failed to fetch');
    expect(translateUi(locale, 'settings.mcp.tunnelHelp')).toContain('Cloudflare Tunnel');
  }
});

it.each(['zh-CN', 'ja-JP'] as const)('copies the guide in %s and reports clipboard failure with fakes', async locale => {
  const settings = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const start = settings.indexOf("const text = t('settings.mcp.aiPrompt'");
  const body = settings.slice(start, settings.indexOf('\n                      }}', start));
  const js = ts.transpileModule(`return async () => {${body}\n};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const t = (key: UiMessageKey, params?: UiMessageParams) => translateUi(locale, key, params);
  for (const fail of [false, true]) {
    const writeText = vi.fn(async (_text: string) => { if (fail) throw new Error('fake clipboard blocked'); });
    const toast = vi.fn(), track = vi.fn();
    const copy = new Function('t', 'MCP_USER_GUIDE_URL', 'navigator', 'trackEvent', 'addToast', js)(t, 'https://example.invalid/guide', { clipboard: { writeText } }, track, toast);
    await copy();
    expect(writeText).toHaveBeenCalledWith(t('settings.mcp.aiPrompt', { url: 'https://example.invalid/guide' }));
    expect(toast).toHaveBeenCalledWith(t(fail ? 'settings.mcp.copyFailed' : 'settings.mcp.copied'), fail ? 'error' : 'success');
    expect(track.mock.calls[0][1].result).toBe(fail ? 'clipboard-failed' : 'copied');
  }
});
