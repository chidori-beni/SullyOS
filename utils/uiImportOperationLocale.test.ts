import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';
it.each([0, 1, 100])('preserves import counts: %s', done => {
  expect(translateUi('zh-CN', 'settings.importOperation.items', { done, total: 100 })).toBe(`条目：${done}/100`);
  expect(translateUi('ja-JP', 'settings.importOperation.items', { done, total: 100 })).toBe(`件数：${done}/100`);
});
it('keeps filenames, sizes and raw current labels literal', () => {
  expect(translateUi('ja-JP', 'settings.importOperation.file', { file: 'raw{done}.zip', size: ' · 3 MB' })).toBe('現在のファイル：raw{done}.zip · 3 MB');
  expect(translateUi('ja-JP', 'settings.importOperation.current', { current: '分片 memory_vectors' })).toBe('現在の項目：分片 memory_vectors');
});
it('keeps complete import logic, phase persistence and exceptions unchanged beyond explicit copy', () => {
  const source = readFileSync(resolve(process.cwd(), 'context/OSContext.tsx'), 'utf8');
  const baseline = execFileSync('git', ['show', 'HEAD:context/OSContext.tsx'], { encoding: 'utf8' });
  const slice = (value: string) => value.slice(value.indexOf('const importSystem ='), value.indexOf('把这台设备和它名下的云端数据一起归零')).replace(/\r/g, '');
  let actual = slice(source);
  const baselineSlice = slice(baseline);
  if (!baselineSlice.includes("currentUi?: UiStatusMessage): Promise<void>")) {
    actual = actual.replace("label = '数据', currentUi?: UiStatusMessage", "label = '数据'")
      .split('}, currentUi);').join('});');
    for (const key of ['sar', 'theme', 'icons', 'appearance', 'social', 'room']) actual = actual.replace(`, { key: 'settings.importAsset.${key}' }`, '');
  }
  if (!baselineSlice.includes('let lastCurrentUi:')) actual = actual
    .replace('      let lastCurrentUi: UiStatusMessage | undefined;\n', '')
    .replace("{ current: lastCurrentUi ? translateUi(loadUiLocale(), lastCurrentUi.key, lastCurrentUi.params) : current }", '{ current }')
    .replace('update: ImportProgressUpdate = {},\n          currentUi?: UiStatusMessage', 'update: ImportProgressUpdate = {}')
    .replace('if (update.current !== undefined) { lastCurrent = update.current; lastCurrentUi = currentUi; }', 'if (update.current !== undefined) lastCurrent = update.current;')
    .replace(", { key: 'settings.importCurrent.parsing' }", '')
    .replace(", { key: 'settings.importCurrent.shard', params: { field } }", '')
    .replace(", { key: 'settings.importCurrent.database' }", '')
    .replace(", { key: 'settings.importCurrent.collaboration' }", '')
    .replace(", { key: 'settings.importCurrent.settings' }", '');
  const pairs = [
    ["translateUi(loadUiLocale(), 'settings.importOperation.current', { current })", '`当前部分：${current}`'],
    ["translateUi(loadUiLocale(), 'settings.importOperation.items', { done: update.itemDone || 0, total: update.itemTotal })", '`条目：${update.itemDone || 0}/${update.itemTotal}`'],
    ["translateUi(loadUiLocale(), 'settings.importOperation.file', { file: currentFile, size: sizeText ? ` · ${sizeText}` : '' })", "`当前文件：${currentFile}${sizeText ? ` · ${sizeText}` : ''}`"],
    ["translateUi(loadUiLocale(), 'settings.importOperation.backup', { name: sourceName, size: sizeText ? ` · ${sizeText}` : '' })", "`备份：${sourceName}${sizeText ? ` · ${sizeText}` : ''}`"],
    ...[
      ['parsing', '正在解析备份文件...'], ['shards', '正在解析备份分片...'], ['assets', '正在恢复素材...'],
      ['database', '正在写入数据库...'], ['collaboration', '正在恢复协同工作...'], ['settings', '正在恢复系统设置...'], ['done', '恢复成功，系统即将重启...'],
    ].map(([key, text]) => [`translateUi(loadUiLocale(), 'settings.importOperation.${key}')`, `'${text}'`]),
  ];
  expect(actual.length).toBeGreaterThan(10000);
  for (const [localized, original] of pairs) if (!slice(baseline).includes(localized)) {
    if (localized === "translateUi(loadUiLocale(), 'settings.importOperation.current', { current })" && baselineSlice.includes('lastCurrentUi ? translateUi')) continue;
    expect(actual).toContain(localized);
    actual = actual.split(localized).join(original);
  }
  expect(actual).toBe(slice(baseline));
});
