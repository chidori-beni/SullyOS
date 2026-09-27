import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBookroomMessage } from '../../components/chat/BookroomChatCard';
import { buildProgressMessage } from './bookroom';
import { buildHighlightMessage } from './highlightReply';

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
