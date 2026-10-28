import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import { describeNaturalLastCheck, type AmsgNaturalLastCheck } from './amsgFirePack';
import { formatNaturalError, formatNaturalLastCheck, formatNaturalReason } from './naturalProactiveLocale';
import Panel from '../components/chat/ProactiveSettingsModal';
const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ locale: state.locale, t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params) }) }));
vi.mock('./activeMsgClient', () => ({ ActiveMsgClient: { readNaturalLastCheck: vi.fn() } }));
const t = (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params);
it.each(['zh-CN', 'ja-JP'] as const)('renders enabled and disabled panel without invoking actions in %s', locale => {
  state.locale = locale;
  const action = vi.fn();
  for (const enabled of [false, true]) {
    const char = { id: 'test', name: '萧逸{name}', naturalProactiveConfig: { enabled, intensity: 'normal', bias: 0, profile: { archetype: '原始画像', summary: '原始模型说明{time}', derivedAt: 123456 } } } as unknown as React.ComponentProps<typeof Panel>['char'];
    const html = renderToStaticMarkup(React.createElement(Panel, { isOpen: true, char, isNaturalActive: enabled, onClose: action, onSave: action, onStop: action }));
    expect(html).toContain(t('natural.title'));
    expect(html).toContain('萧逸{name}');
    if (enabled) {
      expect(html).toContain(t('natural.note'));
      expect(html).toContain(t('natural.normalHint'));
      expect(html).toContain('原始模型说明{time}');
      expect(html).toContain('原始画像');
    }
  }
  expect(action).not.toHaveBeenCalled();
});
it('keeps every Chinese last-check branch identical and translates Japanese without changing data', () => {
  const check: AmsgNaturalLastCheck = { v: 1, checkedAt: 1, nextCheckAt: 2, score: 0.3, threshold: 0.5, sent: false, skipReason: null, reasons: ['沉默 6.3 小时'] };
  for (const sent of [false, true]) for (const skipReason of [null, 'low-score', 'active-chat-presence', 'active-date-presence', 'asleep', 'unanswered-limit'] as const) for (const nextCheckAt of [0, 2]) {
    const value = { ...check, sent, skipReason, nextCheckAt }, original = JSON.stringify(value);
    state.locale = 'zh-CN';
    expect(formatNaturalLastCheck(t, value, String)).toBe(describeNaturalLastCheck(value, String));
    state.locale = 'ja-JP';
    expect(formatNaturalLastCheck(t, value, String)).not.toMatch(/ta|下次|没有|想联系/);
    expect(JSON.stringify(value)).toBe(original);
  }
});
it('translates known scoring reasons only, preserving unknown/model text and Chinese', () => {
  const reasons = ['沉默 6.3 小时', '已有 20 条未获回复', '日程里正在睡觉（已睡约 1.5 小时，还剩约 3.0 小时）', '亲密关系加权', '亲近关系加权', '异地/手机联系加权', '安静时段', '刚主动联系过', '近期主动联系过'];
  for (const reason of reasons) {
    state.locale = 'zh-CN'; expect(formatNaturalReason(t, reason)).toBe(reason);
    state.locale = 'ja-JP'; expect(formatNaturalReason(t, reason)).not.toBe(reason);
  }
  for (const raw of ['__proto__', 'constructor', '原始模型内容{count}']) expect(formatNaturalReason(t, raw)).toBe(raw);
});
it('preserves panel handlers, stable config values and effect/save/stop logic', () => {
  const file = 'components/chat/ProactiveSettingsModal.tsx';
  const actual = readFileSync(file, 'utf8'), original = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' });
  const attrs = (text: string) => {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result: string[] = [];
    const visit = (node: ts.Node) => {
      // The new display-only retry button is not one of the original config controls.
      if (ts.isJsxOpeningElement(node) && node.getText(sf).includes('onClick={display.retry}')) return;
      if (ts.isJsxAttribute(node) && (/^on[A-Z]/.test(node.name.getText(sf)) || ['disabled', 'value', 'min', 'max', 'step'].includes(node.name.getText(sf)))) result.push(node.getText(sf)); ts.forEachChild(node, visit);
    }; visit(sf); return result;
  };
  expect(attrs(actual)).toEqual(attrs(original));
  const logic = (text: string) => text.slice(text.indexOf('  const [enabled,'), text.indexOf('  const profile =')).replace(/\r/g, '');
  expect(logic(actual)).toBe(logic(original));
  expect(execFileSync('git', ['diff', '--', 'utils/naturalProactive.ts', 'utils/amsgFirePack.ts', 'worker'], { encoding: 'utf8' })).toBe('');
});

it('localizes only known error displays, keeping unknown errors verbatim', () => {
  const known = ['云端 Worker 还不是支持自然主动的新版本。请先按我稍后给你的步骤重新部署 Worker。', '还有 3 个旧的自然主动检查没有取消成功。为防止重复发消息，这次没有重新安排；请稍后重试。'];
  for (const message of known) {
    state.locale = 'zh-CN'; expect(formatNaturalError(t, message)).toBe(message);
    state.locale = 'ja-JP'; expect(formatNaturalError(t, message)).not.toBe(message);
  }
  expect(formatNaturalError(t, 'HTTP 403: 原始错误{message}')).toBe('HTTP 403: 原始错误{message}');
});
