import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, `file:///${root.replace(/\\/g, '/')}/`), 'utf8');

describe('user voice message wiring', () => {
  it('sends a real voice message and keeps the Blob out of message metadata', () => {
    const chat = read('apps/Chat.tsx');
    expect(chat).toContain("handleSendText(transcript, 'voice'");
    expect(chat).toContain('delete persistedMetadata._voiceBlob');
    expect(chat).toContain('persistVoice(savedUserMsgId');
  });

  it('rehydrates and renders user voice assets', () => {
    const chat = read('apps/Chat.tsx');
    const item = read('components/chat/MessageItem.tsx');
    expect(chat).toContain("m.type === 'voice'");
    expect(item).toContain("const isUserVoiceMessage = isUser && m.type === 'voice'");
  });

  it('serializes voice transcript as voice context for the character', () => {
    const formatter = read('utils/messageFormat.ts');
    expect(formatter).toContain('[语音转写]');
    expect(formatter).toContain("type === 'voice'");
  });

  it('uses an auto-growing textarea in the call composer', () => {
    const call = read('apps/CallApp.tsx');
    expect(call).toContain('textarea.style.height =');
    expect(call).toContain('Math.min(textarea.scrollHeight, 144)');
    expect(call).toContain('<textarea');
  });

  it('uses the same auto-growing textarea in the chat composer', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    expect(chatInput).toContain('textarea.style.height =');
    // 聊天消息栏的测量走 syncTextareaHeight（带脏值防呆 + 一行兜底），上限仍是 144。
    expect(chatInput).toContain('const MAX_INPUT_HEIGHT = 144;');
    expect(chatInput).toContain('Math.min(contentHeight, MAX_INPUT_HEIGHT)');
    expect(chatInput).toContain('max-h-36');
  });

  it('re-measures the chat composer when layout changes instead of only on input', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    // 键盘弹起/收起、旋转、字体晚加载、宽度变化都要重量，否则高度会被钉死在脏值上。
    expect(chatInput).toContain('new ResizeObserver');
    expect(chatInput).toContain("window.visualViewport?.addEventListener('resize'");
    expect(chatInput).toContain('document.fonts?.ready');
    // 元素还没排版时不能写高度。
    expect(chatInput).toContain('textarea.offsetParent === null');
  });

  it('lets a scrollable composer pan while the soft keyboard is open', () => {
    const standalone = read('utils/iosStandalone.ts');
    expect(standalone).toContain('isScrollableTextEntry');
    expect(standalone).toContain('if (isScrollableTextEntry(target)) return;');
  });

  it('keeps the chat composer compact and scrolls long text inside the box', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    expect(chatInput).toContain("textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden'");
    expect(chatInput).toContain('overscroll-contain');
  });

  // 消息栏排版必须和上游一致，社区流通的聊天美化 CSS 是按上游 DOM 写的：
  // 发送按钮回来了、加号/表情按钮回到 w-11/w-6，输入框外层不再套自定义裁剪层。
  it('keeps the composer row identical to upstream so community CSS still matches', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    expect(chatInput).toContain('const sendButtonClass');
    expect(chatInput).toContain('PaperPlaneTilt');
    expect(chatInput).toContain('p-3 px-4 flex gap-3 items-end relative');
    expect(chatInput).toContain("${useIOSStandaloneInputFix ? 'overflow-visible' : 'overflow-hidden'}");
    expect(chatInput).not.toContain('sully-chat-input-clip');
  });

  // 上游没有的两个功能一个都不能少，只是从消息栏挪进了加号菜单。
  it('moves the extra composer features into the plus panel', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    expect(chatInput).toContain('<span className="text-xs font-bold">语音</span>');
    expect(chatInput).toContain('<span className="text-xs font-bold">放大编辑</span>');
    expect(chatInput).toContain('onClick={openFullscreenEditor}');
    expect(chatInput).toContain('setIsFullscreenEditor(true)');
    expect(chatInput).toContain('CornersOut');
  });
});
