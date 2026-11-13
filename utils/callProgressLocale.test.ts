const stripNoticeDisplay = (source: string): string => source
  .replace(/callNoticeText\(loadUiLocale\(\), ('(?:[^'\\]|\\.)*')\)/g, '$1')
  .replace(/import \{ callNoticeText \} from '\.\.\/utils\/callNoticeLocale';\r?\n/, '');
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { formatCallProgressText } from './callProgressLocale';
const cases: Array<[string,string]> = [
 ['正在打开 Live2D ZIP，请耐心等待…','Live2D ZIP'],
 ['正在检查 VRM 模型…','VRM'],
 ['正在保存 VRM 测试模型…','VRM'],
 ['正在写入本地模型库，请保持页面打开…','ライブラリ'],
 ['正在读取 model3、动作配置与 VTube Studio 热键…','VTube Studio'],
 ['已建立默认 2K 纹理（保留最多 4K 源图供切换），正在整理本地模型包…','4K'],
 ['已逐张生成默认 2K 纹理，正在写入低内存运行缓存…','2K'],
 ['已选择 012 个文件，正在扫描模型…','012'],
 ['正在读取模型配置 8 个…','8'],
 ['正在扫描 12 个文件和 VTube Studio 热键…','12'],
 ['正在低内存解包模型文件 6/18…','6/18'],
 ['正在流式读取 原名{count}$1.zip，不会把整个压缩包复制进内存…','原名{count}$1.zip'],
 ['贴图 作者{width}$1.png 为 8192×4096，正在直接生成 2048×1024 运行图…','作者{width}$1.png（8192×4096）から 2048×1024'],
 ['已找到 9 个表情/动作，正在整理本地模型包…','9'],
 ['已找到 10 个表情/动作，正在写入低内存运行缓存…','10'],
 ['正在整理 50 条对话...','50'],
 ['正在提取记忆 (2/7)...','2/7'],
 ['正在向量化 6 条记忆...','6'],
 ['记忆整理完成！新增 8 条记忆','8'],
 ['完成！新增 9 条记忆','9'],
 ['完成！新增 9 条记忆，2 条因重复跳过','重複 2 件'],
 ['角色{count}$1闭上眼睛，开始整理内心…','角色{count}$1'],
 ['聊天原文边界已同步','同期'],
 ['记忆整理完成，本段没有新增长期记忆','長期記憶'],
 ['正在审视记忆…','記憶'],
 ['正在整理门牌…','記憶'],
];
it.each(cases)('translates only the display of %s', (source, fragment)=>{
 const translated=formatCallProgressText('ja-JP',source);
 expect(translated).not.toBe(source);expect(translated).toContain(fragment);
 expect(formatCallProgressText('zh-CN',source)).toBe(source);
});
it('keeps unknown messages and near-matching errors intact',()=>{
 for(const source of ['constructor','__proto__','模型读取失败：Error GPU123','前缀正在整理 50 条对话...','正在整理 50 条对话... 错误','用户自写内容',''])expect(formatCallProgressText('ja-JP',source)).toBe(source);
});
it('preserves all call behavior and raw completion classification outside display substitutions',()=>{
 const file='apps/CallApp.tsx';let current=stripNoticeDisplay(readFileSync(file,'utf8')).replace(/\r/g,'');
 const original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}).replace(/\r/g,'');
 expect(current).toBe(original);
});
