import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';
it.each([
  ['sar', 'sarLocalState', 'SAR 存档'], ['theme', 'theme', '系统主题'], ['icons', 'customIcons', '应用图标'],
  ['appearance', 'appearancePresets', '外观预设'], ['social', 'socialAppData', '动态设置'], ['room', 'roomCustomAssets', '房间自定义素材'],
] as const)('keeps original asset category and passes explicit display key: %s', (key, field, label) => {
  const source = readFileSync(resolve(process.cwd(), 'context/OSContext.tsx'), 'utf8');
  expect(source).toContain(`restoreAssetsInPlace(data.${field}, '${label}', { key: 'settings.importAsset.${key}' })`);
  expect(translateUi('zh-CN', `settings.importAsset.${key}`)).toBe(label);
  expect(translateUi('ja-JP', `settings.importAsset.${key}`)).not.toBe(label);
});
it('threads asset display key through both before and after decoding progress without changing persistence', () => {
  const source = readFileSync(resolve(process.cwd(), 'context/OSContext.tsx'), 'utf8');
  const body = source.slice(source.indexOf('const restoreAssetsInPlace ='), source.indexOf("showImportProgress('database'", source.indexOf('const restoreAssetsInPlace =')));
  expect(body.match(/}, currentUi\);/g)).toHaveLength(2);
  expect(body).toContain('current: label');
  expect(body).not.toContain('markImportInProgress');
  expect(source).toContain('beforeWrite: restoreAssetsInPlace');
});
