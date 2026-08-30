import type { Emoji } from '../types';

/**
 * 保留 IndexedDB 原有顺序，只把用户手动「移至最前」过的表情按最近操作倒序提到前面。
 * Array#sort 在现代浏览器中是稳定的，两张都没有排序标记时不会打乱旧用户的库。
 */
export function sortEmojisForDisplay(emojis: Emoji[]): Emoji[] {
    return [...emojis].sort((a, b) => {
        const aFront = Number.isFinite(a.movedToFrontAt) ? Number(a.movedToFrontAt) : 0;
        const bFront = Number.isFinite(b.movedToFrontAt) ? Number(b.movedToFrontAt) : 0;
        return bFront - aFront;
    });
}
