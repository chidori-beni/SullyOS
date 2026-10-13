import { afterEach, expect, it, vi } from 'vitest';
import { testConnection } from './webdavClient';
import { translateUi } from './uiLocale';
import type { CloudBackupConfig } from '../types';
vi.mock('./proxyWorker', () => ({ getProxyWorkerUrl: () => 'https://proxy.invalid' }));
const config = { webdavUrl: 'https://dav.invalid', remotePath: '/backup', username: 'u', password: 'p' } as CloudBackupConfig;
afterEach(() => vi.unstubAllGlobals());
it.each([
  [[200], true, 'connected', '连接成功'],
  [[207], true, 'connected', '连接成功'],
  [[401], false, 'auth', '认证失败：请检查用户名和密码'],
  [[404, 201], true, 'created', '连接成功（已自动创建备份目录）'],
  [[404, 405], true, 'created', '连接成功（已自动创建备份目录）'],
  [[404, 500], false, 'directory', '备份目录不存在且无法创建'],
  [[503], false, 'status', '服务器返回 503'],
] as const)('keeps request outcome and original message: %s', async (statuses, ok, key, message) => {
  const fetchMock = vi.fn();
  for (const status of statuses) fetchMock.mockResolvedValueOnce(new Response('', { status }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await testConnection(config);
  expect(result.ok).toBe(ok);
  expect(result.message).toBe(message);
  expect(result.uiMessage?.key).toBe(`settings.webdavResult.${key}`);
  expect(translateUi('zh-CN', result.uiMessage!.key, result.uiMessage!.params)).toBe(message);
  expect(translateUi('ja-JP', result.uiMessage!.key, result.uiMessage!.params)).not.toBe(message);
  expect(fetchMock).toHaveBeenCalledTimes(statuses.length);
});
it('preserves raw network errors as literal parameters', async () => {
  const raw = 'Load failed {status} 🌸';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(raw)));
  const result = await testConnection(config);
  expect(result.message).toBe(`连接失败: ${raw}`);
  expect(translateUi('ja-JP', result.uiMessage!.key, result.uiMessage!.params)).toBe(`接続失敗: ${raw}`);
});
