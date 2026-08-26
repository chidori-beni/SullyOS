import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
    formatDatePhoneMarkdown,
    isDatePhoneBridge,
    mergeDatePhoneMessages,
} from './datePhoneBridge';

const dateMessage = (id: number, timestamp: number, content: string): Message => ({
    id,
    charId: 'char-1',
    role: 'assistant',
    type: 'text',
    content,
    timestamp,
    metadata: { source: 'date', dateEncounterId: 'enc-1' },
});

const phoneMessage = (id: number, timestamp: number, role: Message['role'], content: string, encounterId = 'enc-1'): Message => ({
    id,
    charId: 'char-1',
    role,
    type: 'text',
    content,
    timestamp,
    metadata: { source: 'chat', datePhoneMessage: true, dateEncounterId: encounterId },
});

describe('date phone display bridge', () => {
    it('uses the real speaker name and Markdown-compatible source without mutating the original', () => {
        const original = phoneMessage(7, 20, 'user', '在你面前发消息');
        const markdown = formatDatePhoneMarkdown(original, '栖迟');
        expect(markdown).toContain('**栖迟** · 手机消息');
        expect(markdown).toContain('> 在你面前发消息');
        expect(original.metadata?.datePhoneBridge).not.toBe(true);
    });

    it('merges only linked messages as read-only projections and keeps one id per source row', () => {
        const dates = [dateMessage(1, 30, '线下回复')];
        const phone = phoneMessage(7, 20, 'user', '先给你发一句');
        const other = phoneMessage(8, 25, 'assistant', '另一场见面', 'enc-2');
        const timeline = mergeDatePhoneMessages(dates, [phone, other], 'enc-1', '栖迟', 'Sully');
        expect(timeline.map(message => message.id)).toEqual([7, 1]);
        expect(isDatePhoneBridge(timeline[0])).toBe(true);
        expect(timeline[0].content).toBe(phone.content);
        expect(isDatePhoneBridge(timeline[1])).toBe(false);
        expect(phone.metadata?.datePhoneBridge).not.toBe(true);
    });
});

