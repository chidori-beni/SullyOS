import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { formatCallProgressText } from './callProgressLocale';
import { formatCallStageText } from './callStageLocale';
import { formatLive2DActionText } from './live2dActionLocale';
const cases: Array<[string,string]> = [
 ['正在从内置缓存恢复 Sully…','内蔵キャッシュ'],
 ['正在读取免解压模型包…','展開不要'],
 ['首次优化旧模型：正在低内存解包并建立运行缓存…','旧モデルの初回最適化'],
 ['角色已就绪','準備ができました'],
 ...(['高清','轻量'] as const).flatMap(quality=>{
  const full=quality==='高清'?'高清 4K':'轻量 2K',ja=quality==='高清'?'高画質':'軽量';
  return [
   [`正在读取 Sully 内置${quality}模型…`,ja],
   [`正在从内存缓存恢复${full}模型…`,ja],
   [`正在读取已优化的${full}运行缓存…`,ja],
   [`正在读取${full}运行缓存…`,ja],
   [`正在从源包逐张生成${full}运行纹理…`,ja],
   [`Sully 内置${quality}模型就绪`,ja],
  ] as Array<[string,string]>;
 }),
 ['Sully 预热完成：清单 0ms，贴图 1.2s','一覧 0ms、テクスチャ 1.2s'],
 ['模型预热完成：包 999ms，贴图 10.0s','データ 999ms、テクスチャ 10.0s'],
 ['缓存就绪：模型包 1.0s，贴图 2ms','モデルデータ 1.0s、テクスチャ 2ms'],
 ['首次优化模型：正在低内存解包模型文件 6/18…','モデルの初回最適化：省メモリでモデルファイルを展開中 6/18…'],
 ['首次优化模型：贴图 原图{count}$1.png 为 8192×4096，正在直接生成 2048×1024 运行图…','原图{count}$1.png（8192×4096）から 2048×1024'],
];
it.each(cases)('shares cache progress display across import, stage and advanced tools: %s',(source,fragment)=>{
 const ja=formatCallProgressText('ja-JP',source);
 expect(ja).not.toBe(source);expect(ja).toContain(fragment);
 for(const display of [formatCallProgressText,formatCallStageText,formatLive2DActionText]){
  expect(display('zh-CN',source)).toBe(source);
  expect(display('ja-JP',source)).toBe(ja);
 }
});
it('preserves unknown progress, errors and nested/near-matching prefixes exactly',()=>{
 for(const source of ['constructor','__proto__','首次优化模型：HTTP 403\n原文','首次优化模型：首次优化模型：正在读取免解压模型包…','Sully 预热完成：清单 未知，贴图 3ms','前缀缓存就绪：模型包 1ms，贴图 2ms']){
  expect(formatCallProgressText('ja-JP',source)).toBe(source);
  expect(formatCallStageText('ja-JP',source)).toBe(source);
 }
});
it('leaves resource loading, caching, model quality, progress producers and UI handlers unchanged',()=>{
 for(const file of ['utils/live2dModelStore.ts','components/call/Live2DAvatarCanvas.tsx','components/call/VRMVideoCallStage.tsx','components/call/Live2DActionSettings.tsx','apps/CallApp.tsx']){
  const current=readFileSync(file,'utf8').replace(/\r/g,'');
  const original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}).replace(/\r/g,'');
  expect(current).toBe(original);
 }
});
