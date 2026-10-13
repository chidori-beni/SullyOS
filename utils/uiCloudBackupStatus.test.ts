import { afterEach, expect, it, vi } from 'vitest';
import { listBackups } from './githubClient';
import { formatCloudBackupStatus } from './uiCloudBackupStatus';
import type { CloudBackupConfig, CloudBackupFile } from '../types';
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])('keeps empty release status and original message: draft=%s', async draft => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1, tag_name: 'sully-backup-123', name: 'raw{reasons}', draft, assets: [], created_at: '2026-10-13' }]), { status: 200 })));
  const files = await listBackups({ githubToken: 'fake', githubOwner: 'u', githubRepo: 'r', githubUseProxy: false } as CloudBackupConfig);
  expect(files).toHaveLength(1);
  expect(files[0].status).toBe('incomplete');
  expect(files[0].name).toBe('raw{reasons}');
  expect(formatCloudBackupStatus('zh-CN', files[0])).toBe(files[0].statusMessage);
  expect(formatCloudBackupStatus('ja-JP', files[0])).not.toBe(files[0].statusMessage);
});
it('renders multiple reasons without changing counts or the original status', () => {
  const file = { status: 'incomplete', statusMessage: 'raw', statusUiReasons: [
    { key: 'settings.cloudStatus.draft' }, { key: 'settings.cloudStatus.parts', params: { done: 1, total: 3 } }, { key: 'settings.cloudStatus.manifest' },
  ] } as CloudBackupFile;
  expect(formatCloudBackupStatus('zh-CN', file)).toBe('上传未完成：Release 仍是草稿；分片不完整（1/3）；缺少完成标记');
  expect(formatCloudBackupStatus('ja-JP', file)).toContain('1/3');
  expect(file.statusMessage).toBe('raw');
  expect(file.status).toBe('incomplete');
});
it('keeps old or unknown raw status messages literal', () => {
  expect(formatCloudBackupStatus('ja-JP', { statusMessage: 'raw {reasons} 🌸' } as CloudBackupFile)).toBe('raw {reasons} 🌸');
});
