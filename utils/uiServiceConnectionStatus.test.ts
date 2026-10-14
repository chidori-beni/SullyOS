import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { getServiceConnectionUi } from './uiServiceConnectionStatus';
import { translateUi, type UiMessageKey, type UiMessageParams } from './uiLocale';

const examples: Array<['notion' | 'feishu' | 'mcp', string, string?]> = [
  ['notion', '连接失败: 原错误 {detail}\nHTTP 401', '原错误 {detail}\nHTTP 401'],
  ['notion', '网络错误: Load failed', 'Load failed'],
  ['notion', '连接成功！数据库: 我的{count}数据库', '我的{count}数据库'],
  ['notion', '返回格式错误'],
  ['notion', '无法连接到代理服务器 https://fake.invalid：请先在浏览器里试试能否直接打开该地址。打不开说明当前网络访问不了它（换网络/开代理后重试），或在「设置 → 网络代理 (Worker)」填入自部署的 Worker 地址', 'https://fake.invalid'],
  ['feishu', '读取连接成功！数据表: 原表名{count}。注意：这里不创建测试记录，新增记录权限会在角色首次写日记时验证。', '原表名{count}'],
  ['feishu', '飞书错误: 请检查多维表格权限'],
  ['feishu', '获取token失败: HTTP 403 {detail}', 'HTTP 403 {detail}'],
  ['feishu', '飞书错误: 未知错误'],
  ['feishu', '飞书错误: raw 错误{detail}', 'raw 错误{detail}'],
  ['feishu', '多维表格中未找到表 tbl-123。可用表: 日记(tbl-456), notes(tbl-7)', '日记(tbl-456), notes(tbl-7)'],
  ['feishu', '多维表格中未找到表 tbl-123。可用表: 无', 'tbl-123'],
  ['mcp', 'MCP 请求超时（60 秒）', '60'],
  ['mcp', 'MCP 鉴权失败 (401): Token 可能无效或过期。原始error{detail}', '原始error{detail}'],
  ['mcp', 'MCP HTTP 502: <html>原响应</html>', '<html>原响应</html>'],
  ['mcp', 'Initialize 失败: raw RPC {operation}', 'raw RPC {operation}'],
  ['mcp', 'tools/list 失败: tool list raw error', 'tool list raw error'],
  ['mcp', 'MCP: 无法解析响应: raw response{detail}', 'raw response{detail}'],
  ['mcp', 'MCP SSE 流结束，但没有收到本次请求的响应'],
  ['mcp', 'MCP 请求失败: Failed to fetch。请检查代理 URL 是否可访问、代理密钥是否正确。', 'Failed to fetch'],
  ['mcp', 'MCP 请求失败: Load failed。很可能是浏览器 CORS 限制。请在这个服务器的「代理 URL」里配置代理（本地 node scripts/mcp-proxy.mjs 或自部署 worker/mcp-proxy）。', 'Load failed'],
  ['mcp', 'MCP 请求失败: raw{detail}。', 'raw{detail}'],
  ['mcp', 'MCP 协议版本不兼容：服务器选择了 2026-07-28。SullyOS 的 Streamable HTTP 接线支持 2025-03-26 / 2025-06-18；2024-11-05 属于旧 HTTP+SSE 双端点，2026-07-28 则需要新的无握手生命周期。', '2026-07-28'],
];

it.each(examples)('translates only the exact %s wrapper: %s', (service, original, detail) => {
  const ui = getServiceConnectionUi(service, original);
  expect(ui).toBeDefined();
  expect(translateUi('zh-CN', ui!.key, ui!.params)).toBe(original);
  const ja = translateUi('ja-JP', ui!.key, ui!.params);
  if (detail) expect(ja).toContain(detail);
  expect(ja).not.toContain('undefined');
});

