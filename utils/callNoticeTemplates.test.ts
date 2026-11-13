import { expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CALL_NOTICE_TEMPLATES, callNoticeTemplate } from './callNoticeTemplates';
const parts=(values:readonly string[])=>Object.assign([...values],{raw:[...values]}) as unknown as TemplateStringsArray;
it.each(CALL_NOTICE_TEMPLATES.map((entry,index)=>[index,entry] as const))('localizes template %s and preserves every inserted value literally',(_, [source,ja])=>{
 const values=source.slice(1).map((_,i)=>`原名${i}{name}$1\n错误：HTTP 403`);
 const join=(segments:readonly string[])=>segments.reduce((text,part,i)=>text+(i?values[i-1]:'')+part,'');
 expect(source.length).toBe(ja.length);
 expect(callNoticeTemplate('zh-CN')(parts(source),...values)).toBe(join(source));
 expect(callNoticeTemplate('ja-JP')(parts(source),...values)).toBe(join(ja));
 for(const value of values)expect(callNoticeTemplate('ja-JP')(parts(source),...values)).toContain(value);
});
it('does not recognize templates by interpolated text; preserves unknown templates and numeric zero',()=>{
 expect(callNoticeTemplate('ja-JP')`未知模板${'语音生成失败：'}末尾`).toBe('未知模板语音生成失败：末尾');
 expect(callNoticeTemplate('ja-JP')`已保存：衣橱 ${0} 套 · AI 可用 ${12} 个动作`).toBe('保存しました：衣装 0 セット · AI 使用可のモーション 12 個');
 expect(callNoticeTemplate('ja-JP')`语音生成失败：${'原始报错：$1{name}\nHTTP 403'}`).toBe('音声の生成に失敗しました：原始报错：$1{name}\nHTTP 403');
});
it('covers exactly the authored call templates and leaves all expressions and behavior unchanged',()=>{
 const file='apps/CallApp.tsx',source=readFileSync(file,'utf8').replace(/\r/g,'');
 const original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}).replace(/\r/g,'');
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let count=0;
 const visit=(n:ts.Node)=>{
  if(ts.isTaggedTemplateExpression(n)&&n.tag.getText(sf)==='callNoticeTemplate(loadUiLocale())'){
   expect(ts.isTemplateExpression(n.template)).toBe(true);
   const template=n.template as ts.TemplateExpression;
   const authored=[template.head.text,...template.templateSpans.map(span=>span.literal.text)];
   expect(CALL_NOTICE_TEMPLATES.some(([segments])=>JSON.stringify(segments)===JSON.stringify(authored))).toBe(true);count++;
  }ts.forEachChild(n,visit);
 };visit(sf);expect(count).toBe(12);
 const restored=source.replace(/callNoticeTemplate\(loadUiLocale\(\)\)/g,'').replace(/callNoticeText\(loadUiLocale\(\), ('(?:未知错误|对方)')\)/g,'$1').replace("import { callNoticeTemplate } from '../utils/callNoticeTemplates';\n",'');
 expect(restored).toBe(original);
});
