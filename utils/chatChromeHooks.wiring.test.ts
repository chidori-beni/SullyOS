import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Message } from '../types';
import MessageItem from '../components/chat/MessageItem';

/**
 * 「白框 CSS」提示词里承诺的类名，必须真的存在于渲染结果 / 源码里。
 *
 * 那份提示词是用户唯一的说明书 —— 它列了什么类，别的 AI 就照着写什么 CSS。
 * 列了却不存在的类＝用户粘回来一段完全不生效的 CSS，且看不出原因。
 */

const activeTheme = { id: 't', name: 'T', user: {}, ai: {} } as any;

const render = (msg: Message, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(React.createElement(MessageItem, {
        msg,
        isFirstInGroup: true,
        isLastInGroup: true,
        activeTheme,
        charAvatar: 'https://example.com/c.png',
        charName: '角色',
        userAvatar: 'https://example.com/u.png',
        onLongPress: vi.fn(),
        onReply: vi.fn(),
        selectionMode: false,
        isSelected: false,
        onToggleSelect: vi.fn(),
        showTimestamp: 'always',
        ...extra,
    } as any));

const base = { id: 1, charId: 'c', timestamp: 1 };

describe('消息内的钩子真的渲染出来了', () => {
    it('时间戳', () => {
        expect(render({ ...base, role: 'assistant', type: 'text', content: '喂' } as Message))
            .toContain('sully-message-time');
    });

    it('引用/回复块', () => {
        const html = render({
            ...base, role: 'user', type: 'text', content: '回你',
            replyTo: { name: '角色', content: '原话' },
        } as any);
        expect(html).toContain('sully-reply-quote');
        expect(html).toContain('sully-reply-quote-name');
        expect(html).toContain('sully-reply-quote-text');
    });

    it('表情反应条', () => {
        const html = render({
            ...base, role: 'assistant', type: 'text', content: '喂',
            metadata: { messageReactions: [{ emoji: '❤️', by: 'user', at: 1 }] },
        } as Message);
        expect(html).toContain('sully-message-reactions');
    });

    it('表情包消息', () => {
        expect(render({ ...base, role: 'user', type: 'emoji', content: 'https://e/x.png' } as Message))
            .toContain('sully-emoji-msg');
    });

    it('语音条', () => {
        const html = render(
            { ...base, role: 'assistant', type: 'text', content: '听我说' } as Message,
            { voiceData: { url: 'blob:x', originalText: '听我说' } },
        );
        expect(html).toContain('sully-voice-bar-shell');
        expect(html).toContain('sully-voice-bar');
    });
});

describe('聊天页里的钩子（不经 MessageItem 的那几个）', () => {
    const chatSrc = fs.readFileSync(path.resolve(__dirname, '../apps/Chat.tsx'), 'utf-8');

    it.each([
        'sully-typing-indicator',
        'sully-typing-avatar',
        'sully-typing-bubble',
        'sully-typing-dots',
        'sully-typing-dot ',
        'sully-pending-dots',
        'sully-pending-dot ',
        'sully-chat-date-divider',
        'sully-chat-date-divider-line',
        'sully-chat-date-divider-text',
    ])('%s 在 Chat.tsx 里挂上了', (hook) => {
        expect(chatSrc).toContain(hook);
    });
});

describe('提示词里列的类名都不是空头支票', () => {
    const prompt = fs.readFileSync(path.resolve(__dirname, '../components/chat/ChromeCssEditor.tsx'), 'utf-8');
    const sources = [
        fs.readFileSync(path.resolve(__dirname, '../components/chat/MessageItem.tsx'), 'utf-8'),
        fs.readFileSync(path.resolve(__dirname, '../apps/Chat.tsx'), 'utf-8'),
        fs.readFileSync(path.resolve(__dirname, '../apps/GroupChat.tsx'), 'utf-8'),
        fs.readFileSync(path.resolve(__dirname, '../components/chat/ChatHeaderShell.tsx'), 'utf-8'),
        fs.readFileSync(path.resolve(__dirname, '../components/chat/ChatInputArea.tsx'), 'utf-8'),
        fs.readFileSync(path.resolve(__dirname, '../components/chat/ScheduleChangeNotice.tsx'), 'utf-8'),
    ].join('\n');

    // 只挑提示词「可用的类名」清单里那些完整写出来的类（-xxx 简写行由人工对照）
    const listed = [...prompt.matchAll(/^- (\.sully-[\w-]+)/gm)].map(([, cls]) => cls.slice(1));

    it('清单不是空的', () => {
        expect(listed.length).toBeGreaterThan(15);
    });

    it.each(listed)('%s 在源码里真的存在', (cls) => {
        expect(sources).toContain(cls);
    });
});
