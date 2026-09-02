import { describe, expect, it } from 'vitest';
import { resolveLauncherDropKey, type LauncherDropCandidate } from './launcherDropTarget';

/** 一页 4 列图标网格：格子 56 宽、76 高，列距 8、行距 20，页面左右各留 24。 */
const grid = (count: number, prefix = 'app'): LauncherDropCandidate[] => {
    const colWidth = 79.5;
    const rowHeight = 96;
    return Array.from({ length: count }, (_, index) => {
        const col = index % 4;
        const row = Math.floor(index / 4);
        const left = 24 + col * colWidth + 12;
        const top = 100 + row * rowHeight;
        return { key: `${prefix}-${index}`, left, top, right: left + 56, bottom: top + 76 };
    });
};

/** 整行宽的 4x2 组件，占某一行开始的两行高度。 */
const wideWidget = (key: string, row: number): LauncherDropCandidate => ({
    key,
    left: 24,
    top: 100 + row * 96,
    right: 366,
    bottom: 100 + row * 96 + 172,
});

const centerOf = (item: LauncherDropCandidate) => ({
    x: (item.left + item.right) / 2,
    y: (item.top + item.bottom) / 2,
});

describe('resolveLauncherDropKey', () => {
    it('没有格子可落时返回 null（追加到页尾）', () => {
        expect(resolveLauncherDropKey([], 100, 100)).toBeNull();
    });

    it('把自己排除掉——拖动中的那一格不能当自己的落点', () => {
        const items = grid(1);
        expect(resolveLauncherDropKey(items, 100, 140, 'app-0')).toBeNull();
    });

    it('落在某格左半边 → 插到它前面', () => {
        const items = grid(8);
        const target = items[5];
        expect(resolveLauncherDropKey(items, target.left + 6, centerOf(target).y)).toBe('app-5');
    });

    it('落在某格右半边 → 插到下一格前面', () => {
        const items = grid(8);
        const target = items[5];
        expect(resolveLauncherDropKey(items, target.right - 6, centerOf(target).y)).toBe('app-6');
    });

    it('落在最后一格右半边 → null，也就是追加到页尾', () => {
        const items = grid(8);
        const last = items[7];
        expect(resolveLauncherDropKey(items, last.right - 6, centerOf(last).y)).toBeNull();
    });

    it('落在所有格子下方的空白 → 追加到页尾（这是原来唯一能走通的路径）', () => {
        const items = grid(8);
        expect(resolveLauncherDropKey(items, 200, 900)).toBeNull();
    });

    it('落在第一格上方 → 插到最前面', () => {
        const items = grid(8);
        expect(resolveLauncherDropKey(items, centerOf(items[0]).x, 10)).toBe('app-0');
    });

    // ↓ 这些正是老代码会掉到「整页 = 追加到页尾」的位置
    it('落在两个图标之间的横向空隙里，仍然认得出插到哪', () => {
        const items = grid(8);
        const gapX = (items[1].right + items[2].left) / 2;
        expect(resolveLauncherDropKey(items, gapX, centerOf(items[1]).y)).toBe('app-2');
    });

    it('落在两行之间的纵向空隙里，归到更近的那一行而不是页尾', () => {
        const items = grid(8);
        const gapY = (items[0].bottom + items[4].top) / 2 - 1;
        const key = resolveLauncherDropKey(items, centerOf(items[1]).x, gapY);
        expect(key).not.toBeNull();
        expect(['app-1', 'app-2']).toContain(key);
    });

    it('行距权重让落点不会跨行乱抓：贴着第二行的点不该选到第一行行尾', () => {
        const items = grid(8);
        const secondRowTop = items[4].top + 4;
        expect(resolveLauncherDropKey(items, centerOf(items[4]).x, secondRowTop)).toBe('app-4');
    });

    it('宽组件也能被当作落点，插到它前面', () => {
        const items = [...grid(4), wideWidget('uw:big', 1)];
        const widget = items[4];
        expect(resolveLauncherDropKey(items, widget.left + 10, centerOf(widget).y)).toBe('uw:big');
    });

    it('宽组件下半部分的右侧 → 插到它后面那一格前面', () => {
        const tail = grid(2, 'tail').map(item => ({
            ...item,
            top: item.top + 300,
            bottom: item.bottom + 300,
        }));
        const items = [...grid(4), wideWidget('uw:big', 1), ...tail];
        const widget = items[4];
        expect(resolveLauncherDropKey(items, widget.right - 10, centerOf(widget).y)).toBe('tail-0');
    });

    it('上一行的行尾往下一点 → 插到下面那个宽组件前面', () => {
        const items = [...grid(4), wideWidget('uw:big', 1)];
        expect(resolveLauncherDropKey(items, 360, 190)).toBe('uw:big');
    });

    it('零面积的格子（还没布局出来）不参与判定', () => {
        const items: LauncherDropCandidate[] = [
            { key: 'ghost', left: 0, top: 0, right: 0, bottom: 0 },
            ...grid(2),
        ];
        expect(resolveLauncherDropKey(items, centerOf(items[1]).x, centerOf(items[1]).y - 200)).toBe('app-0');
    });

    it('key 为空的条目会被忽略', () => {
        const items: LauncherDropCandidate[] = [
            { key: '', left: 10, top: 10, right: 60, bottom: 60 },
            ...grid(1),
        ];
        expect(resolveLauncherDropKey(items, 30, 30)).toBe('app-0');
    });
});
