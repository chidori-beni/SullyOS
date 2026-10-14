import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { translateUi, UI_MESSAGES, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import ChatHeader from '../components/chat/ChatHeaderShell';
import ChatInputArea from '../components/chat/ChatInputArea';

const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params) }) }));
vi.mock('@phosphor-icons/react', () => Object.fromEntries('CaretLeft ShareNetwork Trash Plus Smiley PaperPlaneTilt Money BookOpenText GearSix Image Lock ArrowsClockwise ChatCircleDots CalendarBlank ForkKnife Coffee Code Brain Heartbeat PencilSimple Alarm Sparkle FadersHorizontal LinkSimple Star Waveform Lightning Stop CornersOut CornersIn Briefcase'.split(' ').map(name => [name, () => null])));
vi.mock('../components/chat/ChatCamera', () => ({ default: () => null }));
vi.mock('../components/chat/EmojiExportDialog', () => ({ default: () => null }));
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('../components/os/acnhIcons', () => ({ AcnhActionTile: () => null }));
vi.mock('./useEmojiThumbnailCache', () => ({ useEmojiThumbnailCache: (visible: unknown[]) => visible }));
const raw = { id: 'raw-id', name: '角色原名{count}', avatar: 'raw-avatar', activeBuffs: [] } as React.ComponentProps<typeof ChatHeader>['activeCharacter'];
const headerProps: React.ComponentProps<typeof ChatHeader> = { selectionMode: false, selectedCount: 3, onCancelSelection: vi.fn(), activeCharacter: raw, isTyping: false, isSummarizing: false, isEmotionEvaluating: true, lastTokenUsage: null, onClose: vi.fn(), onTriggerAI: vi.fn(), onShowCharsPanel: vi.fn() };
const inputProps: React.ComponentProps<typeof ChatInputArea> = { input: '我的消息{count}', setInput: vi.fn(), isTyping: false, selectionMode: false, showPanel: 'none', setShowPanel: vi.fn(), onSend: vi.fn(), onDeleteSelected: vi.fn(), selectedCount: 3, emojis: [], onPanelAction: vi.fn(), onImageSelect: vi.fn(), isSummarizing: false, onReroll: vi.fn(), canReroll: true, onOpenVoiceInput: vi.fn(), showSendButton: true, characters: [raw] as unknown as NonNullable<React.ComponentProps<typeof ChatInputArea>['characters']> };

it.each(['zh-CN', 'ja-JP'] as const)('renders main chat header, input and selection in %s', locale => {
  state.locale = locale;
  const header = renderToStaticMarkup(React.createElement(ChatHeader, headerProps));
  expect(header).toContain(raw.name);
  expect(header).toContain(translateUi(locale, 'chat.main.emotionActive'));
  expect(header).toContain(translateUi(locale, 'chat.main.online'));
  const selected = renderToStaticMarkup(React.createElement(ChatHeader, { ...headerProps, selectionMode: true }));
  expect(selected).toContain(translateUi(locale, 'chat.main.selected', { count: 3 }));
  const input = renderToStaticMarkup(React.createElement(ChatInputArea, { ...inputProps, autoReplyEnabled: true, autoReplySeconds: 5 }));
  expect(input).toContain('我的消息{count}');
  expect(input).toContain(translateUi(locale, 'chat.main.messagePlaceholder'));
  expect(input).toContain(translateUi(locale, 'chat.main.autoReply', { seconds: 5 }));
  const bulk = renderToStaticMarkup(React.createElement(ChatInputArea, { ...inputProps, selectionMode: true, favoriteEligibleCount: 2, onFavoriteSelected: vi.fn(), onForwardSelected: vi.fn() }));
  expect(bulk).toContain(translateUi(locale, 'chat.main.favoriteGroup', { count: 2 }));
  expect(bulk).toContain(translateUi(locale, 'chat.main.forwardSelected', { count: 3 }));
  expect(inputProps.onSend).not.toHaveBeenCalled();
  expect(inputProps.onDeleteSelected).not.toHaveBeenCalled();
});

it.each(['zh-CN', 'ja-JP'] as const)('renders every action menu page and conversation switch in %s', locale => {
  state.locale = locale;
  const pages = [0, 1, 2].map(previewActionsPage => renderToStaticMarkup(React.createElement(ChatInputArea, { ...inputProps, showPanel: 'actions', previewActionsPage })));
  const all = pages.join('');
  for (const key of ['narration', 'settings', 'gallery', 'memoryLink', 'favorite', 'dress'] as const) expect(all).toContain(translateUi(locale, `chat.main.${key}`));
  const chars = renderToStaticMarkup(React.createElement(ChatInputArea, { ...inputProps, showPanel: 'chars', unreadMessages: { [raw.id]: 7 } }));
  expect(chars).toContain(raw.name);
  expect(chars).toContain(translateUi(locale, 'chat.main.switchChat'));
  expect(chars).toContain(translateUi(locale, 'chat.main.unread', { count: 7 }));
  expect(inputProps.onPanelAction).not.toHaveBeenCalled();
});

it('preserves every event handler and stable input value, action identifier and disabled gate', () => {
  for (const path of ['components/chat/ChatHeaderShell.tsx', 'components/chat/ChatInputArea.tsx']) {
    const actual = readFileSync(path, 'utf8'), original = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' });
    const attrs = (text: string) => {
      const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && (/^on[A-Z]/.test(node.name.getText(sf)) || ['value', 'disabled', 'checked', 'data-guide', 'type', 'enterKeyHint'].includes(node.name.getText(sf)))) result.push(node.getText(sf).replace(/\r/g, ''));
        ts.forEachChild(node, visit);
      };
      visit(sf); return result;
    };
    expect(attrs(actual)).toEqual(attrs(original));
    const sf = ts.createSourceFile(path, actual, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 'uiT' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text as UiMessageKey;
        expect(UI_MESSAGES['zh-CN'][key]).toBeDefined();
        expect(UI_MESSAGES['ja-JP'][key]).toBeDefined();
      }
      ts.forEachChild(node, visit);
    }; visit(sf);
  }
});

it('keeps interpolated user names literal and uses uiT without shadowing bubble theme t', () => {
  for (const locale of ['zh-CN', 'ja-JP'] as const) {
    expect(translateUi(locale, 'chat.main.deleteTheme', { name: '原主题{count}' })).toContain('原主题{count}');
    expect(translateUi(locale, 'chat.main.deleteBuffConfirm', { name: '原状态{count}' })).toContain('原状态{count}');
  }
  const source = readFileSync('components/chat/ChatInputArea.tsx', 'utf8');
  expect(source).toContain("uiT('chat.main.deleteTheme', { name: t.name })");
  expect(source).toContain("onPanelAction(luckinActivated ? 'luckin-end' : 'luckin-request')");
  expect(source).toContain("onPanelAction(mcdActivated ? 'mcd-end' : 'mcd-request')");
});
