import { describe, expect, it } from 'vitest';
import { locateDateDialogueLine, replaceDateDialogueLine } from './dateLineEdit';
import { parseDateDialogue } from './dateVoiceMarkup';
import { extractObservation } from './datePrompts';

const parseLine = (line: string) => parseDateDialogue(line, 'normal');
const batchOf = (content: string) => parseDateDialogue(extractObservation(content, { lenient: true }).rest, 'normal').map(item => item.text);

const reply = [
    '⟦OBSERVE⟧',
    '时间｜傍晚',
    '地点｜车库',
    '⟦/OBSERVE⟧',
    '[normal] 他把头盔挂好，回头看了你一眼。',
    '[happy] [v:happy] "怎么，想我了？"',
    '[normal] 他把头盔挂好，回头看了你一眼。',
    '[shy] "……别这么看我。"',
].join('\n');

const messages = [
    { id: 1, role: 'user', content: '我来了' },
    { id: 2, role: 'assistant', content: reply },
];

describe('立绘「编辑当前这句」定位原文行', () => {
    it('台词行：找到第几行，行首标签单独留出来', () => {
        const batch = batchOf(reply);
        const index = batch.findIndex(text => text.includes('想我了'));
        const located = locateDateDialogueLine({ messages, batchTexts: batch, index, parseLine })!;
        expect(located.message.id).toBe(2);
        expect(located.lineIndex).toBe(5);
        expect(located.prefix).toBe('[happy] [v:happy] ');
        expect(located.body).toBe('"怎么，想我了？"');
    });

    it('同一句出现两次：按第几次出现对上第几行', () => {
        const batch = batchOf(reply);
        const first = batch.findIndex(text => text.includes('头盔'));
        const second = batch.findIndex((text, i) => i > first && text.includes('头盔'));
        expect(locateDateDialogueLine({ messages, batchTexts: batch, index: first, parseLine })!.lineIndex).toBe(4);
        expect(locateDateDialogueLine({ messages, batchTexts: batch, index: second, parseLine })!.lineIndex).toBe(6);
    });

    it('改完只换那一行，标签和观测块都原样保留', () => {
        const next = replaceDateDialogueLine(reply, 5, '[happy] [v:happy] ', '"怎么，\n这么快就想我了？"')!;
        const lines = next.split('\n');
        expect(lines[5]).toBe('[happy] [v:happy] "怎么， 这么快就想我了？"');
        expect(lines.slice(0, 5)).toEqual(reply.split('\n').slice(0, 5));
        expect(lines.slice(6)).toEqual(reply.split('\n').slice(6));
        expect(replaceDateDialogueLine(reply, 5, '[happy] ', '   ')).toBeNull();
    });

    it('找不到（没落库的开场等）返回 null；用户消息不参与', () => {
        expect(locateDateDialogueLine({ messages, batchTexts: ['完全不存在的一句'], index: 0, parseLine })).toBeNull();
        expect(locateDateDialogueLine({ messages: [{ id: 9, role: 'user', content: '[normal] 我来了' }], batchTexts: ['我来了'], index: 0, parseLine })).toBeNull();
    });
});