it('does not rewrite unknown service text or cross-service lookalikes', () => {
  for (const service of ['notion', 'feishu', 'mcp'] as const) for (const text of ['raw{detail}', '认证失败：服务自己的说明', 'prefix MCP 请求超时（60 秒）', 'MCP 请求失败: detail。未知建议', '']) expect(getServiceConnectionUi(service, text)).toBeUndefined();
  expect(getServiceConnectionUi('notion', 'MCP HTTP 401: text')).toBeUndefined();
  expect(getServiceConnectionUi('mcp', '返回格式错误')).toBeUndefined();
});

it.each(['notion', 'feishu'] as const)('runs %s settings handler with fake success, failure and unknown results', async service => {
  const source = readFileSync('apps/Settings.tsx', 'utf8');
  const name = service === 'notion' ? 'testNotionApi' : 'testFeishuApi';
  const start = source.indexOf(`const ${name} =`);
  const body = source.slice(start, source.indexOf('\n  };', start) + 5);
  const js = ts.transpileModule(body + `\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const original = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const originalStart = original.indexOf(`const ${name} =`);
  const originalBody = original.slice(originalStart, original.indexOf('\n  };', originalStart) + 5);
  expect(body.replace(/, getServiceConnectionUi\('(notion|feishu)', result.message\)/g, '').replace(/\r/g, '')).toBe(originalBody.replace(/, getServiceConnectionUi\('(notion|feishu)', result.message\)/g, '').replace(/\r/g, ''));
  const args = ['rtNotionKey', 'rtNotionDbId', 'rtFeishuAppId', 'rtFeishuAppSecret', 'rtFeishuBaseId', 'rtFeishuTableId', 'NotionManager', 'FeishuManager', 'trackEvent', 'setRtTestStatus', 'getServiceConnectionUi'];
  for (const message of [examples.find(e => e[0] === service && e[1].includes('成功'))![1], '连接失败: HTTP 401 {detail}', 'unknown raw']) {
    const testConnection = vi.fn(async () => ({ success: message.includes('成功'), message }));
    const status = vi.fn(), track = vi.fn();
    const handler = new Function(...args, js)('fake', 'db-id', 'app-id', 'fake', 'base-id', 'table-id', { testConnection }, { testConnection }, track, status, getServiceConnectionUi);
    await handler();
    expect(testConnection).toHaveBeenCalledWith(...(service === 'notion' ? ['fake', 'db-id'] : ['app-id', 'fake', 'base-id', 'table-id']));
    expect(status).toHaveBeenLastCalledWith(message, getServiceConnectionUi(service, message));
  }
});

it('keeps rescue actions and analytics controls unchanged beyond display copy', () => {
  const source = readFileSync('apps/Settings.tsx', 'utf8'), baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  for (const name of ['handleJournalAppearanceEmergencyReset', 'handleAppearanceEmergencyReset']) {
    const block = (s: string) => { const start = s.indexOf(`const ${name} =`); return s.slice(start, s.indexOf('\n  };', start) + 5).replace(/\r/g, ''); };
    expect(block(source)).toBe(block(baseline));
  }
  const confirmStart = source.indexOf("if (window.confirm(t('settings.rescue.chromeConfirm')))");
  expect(confirmStart).toBeGreaterThan(0);
  const fragment = source.slice(confirmStart, source.indexOf('}}', confirmStart));
  const js = ts.transpileModule(`return () => {${fragment}};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const reset = vi.fn();
  const t = (key: UiMessageKey, params?: UiMessageParams) => translateUi('ja-JP', key, params);
  new Function('window', 't', 'resetAllChromeCss', js)({ confirm: () => false }, t, reset)();
  expect(reset).not.toHaveBeenCalled();
  const toggle = (s: string) => { const start = s.indexOf('checked={analyticsEnabled}'); return s.slice(start, s.indexOf('className=', start)).replace(/\r/g, ''); };
  expect(toggle(source)).toBe(toggle(baseline));
  expect(source).toContain('onClick={handleAppearanceEmergencyReset}');
  expect(source).toContain('disabled={resettingAppearance}');
  expect(source).toContain("t('common.cancel')");
});
