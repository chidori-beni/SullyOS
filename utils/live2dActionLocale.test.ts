import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Settings from '../components/call/Live2DActionSettings';
import { formatLive2DActionText, LIVE2D_ACTION_JA } from './live2dActionLocale';
const state = vi.hoisted(() => ({ locale: 'ja-JP' as 'ja-JP' | 'zh-CN' }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => state }));
vi.mock('../components/call/Live2DAvatarCanvas', () => ({ default: () => null }));
it('preserves Chinese, unknown model text, interpolation values and shared loading progress', () => {
 for(const key of Object.keys(LIVE2D_ACTION_JA)) expect(formatLive2DActionText('zh-CN',key)).toBe(key);
 expect(formatLive2DActionText('ja-JP','预览 {name}',{name:'原名{count}'})).toBe('原名{count} をプレビュー');
 expect(formatLive2DActionText('ja-JP','读取错误 GPU123')).toBe('读取错误 GPU123');
 expect(formatLive2DActionText('ja-JP','正在解码 Live2D 贴图…')).toBe('Live2D テクスチャをデコード中…');
});
it.each(['import','advanced'] as const)('renders action permissions and language in %s mode', setupMode => {
 const onSave=vi.fn(),onClose=vi.fn();
 const config={format:'live2d',assetId:'locale-fixture',fileName:'原模型.model3.json',actions:[{id:'original-action',kind:'motion',name:'原动作{count}',group:'原组',index:0,tags:[],permission:'ai',wardrobe:true}]} as React.ComponentProps<typeof Settings>['config'];
 for(const locale of ['zh-CN','ja-JP'] as const) {
  state.locale=locale;
  const html=renderToStaticMarkup(React.createElement(Settings,{config,characterName:'原角色{name}',accentColor:'#123456',setupMode,onSave,onClose}));
  expect(html).toContain('原角色{name}');expect(html).toContain('原动作{count}');
  expect(html).toContain(formatLive2DActionText(locale,'已加入真·衣橱'));
  expect(html).toContain(formatLive2DActionText(locale,'镜头构图'));
  expect(html).toMatch(/data-live2d-permission="ai"[^>]*disabled=""/);
  expect(html).toContain(formatLive2DActionText(locale,'正在准备预览…'));
  expect(html).toContain(formatLive2DActionText(locale,setupMode==='import'?'保存并完成导入':'保存权限'));
 }
 expect(onSave).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
 expect(config.actions[0].permission).toBe('ai');
});
it('keeps every handler, stable input value, permission gate, and pre-render logic unchanged',()=>{
 const file='components/call/Live2DActionSettings.tsx';
 const current=readFileSync(file,'utf8').replace(/\r/g,'');
 const original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}).replace(/\r/g,'');
 const collect=(source:string)=>{const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),values:string[]=[];
 const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&(/^on[A-Z]/.test(n.name.getText(sf))||['value','disabled','checked','min','max','step','key','data-live2d-permission','data-live2d-action-id'].includes(n.name.getText(sf))))values.push(n.getText(sf));ts.forEachChild(n,visit);};visit(sf);return values;};
 expect(collect(current)).toEqual(collect(original));
 const logic=(s:string)=>s.slice(s.indexOf('  const defaultFraming'),s.indexOf('  return (\n    <div className="absolute inset-0'));
 expect(logic(current)).toBe(logic(original));
 const sf=ts.createSourceFile(file,current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(sf)==='actionText'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))expect(LIVE2D_ACTION_JA).toHaveProperty(n.arguments[0].text);ts.forEachChild(n,visit);};visit(sf);
});
