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

it('does not modify export/import behavior beyond explicit localized UI copy', () => {
  const current = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const handlers = (source: string) => source.slice(source.indexOf('const handleExport ='), source.indexOf('const handleImport ='));
  const normalize = (source: string) => source.replace(/\r/g, '')
    .replace(/'(?:该导出数据包含了明文密钥[^']*|该导出内容安全，可以用于分享)'|t\('settings\.backup\.export(?:Backend|Keys|Media)'\)/g, "'UI_WARNING'")
    .replace(/window\.confirm\(`\$\{msg\}[^\x60]*`\)|window\.confirm\(t\('settings\.backup\.exportConfirm', \{ warning: msg \}\)\)/g, "window.confirm('UI_CONFIRM')")
    .replace(/`这份备份里带着[^\x60]*`\s*\+ '如果这是[^']*'\s*\+ '如果是别人[^']*'\s*\+ '（不连[^']*）'|t\('settings\.backup\.restoreConfirm', \{ workerUrl \}\)/g, "'UI_RESTORE'")
    .replace(/'导入失败'|t\('settings\.backup\.importFailed'\)/g, "'UI_ERROR_TITLE'")
    .replace(/'导入失败，错误信息已展开'|t\('settings\.backup\.importFailedToast'\)/g, "'UI_ERROR_TOAST'");
  expect(normalize(handlers(current))).toBe(normalize(handlers(baseline)));
  const start = current.indexOf('const handleImport =');
  const end = current.indexOf("if (importInputRef.current) importInputRef.current.value = '';", start);
  expect(normalize(current.slice(start, end))).toBe(normalize(baseline.slice(baseline.indexOf('const handleImport ='), baseline.indexOf("if (importInputRef.current) importInputRef.current.value = '';", baseline.indexOf('const handleImport =')))));
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
