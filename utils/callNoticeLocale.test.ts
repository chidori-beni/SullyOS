import { expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { callNoticeText, CALL_NOTICE_JA } from './callNoticeLocale';
it.each(Object.entries(CALL_NOTICE_JA))('translates built-in notice %s while keeping Chinese exact', (source,ja)=>{
 expect(callNoticeText('ja-JP',source)).toBe(ja);
 expect(callNoticeText('zh-CN',source)).toBe(source);
 expect(ja.trim().length).toBeGreaterThan(0);
});
it('preserves unknown text and raw errors',()=>{
 for(const text of ['constructor','__proto__','Error: HTTP 403','模型未知错误','原角色{name}']) expect(callNoticeText('ja-JP',text)).toBe(text);
});
it('wraps explicit built-in literals only and preserves every other source byte apart from line endings',()=>{
 const file='apps/CallApp.tsx';const source=readFileSync(file,'utf8').replace(/\r/g,'');
 const original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'}).replace(/\r/g,'');
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let count=0;
 const visit=(n:ts.Node)=>{
  if(ts.isCallExpression(n)&&n.expression.getText(sf)==='callNoticeText'){
   expect(n.arguments[0].getText(sf)).toBe('loadUiLocale()');
   expect(ts.isStringLiteral(n.arguments[1])).toBe(true);
   expect(CALL_NOTICE_JA).toHaveProperty((n.arguments[1] as ts.StringLiteral).text);count++;
  }
  ts.forEachChild(n,visit);
 };visit(sf);expect(count).toBe(79);
 const restored=source.replace(/callNoticeText\(loadUiLocale\(\), ('(?:[^'\\]|\\.)*')\)/g,'$1').replace("import { callNoticeText } from '../utils/callNoticeLocale';\n",'');
 expect(restored).toBe(original);
 expect(source).toContain("setErrorMessage(error?.message || callNoticeText(loadUiLocale(), '语音生成失败'))");
 expect(source).toContain("addToast(inspection.reason, 'error')");
});
