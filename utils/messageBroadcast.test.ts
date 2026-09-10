import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { isBroadcastableMessage, prepareBroadcastText } from './messageBroadcast';

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 1,
    charId: 'char-1',
    role: 'user',
    type: 'text',
    content: '你好',
    timestamp: 1,
    ...overrides,
});

describe('messageBroadcast', () => {
    it('keeps ordinary user text as a normal message body', () => {
        expect(prepareBroadcastText(makeMessage({ content: '  你好，晚安。  ' }))).toBe('你好，晚安。');
        expect(isBroadcastableMessage(makeMessage())).toBe(true);
    });

    it('allows ordinary assistant text but refuses system and non-text messages', () => {
        expect(prepareBroadcastText(makeMessage({ role: 'assistant', content: '我在。' }))).toBe('我在。');
        expect(prepareBroadcastText(makeMessage({ role: 'system' }))).toBeNull();
        expect(prepareBroadcastText(makeMessage({ type: 'image' }))).toBeNull();
        expect(isBroadcastableMessage(makeMessage({ content: '   ' }))).toBe(false);
    });

    it('unwraps known voice markup instead of sending protocol tags', () => {
        expect(prepareBroadcastText(makeMessage({ role: 'assistant', content: '先说一句。<语音>晚安，做个好梦。</语音>' })))
            .toBe('先说一句。');
        expect(prepareBroadcastText(makeMessage({ role: 'assistant', content: '<语音>晚安。</语音>' })))
            .toBe('晚安。');
        expect(prepareBroadcastText(makeMessage({ role: 'assistant', content: '<语音 emotion="happy">好呀。</语音>' })))
            .toBe('好呀。');
    });

    it('rejects unknown control markup rather than guessing how to clean it', () => {
        expect(prepareBroadcastText(makeMessage({ content: '正文 [[ACTION:CALL]]' }))).toBeNull();
        expect(prepareBroadcastText(makeMessage({ content: '<think>内部思考</think>正文' }))).toBeNull();
        expect(prepareBroadcastText(makeMessage({ content: '原文%%BILINGUAL%%译文' }))).toBeNull();
        expect(prepareBroadcastText(makeMessage({ content: '[html]<div>卡片</div>[/html]' }))).toBeNull();
        expect(prepareBroadcastText(makeMessage({ content: '正文 <think' }))).toBeNull();
    });
});
