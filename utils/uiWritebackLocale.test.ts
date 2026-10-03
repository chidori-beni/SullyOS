import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';

it.each(['', 'DeepSeek', '私有预设 {name} 🌸'])('keeps preset names literal in writeback messages: %s', name => {
  expect(translateUi('zh-CN', 'settings.writeback.changed', { name })).toBe(`当前配置已经和预设「${name}」不一样了。`);
  expect(translateUi('ja-JP', 'settings.writeback.changed', { name })).toBe(`現在の設定はプリセット「${name}」と異なっています。`);
  expect(translateUi('ja-JP', 'settings.writeback.saved', { name })).toBe(`プリセット「${name}」に保存しました`);
});

it('translates all new fixed copy with no missing-key fallback', () => {
  expect(translateUi('zh-CN', 'settings.writeback.help')).toBe('若不保存，当前配置为临时配置，切换预设后消失。若保存，则用当前配置覆盖这条预设原来的内容。');
  for (const key of [
    'settings.vision.descriptionBefore', 'settings.vision.descriptionAfter',
    'settings.writeback.title', 'settings.writeback.skip', 'settings.writeback.help',
  ] as const) {
    expect(translateUi('ja-JP', key)).not.toBe(translateUi('zh-CN', key));
    expect(translateUi('ja-JP', key)).not.toBe(key);
  }
});

it('keeps the literal image protocol example and original writeback actions', () => {
  const source = readFileSync(resolve(process.cwd(), 'apps/Settings.tsx'), 'utf8');
  expect(source).toContain('> [图片：模型看到的内容] </span>');
  expect(source).toContain("t('settings.vision.descriptionBefore')");
  expect(source).toContain("t('settings.vision.descriptionAfter')");
  const confirm = source.slice(source.indexOf('const confirmPresetWriteback'), source.indexOf('const openModelPicker'));
  expect(confirm).toContain('setPresetWriteback(null)');
  expect(confirm).toContain('if (!presetWriteback) return');
  expect(confirm).toContain('if (!preset) return');
  expect(confirm).toContain('updateApiPreset(preset.id, preset.name, { ...preset.config, ...presetWriteback.config })');
  expect(confirm).toContain("addToast(t('settings.writeback.saved', { name: preset.name }), 'success')");
  const modal = source.slice(source.indexOf('{/* 保存后问要不要存回预设 */}'), source.indexOf('{/* 强制导出 Modal */}'));
  expect(modal).toContain("title={t('settings.writeback.title')}");
  expect(modal).toContain('onClose={() => setPresetWriteback(null)}');
  expect(modal).toContain("onClick={() => setPresetWriteback(null)}");
  expect(modal).toContain('onClick={confirmPresetWriteback}');
  expect(modal).toContain('name: apiPresets.find(item => item.id === presetWriteback?.presetId)?.name');
  expect(modal).not.toContain('updateApiConfig');
});
