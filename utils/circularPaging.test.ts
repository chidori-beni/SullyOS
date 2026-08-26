import { describe, expect, it } from 'vitest';
import { wrapPageIndex } from './circularPaging';

describe('wrapPageIndex', () => {
    it('wraps previous from the first page to the last page', () => {
        expect(wrapPageIndex(0, -1, 5)).toBe(4);
    });
    it('wraps next from the last page to the first page', () => {
        expect(wrapPageIndex(4, 1, 5)).toBe(0);
    });
    it('keeps middle pages and handles an empty carousel', () => {
        expect(wrapPageIndex(2, -1, 5)).toBe(1);
        expect(wrapPageIndex(2, 1, 5)).toBe(3);
        expect(wrapPageIndex(0, 1, 0)).toBe(0);
    });
});
