import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translateUi, type UiStatusMessage } from './uiLocale';

it.each([0, 1, 123])('preserves inventory and restored counters: %s', count => {
  expect(translateUi('zh-CN', 'settings.modelBackup.inventory', { count, size: '7 MB' })).toBe(`${count} 个 · 7 MB`);
  expect(translateUi('ja-JP', 'settings.modelBackup.inventory', { count, size: '7 MB' })).toBe(`${count} 件 · 7 MB`);
  expect(translateUi('ja-JP', 'settings.modelBackup.restoredSkipped', { count, skipped: 3 })).toContain(String(count));
  expect(translateUi('ja-JP', 'settings.modelBackup.missingCount', { count })).toContain(String(count));
});

it('retranslates a frozen progress state without interpreting the character name', () => {
  expect(translateUi('ja-JP', 'settings.modelBackup.shareTitle')).toBe('Sully モデルバックアップ');
  const name = '萧逸 {percent} 🌸';
  const state: UiStatusMessage = Object.freeze({ key: 'settings.modelBackup.restoring', params: Object.freeze({ name, current: 1, total: 2 }) });
  expect(translateUi('zh-CN', state.key, state.params)).toBe(`正在恢复 ${name}（1/2）…`);
  expect(translateUi('ja-JP', state.key, state.params)).toBe(`${name} を復元中（1/2）…`);
  expect(state.params!.name).toBe(name);
});

it('retains multi-file order, character IDs, original labels and raw errors', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain('for (let fileIndex = 0; fileIndex < files.length; fileIndex++)');
  expect(source).toContain('await restoreAvatarModelBackup(file, progress =>');
  expect(source).toContain('updateCharacter(model.characterId, { videoAvatar: model.config })');
  expect(source).toContain('accept=".zip,application/zip"');
  expect(source).toContain('model.characterName');
  expect(source).toContain('{model.format} · {model.fileName}');
  expect(source).toContain("avatarModelBackupProgress.batchPrefix ?? ''");
  expect(source).toContain('t(avatarModelBackupProgress.uiMessage.key, avatarModelBackupProgress.uiMessage.params)');
  expect(source).toContain(': avatarModelBackupProgress.label');
  expect(source).toContain("addToast(error?.message || t('settings.modelBackup.exportFailed'), 'error')");
  expect(source).toContain("showError(t('settings.modelBackup.importFailed'), details)");
  expect(source).toContain("deliverStandaloneBackup(blob, fileName, t('settings.modelBackup.shareTitle'))");
});
