import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Stage from '../components/call/VRMVideoCallStage';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CALL_STAGE_JA, formatCallStageText } from './callStageLocale';
it('keeps Chinese exact and unknown progress/errors untouched in both languages', () => {
 for (const [source, translated] of Object.entries(CALL_STAGE_JA)) {
  expect(formatCallStageText('zh-CN', source)).toBe(source);
  expect(formatCallStageText('ja-JP', source)).toBe(translated);
  expect(translated.length).toBeGreaterThan(0);
 }
 for (const raw of ['GPU error: 0x123', '读取贴图 3/8', '自定义动作{name}']) {
  expect(formatCallStageText('ja-JP', raw)).toBe(raw);
 }
});
it('preserves event handlers, model gates, stable values and render callbacks', () => {
 const file = 'components/call/VRMVideoCallStage.tsx';
 const current = readFileSync(file, 'utf8').replace(/\r/g, '');
 const original = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }).replace(/\r/g, '');
 const collect = (text: string) => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: string[] = [];
  const visit = (n: ts.Node) => {
   if (ts.isJsxAttribute(n) && (/^on[A-Z]/.test(n.name.getText(sf)) || ['key', 'disabled', 'value', 'data-live2d-manual-action'].includes(n.name.getText(sf)))) result.push(n.getText(sf).replace(/\r/g, ''));
   if (ts.isJsxExpression(n) && n.expression && ts.isBinaryExpression(n.expression) && n.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) result.push(n.expression.left.getText(sf));
   ts.forEachChild(n, visit);
  }; visit(sf); return result;
 };
 expect(collect(current)).toEqual(collect(original));
 // Loading/error classification must not depend on the translated display text.
 expect(current.slice(current.indexOf('const canAdjustFraming'), current.indexOf('surfaceLabel='))).toBe(original.slice(original.indexOf('const canAdjustFraming'), original.indexOf('surfaceLabel=')));
 expect(current).toContain('{stageText(modelLoadingStage)}');
 expect(current).toContain('{stageText(stateLabel(motionState))}');
 expect(current).toContain('{action.name}');
 expect(current).toContain('{modelError}');
 const sf = ts.createSourceFile(file, current, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
 const visit = (n: ts.Node) => {
  if (ts.isCallExpression(n) && n.expression.getText(sf) === 'stageText' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) expect(CALL_STAGE_JA).toHaveProperty(n.arguments[0].text);
  ts.forEachChild(n, visit);
 }; visit(sf);
});

const state = vi.hoisted(() => ({ locale: 'ja-JP' }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => state }));
vi.mock('../components/call/VRMAvatarCanvas', () => ({ default: () => null }));
vi.mock('../components/call/Live2DAvatarCanvas', () => ({ default: () => null }));
vi.mock('../components/os/StaticCompanionPortrait', () => ({ default: () => null, buildPortraitTouchHit: () => null }));
it.each(['zh-CN', 'ja-JP'] as const)('renders model setup and status in %s without invoking import', locale => {
 state.locale = locale;
 const choose = vi.fn();
 const html = renderToStaticMarkup(React.createElement(Stage, { characterName: '原角色{name}', motionState: 'thinking', accentColor: '#123456', onChooseModel: choose, onChooseLive2DFolder: choose }));
 expect(html).toContain(formatCallStageText(locale, '给这个角色装上视频模型'));
 expect(html).toContain(formatCallStageText(locale, 'L2D 整个文件夹'));
 expect(html).toContain(formatCallStageText(locale, '正在想'));
 expect(html).toContain('model3.json');
 expect(choose).not.toHaveBeenCalled();
});
