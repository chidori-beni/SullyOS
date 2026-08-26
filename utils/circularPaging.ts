/** Move one step in a finite carousel while treating both ends as adjacent. */
export const wrapPageIndex = (index: number, direction: -1 | 1, total: number): number => {
    if (total <= 0) return 0;
    const next = index + direction;
    return next < 0 ? total - 1 : next >= total ? 0 : next;
};
