import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { translateUi, type UiMessageKey, type UiMessageParams } from './uiLocale';
const source = readFileSync('apps/Chat.tsx', 'utf8').replace(/\r/g, '');
const original = execFileSync('git', ['show', 'HEAD:apps/Chat.tsx'], { encoding: 'utf8' }).replace(/\r/g, '');
it('changes only explicit display copy, never generation, state, messages or callbacks', () => {
  let restored = source.replace("import { useUiLocale } from '../context/UiLocaleContext';\n", '').replace('    const { t: uiT } = useUiLocale();\n', '');
  for (const key of ['recalling', 'local', 'degraded', 'skipped', 'submitting', 'accepted', 'sent']) restored = restored.replace(`uiT('chat.pending.${key}')`, `'${translateUi('zh-CN', `chat.pending.${key}` as UiMessageKey)}'`);
  restored = restored.replace("{uiT('chat.pending.inbox')}", '{inboxStatus}')
    .replace("{uiT('chat.pending.proactive', { name: char.name })}", '{char.name} 在给你写消息…')
    .replace("title={uiT('chat.pending.stop')}", 'title="停止本轮生成"')
    .replace("aria-label={uiT('chat.pending.stop')}", 'aria-label="停止本轮生成"');
  expect(restored).toBe(original);
});
const expression = (text: string) => text.match(/\{(visibleRecallSubmitStatus\.phase === 'recalling'[\s\S]*?)\}\s*<\/span>/)![1];
it.each([
  ['recalling', 'ok'], ['local', 'ok'], ['submitting', 'degraded'], ['submitting', 'skipped'], ['submitting', 'ok'], ['accepted', 'ok'], ['sent', 'ok'],
])('renders the actual pending bubble branch %s/%s in both languages', (phase, recall) => {
  const status = { phase, recall };
  const render = new Function('visibleRecallSubmitStatus', 'uiT', `return (${expression(source)});`);
  const old = new Function('visibleRecallSubmitStatus', `return (${expression(original)});`)(status);
  expect(render(status, (key: UiMessageKey, params?: UiMessageParams) => translateUi('zh-CN', key, params))).toBe(old);
  const ja = render(status, (key: UiMessageKey, params?: UiMessageParams) => translateUi('ja-JP', key, params));
  expect(ja).not.toBe(old);
  if (phase === 'accepted' || phase === 'sent') expect(ja).toContain('バックグラウンド');
  if (phase === 'local') expect(ja).toContain('SAR');
});
it('renames only the Japanese app label and keeps raw character names literal', () => {
  expect(translateUi('ja-JP', 'apps.Character')).toBe('キャラクター');
  expect(translateUi('zh-CN', 'apps.Character')).toBe('神经链接');
  expect(translateUi('ja-JP', 'chat.pending.proactive', { name: '原名{name}' })).toContain('原名{name}');
  expect(translateUi('ja-JP', 'chat.pending.inbox')).toContain('受信中');
});
