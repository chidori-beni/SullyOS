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
it('localizes restore list shell while preserving files, raw errors and selection guards', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const list = source.slice(source.indexOf('{/* Cloud Restore Modal */}'), source.indexOf('{/* 模型选择 Modal */}'));
  for (const key of ['loading', 'failed', 'reload', 'empty', 'choose', 'incomplete', 'unrestorable', 'unknownTime', 'viewGithub'] as const) {
    expect(list).toContain(`t('settings.cloudRestore.${key}')`);
    expect(translateUi('ja-JP', `settings.cloudRestore.${key}`)).not.toBe(translateUi('zh-CN', `settings.cloudRestore.${key}`));
  }
  expect(list).toContain("file.status === 'incomplete'");
  expect(list).toContain('onClick={() => handleCloudRestore(file)}');
  expect(list).toContain('cloudBackupListError ||');
  expect(list).toContain('formatCloudBackupStatus(locale, file) ||');
  expect(list.match(/new Date\(file.lastModified\).toLocaleString\(locale\)/g)).toHaveLength(2);
  expect(list).toContain('{file.name}');
  expect(list).toContain('file.size / 1024 / 1024');
});
it('localizes cloud warnings without changing control names or permission links', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  for (const key of ['networkTitle', 'networkBefore', 'networkStrong', 'networkAfter', 'passwordTitle', 'passwordHelp', 'githubTitle', 'expiryBefore', 'expiryLabel', 'expiryStrong', 'expiryAfter', 'expiryWarning', 'permissionsBefore', 'permissionsAfter', 'generateBefore', 'generateAfter'] as const) {
    expect(source).toContain(`t('settings.cloudWarnings.${key}')`);
    expect(translateUi('ja-JP', `settings.cloudWarnings.${key}`)).not.toBe(translateUi('zh-CN', `settings.cloudWarnings.${key}`));
  }
  for (const locale of ['zh-CN', 'ja-JP'] as const) {
    for (const name of ['Apps Password', 'Apps', 'WebDAV URL', 'Connection ID', '401']) expect(translateUi(locale, 'settings.cloudWarnings.passwordHelp')).toContain(name);
    expect(translateUi(locale, 'settings.cloudWarnings.expiryStrong')).toContain('No expiration');
  }
  for (const name of ['Expiration', 'repo', 'Generate token']) expect(source).toContain(`<b>${name}</b>`);
  expect(source).toContain('https://github.com/settings/tokens/new?scopes=repo&description=Sully%20%E5%A4%87%E4%BB%BD');
});
it('keeps WebDAV tutorial control names and signup link unchanged in both languages', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  for (const key of ['quick', 'register', 'email', 'step2', 'step3', 'step4'] as const) {
    expect(source).toContain(`t('settings.webdavGuide.${key}')`);
    expect(translateUi('ja-JP', `settings.webdavGuide.${key}`)).not.toBe(translateUi('zh-CN', `settings.webdavGuide.${key}`));
  }
  for (const locale of ['zh-CN', 'ja-JP'] as const) {
    expect(translateUi(locale, 'settings.webdavGuide.step2')).toContain('Turn on Apps Connection');
    for (const name of ['WebDAV URL', 'Connection ID', 'Apps Password']) expect(translateUi(locale, 'settings.webdavGuide.step3')).toContain(name);
  }
  expect(source).toContain('href="https://infini-cloud.net/"');
});
it('localizes introductory copy while preserving provider names and repository input', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  for (const key of ['intro', 'china', 'chinaTail', 'recommended', 'githubHint', 'webdavHint', 'steps', 'step1', 'step2', 'step3a', 'step3b', 'step3c'] as const) {
    expect(source).toContain(`t('settings.cloudGuide.${key}')`);
    expect(translateUi('ja-JP', `settings.cloudGuide.${key}`)).not.toBe(translateUi('zh-CN', `settings.cloudGuide.${key}`));
  }
  expect(source).toContain("{ghRepo || 'sully-backup'}</code>");
  expect(source).toContain("provider: 'github'");
  expect(source).toContain("provider: 'webdav'");
  expect(source).toContain('https://github.com/settings/tokens/new?scopes=repo&description=Sully%20%E5%A4%87%E4%BB%BD');
});
it('localizes provider switching and modal footer without changing their actions', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  for (const key of ['switchGithub', 'tryGithub', 'keepWebdav', 'disconnect', 'done'] as const) {
    expect(source).toContain(`t('settings.github.${key}')`);
    expect(translateUi('ja-JP', `settings.github.${key}`)).not.toBe(translateUi('zh-CN', `settings.github.${key}`));
  }
  expect(source).toContain("cloudBackupConfig.githubToken ? t('settings.github.switchGithub') : t('settings.github.tryGithub')");
  expect(source).toContain('onClick={switchToGithub}');
  expect(source).toContain('onClick={handleDisableCloud}');
  expect(source).toContain("disabled={!cloudBackupConfig.enabled || cloudBackupConfig.provider !== 'github'}");
  expect(source).toContain("{t('common.close')}</button>");
});
it('localizes GitHub form copy without modifying credentials or result handling', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  for (const key of ['createToken', 'tokenHelp', 'connecting', 'connect', 'destination', 'releases', 'collapse', 'advanced', 'repo', 'autoRepo', 'proxy', 'proxyHelp', 'backWebdav', 'useWebdav'] as const) {
    expect(source).toContain(`t('settings.github.${key}')`);
    expect(translateUi('ja-JP', `settings.github.${key}`)).not.toBe(translateUi('zh-CN', `settings.github.${key}`));
  }
  for (const field of ['ghToken', 'ghRepo']) expect(source).toContain(`value={${field}}`);
  expect(source).toContain('checked={ghUseProxy}');
  expect(source).toContain('onClick={handleTestGithub}');
  expect(source).toContain('ghTestResult?.success && cloudBackupConfig.githubOwner');
  expect(source).toContain('ghTestResult.uiMessage ? t(ghTestResult.uiMessage.key, ghTestResult.uiMessage.params) : ghTestResult.message');
  expect(source).toContain("cloudBackupConfig.githubRepo || 'sully-backup'");
  expect(translateUi('ja-JP', 'settings.github.proxyHelp')).toContain('32MB');
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
  expect(source).toContain('cloudTestResult.uiMessage ? t(cloudTestResult.uiMessage.key, cloudTestResult.uiMessage.params) : cloudTestResult.message');
  expect(source).toContain("handleCloudBackup('text_only')");
  expect(source).toContain("handleCloudBackup('full')");
});
it('keeps all cloud request/save/restore handler implementations identical to the remote baseline', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:apps/Settings.tsx'], { encoding: 'utf8' });
  const handlers = (value: string) => value.slice(value.indexOf('// Cloud Backup Handlers'), value.indexOf('const handleSaveRealtimeConfig')).replace(/\r/g, '')
    .replace('setCloudTestResult(null);', "setCloudTestResult('');")
    .replace('setCloudTestResult({ success: result.ok, message: result.message, uiMessage: result.uiMessage });', 'setCloudTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);')
    .replace('setCloudTestResult({ success: false, message: String(e.message) });', 'setCloudTestResult(`✗ ${e.message}`);')
    .replace("setGhTestResult({ success: false, message: '请先粘贴 Token', uiMessage: { key: 'settings.githubResult.pasteToken' } });", "setGhTestResult('✗ 请先粘贴 Token');")
    .replace('setGhTestResult(null);', "setGhTestResult('');")
    .replace('setGhTestResult({ success: result.ok, message: result.message, uiMessage: result.uiMessage });', 'setGhTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);')
    .replace("setGhTestResult({ success: false, message: e?.message || '连接失败', uiMessage: e?.message ? undefined : { key: 'settings.githubResult.failed' } });", "setGhTestResult(`✗ ${e?.message || '连接失败'}`);")
    .replace("t('settings.cloud.saved')", "'云端备份配置已保存'")
    .replace("t('settings.cloudRestore.failed')", "'获取云端备份列表失败'")
    .replace("t('settings.cloudRestore.blocked')", "'这个备份上传未完成，暂时不能恢复'")
    .replace("t('settings.cloudRestore.errorTitle')", "'云端恢复失败'")
    .replace("t('settings.cloud.disabled')", "'云端备份已关闭'")
    .replace('formatCloudBackupStatus(locale, file)', 'file.statusMessage');
  expect(source).toContain('const handleSaveRealtimeConfig');
  expect(handlers(source).length).toBeGreaterThan(1000);
  expect(handlers(source)).toBe(handlers(baseline));
});
