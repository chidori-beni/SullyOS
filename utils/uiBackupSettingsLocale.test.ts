import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';

it('localizes all ordinary backup labels and privacy warnings', () => {
  for (const key of [
    'settings.backup.backend', 'settings.backup.backendHelp', 'settings.backup.private',
    'settings.backup.privateHelp', 'settings.backup.fullBadge', 'settings.backup.full',
    'settings.backup.steps', 'settings.backup.text', 'settings.backup.media', 'settings.backup.import',
    'settings.backup.downloadTitle', 'settings.backup.ready', 'settings.backup.downloadHelp',
    'settings.backup.download', 'settings.backup.fullHelp', 'settings.backup.textHelp',
    'settings.backup.mediaHelp', 'settings.backup.voiceHelp', 'settings.backup.legacy',
  ] as const) {
    expect(translateUi('ja-JP', key)).not.toBe(translateUi('zh-CN', key));
    expect(translateUi('ja-JP', key)).not.toBe(key);
  }
  expect(translateUi('ja-JP', 'settings.backup.private')).toContain('他人に共有しない');
  expect(translateUi('ja-JP', 'settings.backup.import')).toContain('.zip / .json');
  expect(translateUi('ja-JP', 'settings.backup.voiceHelp')).toContain('お気に入りに登録していない');
});

it('does not modify export/import implementations or native security confirmations', () => {
  const current = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const handlers = (source: string) => source.slice(source.indexOf('const handleExport ='), source.indexOf('const handleImport ='));
  expect(handlers(current).replace(/\r/g, '')).toBe(handlers(baseline).replace(/\r/g, ''));
  const start = current.indexOf('const handleImport =');
  const end = current.indexOf("if (importInputRef.current) importInputRef.current.value = '';", start);
  expect(current.slice(start, end).replace(/\r/g, '')).toBe(baseline.slice(baseline.indexOf('const handleImport ='), baseline.indexOf("if (importInputRef.current) importInputRef.current.value = '';", baseline.indexOf('const handleImport ='))).replace(/\r/g, ''));
});

it('preserves file links, format filters, export modes and cleanup callbacks', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  for (const mode of ['full', 'text_only', 'media_only']) expect(source).toContain(`handleExport('${mode}')`);
  expect(source).toContain('accept=".json,.zip" onChange={handleImport}');
  expect(source).toContain('checked={exportBackendConnection}');
  expect(source).toContain('href={downloadUrl} download={downloadFileName}');
  expect(source).toContain("title={t('settings.backup.downloadTitle')}");
  expect(source).toContain('revokeDownloadUrl(); setShowExportModal(false);');
  expect(source).toContain("t('settings.backup.textHelp')");
  expect(source).toContain("t('settings.backup.mediaHelp')");
});
