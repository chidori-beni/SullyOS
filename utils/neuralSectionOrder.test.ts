import { describe, expect, it } from 'vitest';
import { DEFAULT_NEURAL_SECTION_ORDER, moveNeuralSection, normalizeNeuralSectionOrder } from './neuralSectionOrder';

describe('normalizeNeuralSectionOrder', () => {
    it('没存过就用默认顺序', () => {
        expect(normalizeNeuralSectionOrder(null)).toEqual(DEFAULT_NEURAL_SECTION_ORDER);
        expect(normalizeNeuralSectionOrder('坏数据')).toEqual(DEFAULT_NEURAL_SECTION_ORDER);
    });

    it('保留用户排过的顺序，丢掉不认识的和重复的，缺的补到末尾', () => {
        const out = normalizeNeuralSectionOrder(['voice', 'ghost', 'voice', 'time']);
        expect(out.slice(0, 2)).toEqual(['voice', 'time']);
        expect(out).toHaveLength(DEFAULT_NEURAL_SECTION_ORDER.length);
        expect(new Set(out).size).toBe(out.length);
    });
});

describe('moveNeuralSection', () => {
    it('上下挪一格，到头不动', () => {
        const base = DEFAULT_NEURAL_SECTION_ORDER.slice();
        expect(moveNeuralSection(base, 'prompt', -1).slice(0, 2)).toEqual(['prompt', 'group']);
        expect(moveNeuralSection(base, 'group', -1)).toBe(base);
        expect(moveNeuralSection(base, 'worldbook', 1)).toBe(base);
    });
});
