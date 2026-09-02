/**
 * 桌面拖放的落点判定。
 *
 * 病根：原来只认 `document.elementFromPoint` 直接命中的那个 `[data-launcher-item]`。
 * 4 列网格里图标只有 56px 宽、格与格之间还有 gap，**手指落在空隙上是常态**，
 * 一落空就退回「整页」这个兜底落点，语义是「追加到页尾」——
 * 于是不管往哪拖，松手都掉到最后一格，看起来就是「根本没法自由拖动」。
 * 拖大组件时更明显：手指压着的往往是组件中间那一大片，底下多半不是图标。
 *
 * 改成按「离手指最近的格子」算插入点，并区分插到它前面还是后面。
 * 纯几何计算，不碰 DOM，方便直接测。
 */

export interface LauncherDropCandidate {
    /** 该格子的 data-launcher-item 值。 */
    key: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * 竖直方向的权重。行距（20px）比列距（8px）大得多，若两个方向等权，
 * 手指停在两行中间时会被上一行末尾的格子抢走，落点就跳行了。
 */
const ROW_BIAS = 4;

/**
 * 算出应该插到哪个格子前面。
 *
 * @returns 目标格子的 key；`null` 表示插到这一页的末尾。
 */
export const resolveLauncherDropKey = (
    candidates: readonly LauncherDropCandidate[],
    x: number,
    y: number,
    selfKey?: string,
): string | null => {
    const items = candidates.filter(item => (
        !!item.key
        && item.key !== selfKey
        && item.right > item.left
        && item.bottom > item.top
    ));
    if (items.length === 0) return null;

    // 落在所有格子下方的空白里 = 「放到这一页最后」。不特判的话，会退化成
    // 「按横坐标找最近的那一列，插到它后面」，手指明明在页面底部却插回中间。
    if (items.every(item => y > item.bottom)) return null;

    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
        // 竖直方向取「到格子上下边的距离」（在行内就是 0），水平方向取到中心的距离：
        // 这样同一行里的格子先按左右远近排，跨行的先被行距惩罚掉。
        const dy = y < item.top ? item.top - y : y > item.bottom ? y - item.bottom : 0;
        const centerX = (item.left + item.right) / 2;
        const score = dy * ROW_BIAS + Math.abs(x - centerX);
        if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });

    const best = items[bestIndex];
    const centerX = (best.left + best.right) / 2;
    // 落在这一格的右半边、或者整个在它下方 → 插到它后面（也就是插到下一格前面）。
    const after = y > best.bottom || (y >= best.top && x > centerX);
    if (!after) return best.key;
    const next = items[bestIndex + 1];
    return next ? next.key : null;
};
