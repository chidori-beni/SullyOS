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
    expect(chatInput).toContain('Math.min(textarea.scrollHeight, 144)');
    expect(chatInput).toContain('max-h-36');
  });

  it('keeps the chat composer compact and offers scroll/fullscreen controls for long text', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    expect(chatInput).toContain("textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden'");
    expect(chatInput).toContain('overscroll-contain');
    expect(chatInput).toContain('CornersOut');
    expect(chatInput).toContain('setIsFullscreenEditor(true)');
    expect(chatInput).not.toContain('sendButtonClass');
    expect(chatInput).not.toContain('PaperPlaneTilt');
  });

  it('clips composer content to the theme frame without assuming a rounded shape', () => {
    const chatInput = read('components/chat/ChatInputArea.tsx');
    expect(chatInput).toContain('sully-chat-input-clip');
    expect(chatInput).toContain("style={{ overflow: 'hidden', borderRadius: 'inherit' }}");
    expect(chatInput).toContain('px-1 overflow-hidden transition-all');
  });
});
