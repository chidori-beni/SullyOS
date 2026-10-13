import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';
it.each([0, 1, 99, 100])('preserves compression percent and damaged counts: %s', value => {
  expect(translateUi('zh-CN', 'settings.exportOperation.compress', { pct: value })).toBe(`正在压缩备份数据 ${value}%...`);
  expect(translateUi('ja-JP', 'settings.exportOperation.compress', { pct: value })).toBe(`バックアップデータを圧縮中 ${value}%...`);
  expect(translateUi('ja-JP', 'settings.exportOperation.damaged', { count: value })).toContain(String(value));
});
it('keeps raw store ids literal', () => {
  expect(translateUi('ja-JP', 'settings.exportOperation.store', { store: 'memory_vectors{pct}' })).toBe('バックアップに追加中: memory_vectors{pct} ...');
});
it('changes only five explicit display expressions in the complete export function', () => {
  const source = readFileSync(resolve(process.cwd(), 'context/OSContext.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:context/OSContext.tsx'], { encoding: 'utf8' });
  const slice = (value: string) => value.slice(value.indexOf('const exportSystem ='), value.indexOf('const importSystem =')).replace(/\r/g, '');
  const replacements = [
    ["translateUi(loadUiLocale(), 'settings.exportOperation.init')", "'正在初始化打包引擎...'"],
    ["translateUi(loadUiLocale(), 'settings.exportOperation.store', { store: storeName })", '`正在打包: ${storeName} ...`'],
    ["translateUi(loadUiLocale(), 'settings.exportOperation.zip')", "'正在生成压缩包...'"],
    ["translateUi(loadUiLocale(), 'settings.exportOperation.compress', { pct: p.toFixed(0) })", '`正在压缩备份数据 ${p.toFixed(0)}%...`'],
    ["translateUi(loadUiLocale(), 'settings.exportOperation.damaged', { count: malformedImageCount })", '`备份已生成，但有 ${malformedImageCount} 处原本就损坏的图片无法打包；其他数据已正常保存`'],
  ];
  let actual = slice(source);
  expect(actual.length).toBeGreaterThan(10000);
  for (const [localized, original] of replacements) {
    if (!slice(baseline).includes(localized)) {
      expect(actual).toContain(localized);
      actual = actual.replace(localized, original);
    }
  }
  expect(actual).toBe(slice(baseline));
});
