import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { UI_MESSAGES, translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import SleepCompanionSheet from '../components/call/SleepCompanionSheet';
import CallPreferencesSheet from '../components/call/CallPreferencesSheet';
import { DEFAULT_CALL_PREFERENCES } from './callPreferences';
const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params) }) }));
vi.mock('@phosphor-icons/react', () => Object.fromEntries('Moon X ChatCircleDots Gear Phone SpeakerHigh'.split(' ').map(name => [name, () => null])));
const files = ['apps/CallApp.tsx', 'components/call/IncomingCallOverlay.tsx', 'components/call/SleepCompanionSheet.tsx', 'components/call/CallPreferencesSheet.tsx'];
it.each(['zh-CN', 'ja-JP'] as const)('renders sleep presets and preferences in %s without invoking controls', locale => {
  state.locale = locale;
  const change = vi.fn(), toggle = vi.fn(), close = vi.fn();
  const props = { charName: '角色原名{name}', sleepMode: true, autoHangupMinutes: 45, accentColor: '#123456', lightTheme: false, onChangeAutoHangup: change, onToggleSleep: toggle, onClose: close };
  const sleep = renderToStaticMarkup(React.createElement(SleepCompanionSheet, props));
  expect(sleep).toContain('角色原名{name}');
  expect(sleep).toContain('value="45"');
  expect(sleep).toContain(translateUi(locale, 'call.main.sleepActive'));
  for (const count of [1, 2, 8]) expect(sleep).toContain(translateUi(locale, 'call.main.hours', { count }));
  expect(sleep).toContain(translateUi(locale, 'call.main.noAuto'));
  const preferences = renderToStaticMarkup(React.createElement(CallPreferencesSheet, { preferences: DEFAULT_CALL_PREFERENCES, accentColor: '#123456', lightTheme: true, onChange: change, onOpenSystemSettings: toggle, onClose: close }));
  for (const key of ['first', 'autoplay', 'silence', 'dream', 'preferencesHelp', 'autoplayHelp'] as const) expect(preferences).toContain(translateUi(locale, `call.main.${key}`));
  expect(preferences).toContain('role="switch"');
  expect(change).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it('keeps every event, stable mode/input value and disabled gate identical to remote', () => {
  for (const path of files) {
    const source = readFileSync(path, 'utf8'), original = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' });
    const attrs = (text: string) => {
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && (/^on[A-Z]/.test(node.name.getText(sf)) || ['value', 'disabled', 'checked', 'aria-checked', 'data-testid', 'type', 'min', 'max'].includes(node.name.getText(sf)))) result.push(node.getText(sf).replace(/\r/g, ''));
        ts.forEachChild(node, visit);
      }; visit(sf); return result;
    }; expect(attrs(source)).toEqual(attrs(original));
    const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 'uiT' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text as UiMessageKey;
        expect(UI_MESSAGES['zh-CN'][key]).toBeDefined(); expect(UI_MESSAGES['ja-JP'][key]).toBeDefined();
      } ts.forEachChild(node, visit);
    }; visit(sf);
  }
});
it('keeps missed-call persistence and incoming lifecycle unchanged', () => {
  const path = files[1], source = readFileSync(path, 'utf8'), original = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' });
  const persisted = (s: string) => s.slice(s.indexOf('export const persistMissedCall')).replace(/\r/g, '');
  expect(persisted(source)).toBe(persisted(original));
  const lifecycle = (s: string) => s.slice(s.indexOf('const { openApp, characters }'), s.indexOf('if (!call) return null;')).replace(/\r/g, '');
  expect(lifecycle(source)).toBe(lifecycle(original));
});
it('does not translate role prompts or call-generation/hangup logic', () => {
  const source = readFileSync(files[0], 'utf8'), original = execFileSync('git', ['show', `HEAD:${files[0]}`], { encoding: 'utf8' });
  const prefix = (s: string) => s.slice(0, s.indexOf('  const avatarImportOverlay =')).replace(/\r/g, '').replace("import { useUiLocale } from '../context/UiLocaleContext';\n", '').replace("import { formatCallDetailText } from '../utils/callDetailLocale';\n", '').replace('  const { t: uiT } = useUiLocale();\n', '').replace(/  const audioRouteUiLabel =[^\n]+\n/, '');
  // All lifecycle and prompt code lives before the UI views; only a pure route display binding was added.
  expect(prefix(source)).toBe(prefix(original));
  expect(translateUi('ja-JP', 'call.main.sayTo', { name: '原名{name}' })).toContain('原名{name}');
});
