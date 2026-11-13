import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Warning from '../components/call/VRoidBetaWarning';
import { formatCallStageText, CALL_STAGE_JA } from './callStageLocale';
const state = vi.hoisted(() => ({ locale: 'zh-CN' as 'zh-CN' | 'ja-JP' }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => state }));
it.each(['zh-CN', 'ja-JP'] as const)('renders project/model and busy/idle warning branches in %s', locale => {
 state.locale = locale;
 const action = vi.fn();
 for (const projectFile of [false, true]) for (const busy of [false, true]) {
  const html = renderToStaticMarkup(React.createElement(Warning, { fileName: '原模型{name}.vroid', projectFile, busy, onCancel: action, onContinue: action }));
  expect(html).toContain('原模型{name}.vroid');
  expect(html).toContain('role="dialog"');
  expect(html).toContain(formatCallStageText(locale, projectFile ? '这是 VRoid 工程文件' : '导入功能仍在测试中'));
  expect(html).toContain(formatCallStageText(locale, projectFile ? '我知道了' : '暂不导入'));
  if (projectFile) { expect(html).toContain('VRoid Studio'); expect(html).not.toContain(formatCallStageText(locale, '仍要测试')); }
  else expect(html).toContain(formatCallStageText(locale, busy ? '正在导入…' : '仍要测试'));
  expect(html.includes('disabled=""')).toBe(busy);
 }
 expect(action).not.toHaveBeenCalled();
});
it('preserves warning handlers, keyboard effect, conditions and disabled gates', () => {
 const file = 'components/call/VRoidBetaWarning.tsx';
 const current = readFileSync(file, 'utf8').replace(/\r/g, '');
 const original = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }).replace(/\r/g, '');
 const collect = (text: string) => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: string[] = [];
  const visit = (n: ts.Node) => {
   if (ts.isJsxAttribute(n) && (/^on[A-Z]/.test(n.name.getText(sf)) || ['disabled','role','tabIndex','aria-modal','aria-labelledby'].includes(n.name.getText(sf)))) result.push(n.getText(sf));
   if (ts.isCallExpression(n) && n.expression.getText(sf) === 'useEffect') result.push(n.getText(sf));
   ts.forEachChild(n, visit);
  }; visit(sf); return result;
 };
 expect(collect(current)).toEqual(collect(original));
});
it('covers every fixed Live2D progress message without changing renderer callbacks', () => {
 const source = readFileSync('components/call/Live2DAvatarCanvas.tsx', 'utf8');
 const messages = [...source.matchAll(/onLoadingChangeRef.current\?\.\(true, '([^']+)'\)/g)].map(m => m[1]);
 expect(messages.length).toBe(6);
 for (const message of messages) {
  expect(CALL_STAGE_JA).toHaveProperty(message);
  expect(formatCallStageText('ja-JP', message)).not.toBe(message);
  expect(formatCallStageText('zh-CN', message)).toBe(message);
 }
});
