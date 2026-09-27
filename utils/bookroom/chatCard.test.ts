import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBookroomMessage } from '../../components/chat/BookroomChatCard';
import { buildProgressMessage } from './bookroom';
import { buildHighlightMessage } from './highlightReply';
import { resolveCardHook } from '../chatCardHooks';
import { CHAT_CARD_CATALOG } from '../chatCardCss';

describe('书房消息在聊天里显示成卡片', () => {
    it('读书进度：标题、书名、原文、感想分开', () => {
        const text = buildProgressMessage({ bookTitle: '雪线以北', chapterTitle: '第二章 旧信', ratio: 0.43, finished: false, thought: '好难过', sentence: '她终于开口说：“你回来了。”' });
        const card = parseBookroomMessage(text);
        expect(card.title).toBe('读书进度');
        expect(card.book).toBe('雪线以北');
        expect(card.lines).toEqual([
            '我《雪线以北》读到了「第二章 旧信」（全书约 43%）',
            '停在这句：「她终于开口说：“你回来了。”」',
            '感想：好难过',
        ]);
    });

    it('划线：按 kind 显示标题，原文单独一行', () => {
        const text = buildHighlightMessage({ bookTitle: '雪线以北', chapter: '第二章', quote: '你回来了。', comment: '哭了' });
        const card = parseBookroomMessage(text, 'highlight');
        expect(card.title).toBe('划线');
        expect(card.lines).toContain('「你回来了。」');
    });

    it('认不出格式也能显示', () => {
        expect(parseBookroomMessage('随便一段话')).toEqual({ title: '书房', book: undefined, lines: ['随便一段话'] });
    });

    it('聊天消息组件接上了卡片（只接用户那边、来源是书房的文字消息）', () => {
        const src = readFileSync(path.resolve(__dirname, '../../components/chat/MessageItem.tsx'), 'utf8');
        expect(src).toContain("if (isUser && m.type === 'text' && m.metadata?.source === 'bookroom')");
    });
});

describe('书房卡片能被卡片 CSS 选中', () => {
    it('挂 data-card="bookroom_card"，子类是哪一种汇报', () => {
        expect(resolveCardHook({ role: 'user', type: 'text', metadata: { source: 'bookroom' } })).toEqual({ kind: 'bookroom_card', sub: 'progress' });
        expect(resolveCardHook({ role: 'user', type: 'text', metadata: { source: 'bookroom', bookroomKind: 'review' } })).toEqual({ kind: 'bookroom_card', sub: 'review' });
        // 角色的回复还是普通气泡；别的文字消息不受影响
        expect(resolveCardHook({ role: 'assistant', type: 'text', metadata: { source: 'bookroom', bookroomKind: 'review-reply' } })).toBeNull();
        expect(resolveCardHook({ role: 'user', type: 'text', content: '你好' })).toBeNull();
    });

    it('登记进卡片名录，可可点点内置预设写了它的样式', () => {
        expect(CHAT_CARD_CATALOG.some(e => e.card === 'bookroom_card')).toBe(true);
        // 测试环境里 ?raw 导入读不出内容，直接读文件
        const css = readFileSync(path.resolve(__dirname, '../../assets/css-presets/cocoa-dots/chat-card-v6.css'), 'utf8');
        expect(css).toContain('[data-card="bookroom_card"] .sully-bookroom-card-head');
        expect(css).toContain('.sully-bookroom-card-quote');
        expect(readFileSync(path.resolve(__dirname, '../chatCardCss.ts'), 'utf8')).toContain('cocoa-dots/chat-card-v6.css?raw');
        const preset = JSON.parse(readFileSync(path.resolve(__dirname, '../../public/appearance-presets/cocoa-dots/v1/preset.json'), 'utf8'));
        expect(preset.theme.chatCardCustomCss).toBe(css);
    });
});
