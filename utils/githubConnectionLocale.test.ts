import { afterEach, expect, it, vi } from 'vitest';
import { testConnection, verifyToken, ensureRepo } from './githubClient';
import { translateUi } from './uiLocale';
import type { UiStatusMessage } from './uiLocale';
import type { CloudBackupConfig } from '../types';
const config = { githubToken: 'fake', githubOwner: 'user', githubRepo: 'repo{status}', githubUseProxy: false } as CloudBackupConfig;
afterEach(() => vi.unstubAllGlobals());
const response = (status: number, data = {}) => new Response(JSON.stringify(data), { status });
const check = (result: { message: string; uiMessage?: UiStatusMessage }) => {
  expect(result.uiMessage).toBeDefined();
  expect(translateUi('zh-CN', result.uiMessage!.key, result.uiMessage!.params)).toBe(result.message);
  expect(translateUi('ja-JP', result.uiMessage!.key, result.uiMessage!.params)).not.toBe(result.message);
};
it.each([200, 401, 403, 503])('preserves token status and original message: %s', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status, { login: 'user' })));
  const result = await verifyToken('fake', false);
  expect(result.ok).toBe(status === 200);
  check(result);
});
it.each([[200], [503], [404, 201], [404, 422], [404, 403], [404, 500]].map(statuses => ({ statuses })))('preserves repository preparation: $statuses', async ({ statuses }) => {
  const fetchMock = vi.fn();
  for (const status of statuses) fetchMock.mockResolvedValueOnce(response(status));
  vi.stubGlobal('fetch', fetchMock);
  const result = await ensureRepo(config);
  expect(result.ok).toBe(statuses[statuses.length - 1] === 200 || statuses[statuses.length - 1] === 201);
  check(result);
  expect(fetchMock).toHaveBeenCalledTimes(statuses.length);
});
it('keeps login, repo name, original error and empty-token paths literal', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response(200, { login: 'user{error}' })).mockResolvedValueOnce(response(200));
  vi.stubGlobal('fetch', fetchMock);
  const result = await testConnection(config);
  expect(result.login).toBe('user{error}');
  expect(result.message).toBe('已连接 @user{error} → repo{status}');
  check(result);
  check(await testConnection({ ...config, githubToken: '' }));
  check(await ensureRepo({ ...config, githubOwner: '' }));
  const raw = 'Load failed {login} 🌸';
  fetchMock.mockRejectedValueOnce(new Error(raw));
  const error = await verifyToken('fake', false);
  check(error);
  expect(translateUi('ja-JP', error.uiMessage!.key, error.uiMessage!.params)).toBe(`接続失敗: ${raw}`);
});
