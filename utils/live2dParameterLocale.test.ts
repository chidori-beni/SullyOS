import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describeLive2DParameter, groupLive2DParameters } from './live2dParameterSemantics';
import { describeLocalizedLive2DParameter, formatLive2DParameterText, LIVE2D_PARAMETER_JA } from './live2dParameterLocale';
const ids=['ParamEyeLOpen','ParamEyeROpen','ParamEyeLSmile','ParamEyeRSmile','ParamEyeBallX','ParamEyeBallY','ParamBrowLY','ParamBrowRY','ParamBrowLAngle','ParamBrowRAngle','ParamBrowLForm','ParamBrowRForm','ParamMouthOpenY','ParamMouthForm','ParamCheek','ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ','ParamArmL','ParamArmR','ParamArm','ParamBreath','Hair','Ribbon','Accessory','Physics','Opacity','Alpha','Display','Effect','xin','yin','zin','xinb','yinb','zinb','作者独自参数',''];
it.each(ids)('localizes display fields while retaining semantic area and original ID: %s',id=>{
 const source=describeLive2DParameter(id);
 const zh=describeLocalizedLive2DParameter(id,'zh-CN');
 expect(zh).toEqual(source);
 expect(zh).not.toBe(source);
 const ja=describeLocalizedLive2DParameter(id,'ja-JP');
 expect(ja.area).toBe(source.area);
 for(const field of ['areaLabel','description','negativeLabel','positiveLabel'] as const){
  expect(LIVE2D_PARAMETER_JA).toHaveProperty(source[field]);
  expect(ja[field]).toBe(LIVE2D_PARAMETER_JA[source[field]]);
 }
 if(source.area==='other'&&id.trim()) expect(ja.label).toBe(id.trim());
 else {expect(LIVE2D_PARAMETER_JA).toHaveProperty(source.label);expect(ja.label).toBe(LIVE2D_PARAMETER_JA[source.label]);}
 expect(describeLive2DParameter(id)).toEqual(source);
});
it('keeps unknown Chinese names exact even when matching a translated UI label',()=>{
 for(const id of ['眼睛','未命名参数','控制模型的呼吸循环幅度。','  私のモデル{name}  ']) expect(describeLocalizedLive2DParameter(id,'ja-JP').label).toBe(id.trim());
 expect(describeLocalizedLive2DParameter('ParamEyeLOpen','ja-JP').label).toBe('左目の開閉');
 expect(describeLocalizedLive2DParameter('ParamEyeROpen','ja-JP').label).toBe('右目の開閉');
});
it('leaves group order, membership, identity and stable area values intact',()=>{
 const input=ids.map((id,index)=>({id,min:-index,max:index,value:0}));
 const groups=groupLive2DParameters(input);
 for(const group of groups){expect(LIVE2D_PARAMETER_JA).toHaveProperty(group.label);expect(formatLive2DParameterText('zh-CN',group.label)).toBe(group.label);for(const item of group.parameters)expect(input).toContain(item);}
 expect(groupLive2DParameters(input)).toEqual(groups);
});
it('wires display-only semantics into every existing panel access, preserving handlers',()=>{
 const file='components/call/Live2DActionSettings.tsx';
 const source=readFileSync(file,'utf8').replace(/\r/g,'');
 const baseline=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}).replace(/\r/g,'');
 expect(source).toContain('const describeLive2DParameter = (id: string) => describeLocalizedLive2DParameter(id, locale)');
 expect(source).toContain('label={formatLive2DParameterText(locale, group.label)}');
 const collect=(text:string)=>{const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),out:string[]=[];const visit=(n:ts.Node)=>{if(ts.isJsxAttribute(n)&&(/^on[A-Z]/.test(n.name.getText(sf))||['key','value','disabled','min','max','step'].includes(n.name.getText(sf))))out.push(n.getText(sf));ts.forEachChild(n,visit);};visit(sf);return out;};
 expect(collect(source)).toEqual(collect(baseline));
});
