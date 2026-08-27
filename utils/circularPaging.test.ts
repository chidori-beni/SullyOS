import { describe, expect, it } from 'vitest';
import {
    carouselCloneResetIndex,
    carouselLogicalIndex,
    carouselPhysicalIndex,
    wrapPageIndex,
} from './circularPaging';

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

describe('looping carousel physical/logical indices', () => {
    it('places logical pages between the two edge clones', () => {
        expect(carouselPhysicalIndex(0, 5)).toBe(1);
        expect(carouselPhysicalIndex(4, 5)).toBe(5);
        expect(carouselPhysicalIndex(99, 5)).toBe(5);
        expect(carouselPhysicalIndex(-1, 5)).toBe(1);
        expect(carouselPhysicalIndex(0, 0)).toBe(0);
    });

    it('maps the edge clones to the page they visually continue', () => {
        expect(carouselLogicalIndex(0, 5)).toBe(4);
        expect(carouselLogicalIndex(1, 5)).toBe(0);
        expect(carouselLogicalIndex(5, 5)).toBe(4);
        expect(carouselLogicalIndex(6, 5)).toBe(0);
        expect(carouselLogicalIndex(2, 5)).toBe(1);
        expect(carouselLogicalIndex(0, 0)).toBe(0);
    });

    it('only asks the scroller to reset after a clone has snapped', () => {
        expect(carouselCloneResetIndex(0, 5)).toBe(5);
        expect(carouselCloneResetIndex(6, 5)).toBe(1);
        expect(carouselCloneResetIndex(1, 5)).toBeNull();
        expect(carouselCloneResetIndex(3, 5)).toBeNull();
        expect(carouselCloneResetIndex(0, 0)).toBeNull();
    });
});
