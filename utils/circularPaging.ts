/** Move one step in a finite carousel while treating both ends as adjacent. */
export const wrapPageIndex = (index: number, direction: -1 | 1, total: number): number => {
    if (total <= 0) return 0;
    const next = index + direction;
    return next < 0 ? total - 1 : next >= total ? 0 : next;
};

/**
 * A looping scroll container renders one copy of the last page before the real
 * pages and one copy of the first page after them. These helpers keep the UI's
 * logical page index (0..total-1) separate from the physical scroll index
 * (1..total), so the edge copies can be traversed naturally before being
 * silently normalised to their matching real page.
 */
export const carouselPhysicalIndex = (logicalIndex: number, total: number): number => {
    if (total <= 0) return 0;
    const clamped = Math.max(0, Math.min(total - 1, Math.trunc(logicalIndex)));
    return clamped + 1;
};

export const carouselLogicalIndex = (physicalIndex: number, total: number): number => {
    if (total <= 0) return 0;
    const rounded = Math.round(physicalIndex);
    if (rounded <= 0) return total - 1;
    if (rounded >= total + 1) return 0;
    return Math.max(0, Math.min(total - 1, rounded - 1));
};

/**
 * Returns the physical index to use after an edge clone has fully snapped, or
 * null while the scroll position is on a real page.
 */
export const carouselCloneResetIndex = (physicalIndex: number, total: number): number | null => {
    if (total <= 0) return null;
    const rounded = Math.round(physicalIndex);
    if (rounded <= 0) return total;
    if (rounded >= total + 1) return 1;
    return null;
};
