import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';

it.each([0, 1, 30])('renders reminder days without changing values: %s', days => {
  expect(translateUi('zh-CN', 'settings.reminder.every', { days })).toBe(`每 ${days} 天`);
  expect(translateUi('ja-JP', 'settings.reminder.every', { days })).toBe(`${days} 日ごと`);
  expect(translateUi('ja-JP', 'settings.reminder.last', { days })).toContain(String(days));
});
it('keeps formatted timestamp parameters literal', () => {
  expect(translateUi('ja-JP', 'settings.cloud.last', { time: '日時 {days} 🌸' })).toBe('前回のバックアップ: 日時 {days} 🌸');
  expect(translateUi('ja-JP', 'settings.reminder.never')).not.toBe(translateUi('zh-CN', 'settings.reminder.never'));
});
it('keeps reminder and cloud configuration input wiring and credentials unchanged', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain('min={BACKUP_REMINDER_MIN_DAYS}');
  expect(source).toContain('max={BACKUP_REMINDER_MAX_DAYS}');
  expect(source).toContain('setBackupReminderIntervalDays(v)');
  expect(source).toContain('backupDaysAgo == null');
  expect(source).toContain('new Date(cloudBackupConfig.lastBackupTime).toLocaleString(locale)');
  for (const field of ['cbUrl', 'cbUsername', 'cbPassword', 'cbPath']) expect(source).toContain(`value={${field}}`);
  expect(source).toContain('disabled={cloudTesting || !cbUrl || !cbUsername || !cbPassword}');
  expect(source).toContain('onClick={handleSaveCloudConfig}');
  expect(source).toContain('updateCloudBackupConfig({ enabled: false })');
  expect(source).toContain('{cloudTestResult}');
  expect(source).toContain("handleCloudBackup('text_only')");
  expect(source).toContain("handleCloudBackup('full')");
});
it('keeps all cloud request/save/restore handler implementations identical to the remote baseline', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const handlers = (value: string) => value.slice(value.indexOf('// Cloud Backup Handlers'), value.indexOf('const handleSaveRealtimeConfig')).replace(/\r/g, '');
  expect(source).toContain('const handleSaveRealtimeConfig');
  expect(handlers(source).length).toBeGreaterThan(1000);
  expect(handlers(source)).toBe(handlers(baseline));
});
