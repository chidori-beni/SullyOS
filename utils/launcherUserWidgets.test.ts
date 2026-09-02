import { describe, expect, it } from 'vitest';
import type { LauncherUserWidget } from '../types';
import {
    LAUNCHER_WIDGET_PAGE_LIMIT,
    LAUNCHER_WIDGET_SIZES,
    addLauncherUserWidget,
    appTargetAfterWidget,
    buildLauncherPageSlots,
    launcherWidgetIdFromItemKey,
    launcherWidgetItemKey,
    launcherWidgetSpan,
    launcherWidgetsForPage,
    migrateLegacyLauncherWidgets,
    moveLauncherUserWidget,
    normalizeLauncherUserWidgets,
    removeLauncherUserWidget,
    updateLauncherUserWidget,
} from './launcherUserWidgets';

const page = (id: string, appCount: number) => ({
    id,
    appIds: Array.from({ length: appCount }, (_, index) => `${id}-app-${index}`),
});

const widget = (over: Partial<LauncherUserWidget> = {}): LauncherUserWidget => ({
    id: 'w1',
    pageId: 'p1',
    size: '2x2',
    pos: 0,
    ...over,
});

describe('launcherWidgetSpan', () => {
    it('每种尺寸都翻译成合法的 grid span', () => {
        for (const size of LAUNCHER_WIDGET_SIZES) {
            const span = launcherWidgetSpan(size);
            expect(span.cols).toBeGreaterThanOrEqual(1);
            expect(span.cols).toBeLessThanOrEqual(4);
            expect(span.rows).toBeGreaterThanOrEqual(1);
        }
    });

    it('列 x 行 不会被写反', () => {
        expect(launcherWidgetSpan('2x1')).toEqual({ cols: 2, rows: 1 });
        expect(launcherWidgetSpan('1x2')).toEqual({ cols: 1, rows: 2 });
        expect(launcherWidgetSpan('4x4')).toEqual({ cols: 4, rows: 4 });
    });
});

describe('item key 编解码', () => {
    it('往返一致，且不会把 App id 认成组件', () => {
        expect(launcherWidgetIdFromItemKey(launcherWidgetItemKey('abc'))).toBe('abc');
        expect(launcherWidgetIdFromItemKey('chat')).toBeNull();
        expect(launcherWidgetIdFromItemKey(undefined)).toBeNull();
    });
});

describe('normalizeLauncherUserWidgets', () => {
    it('丢掉尺寸非法、缺 id、重复 id 的条目', () => {
        const result = normalizeLauncherUserWidgets([
            widget({ id: 'a' }),
            widget({ id: 'a' }),
            widget({ id: 'b', size: '9x9' as any }),
            widget({ id: '' }),
            null,
            'nope',
        ], ['p1']);
        expect(result.map(w => w.id)).toEqual(['a']);
    });

    it('页不存在时归到 fallback 页', () => {
        const result = normalizeLauncherUserWidgets([widget({ pageId: 'gone' })], ['p1', 'p2'], 'p1');
        expect(result[0].pageId).toBe('p1');
    });

    it('pos 缺失或是 NaN 时补一个有限值', () => {
        const result = normalizeLauncherUserWidgets([
            { id: 'a', pageId: 'p1', size: '1x1' },
            { id: 'b', pageId: 'p1', size: '1x1', pos: Number.NaN },
        ], ['p1']);
        expect(result.every(w => Number.isFinite(w.pos))).toBe(true);
    });

    it('非数组一律返回空数组', () => {
        expect(normalizeLauncherUserWidgets(undefined)).toEqual([]);
        expect(normalizeLauncherUserWidgets({ id: 'x' })).toEqual([]);
    });
});

describe('buildLauncherPageSlots', () => {
    it('组件按 pos 插进 App 之间，同键时组件排前面', () => {
        const p = page('p1', 3);
        const slots = buildLauncherPageSlots(p, [
            widget({ id: 'w-mid', pos: 1.5 }),
            widget({ id: 'w-head', pos: 1 }),
        ]);
        expect(slots.map(slot => (slot.kind === 'app' ? slot.appId : slot.widget.id))).toEqual([
            'p1-app-0',
            'w-head',
            'p1-app-1',
            'w-mid',
            'p1-app-2',
        ]);
    });

    it('只算本页的组件', () => {
        const slots = buildLauncherPageSlots(page('p1', 1), [widget({ id: 'other', pageId: 'p2' })]);
        expect(slots).toHaveLength(1);
        expect(launcherWidgetsForPage([widget({ id: 'other', pageId: 'p2' })], 'p1')).toEqual([]);
    });
});

describe('addLauncherUserWidget', () => {
    it('新组件落到页尾', () => {
        const p = page('p1', 2);
        const result = addLauncherUserWidget([], p, '4x2', { id: 'w-new' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const slots = buildLauncherPageSlots(p, result.widgets);
        expect(slots[slots.length - 1].key).toBe(launcherWidgetItemKey('w-new'));
    });

    it('超过每页上限就拒绝，并给出理由', () => {
        const p = page('p1', 0);
        let widgets: LauncherUserWidget[] = [];
        for (let i = 0; i < LAUNCHER_WIDGET_PAGE_LIMIT; i += 1) {
            const step = addLauncherUserWidget(widgets, p, '1x1', { id: `w${i}` });
            expect(step.ok).toBe(true);
            if (step.ok) widgets = step.widgets;
        }
        const overflow = addLauncherUserWidget(widgets, p, '1x1');
        expect(overflow.ok).toBe(false);
        if (!overflow.ok) expect(overflow.reason).toContain(String(LAUNCHER_WIDGET_PAGE_LIMIT));
    });
});

describe('updateLauncherUserWidget', () => {
    it('换图、换尺寸、切换填充方式', () => {
        const start = [widget({ id: 'w1' })];
        const next = updateLauncherUserWidget(start, 'w1', { size: '4x4', image: 'blobref:x', fit: 'contain' });
        expect(next[0]).toMatchObject({ size: '4x4', image: 'blobref:x', fit: 'contain' });
    });

    it('传空图片 / cover 时把字段删掉而不是存空值', () => {
        const start = [widget({ id: 'w1', image: 'blobref:x', fit: 'contain' })];
        const next = updateLauncherUserWidget(start, 'w1', { image: '', fit: 'cover' });
        expect('image' in next[0]).toBe(false);
        expect('fit' in next[0]).toBe(false);
    });

    it('不认识的尺寸不会写进去', () => {
        const next = updateLauncherUserWidget([widget({ id: 'w1' })], 'w1', { size: '7x7' as any });
        expect(next[0].size).toBe('2x2');
    });

    it('删除只影响目标组件', () => {
        const start = [widget({ id: 'w1' }), widget({ id: 'w2' })];
        expect(removeLauncherUserWidget(start, 'w1').map(w => w.id)).toEqual(['w2']);
    });
});

describe('moveLauncherUserWidget', () => {
    it('落在某个 App 上就插到它前面', () => {
        const p = page('p1', 3);
        const start = [widget({ id: 'w1', pos: 99 })];
        const result = moveLauncherUserWidget(start, 'w1', p, 'p1-app-1');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const slots = buildLauncherPageSlots(p, result.widgets);
        expect(slots.map(slot => (slot.kind === 'app' ? slot.appId : slot.widget.id))).toEqual([
            'p1-app-0',
            'w1',
            'p1-app-1',
            'p1-app-2',
        ]);
    });

    it('插到第一个 App 前面也成立', () => {
        const p = page('p1', 2);
        const result = moveLauncherUserWidget([widget({ id: 'w1', pos: 5 })], 'w1', p, 'p1-app-0');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(buildLauncherPageSlots(p, result.widgets)[0].key).toBe(launcherWidgetItemKey('w1'));
    });

    it('不给目标就落到页尾，并且换页会改 pageId', () => {
        const target = page('p2', 2);
        const result = moveLauncherUserWidget([widget({ id: 'w1', pageId: 'p1' })], 'w1', target);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.widget.pageId).toBe('p2');
        const slots = buildLauncherPageSlots(target, result.widgets);
        expect(slots[slots.length - 1].key).toBe(launcherWidgetItemKey('w1'));
    });

    it('落在另一个组件上就插到它前面', () => {
        const p = page('p1', 2);
        const start = [widget({ id: 'w1', pos: 9 }), widget({ id: 'w2', pos: 0.5 })];
        const result = moveLauncherUserWidget(start, 'w1', p, launcherWidgetItemKey('w2'));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const order = buildLauncherPageSlots(p, result.widgets).map(s => s.key);
        expect(order.indexOf(launcherWidgetItemKey('w1'))).toBeLessThan(order.indexOf(launcherWidgetItemKey('w2')));
    });

    it('目标页已满时拒绝跨页搬运', () => {
        const target = page('p2', 0);
        const full = Array.from({ length: LAUNCHER_WIDGET_PAGE_LIMIT }, (_, i) => widget({ id: `f${i}`, pageId: 'p2', pos: i }));
        const result = moveLauncherUserWidget([...full, widget({ id: 'w1', pageId: 'p1' })], 'w1', target);
        expect(result.ok).toBe(false);
    });

    it('同页内搬运不受目标页上限影响', () => {
        const p = page('p1', 1);
        const full = Array.from({ length: LAUNCHER_WIDGET_PAGE_LIMIT }, (_, i) => widget({ id: `f${i}`, pos: i }));
        const result = moveLauncherUserWidget(full, 'f0', p, 'p1-app-0');
        expect(result.ok).toBe(true);
    });

    it('组件不存在时报错而不是静默造一个', () => {
        expect(moveLauncherUserWidget([], 'nope', page('p1', 1)).ok).toBe(false);
    });
});

describe('appTargetAfterWidget', () => {
    it('返回组件后面那个 App', () => {
        const p = page('p1', 3);
        expect(appTargetAfterWidget(p, [widget({ id: 'w1', pos: 1 })], 'w1')).toBe('p1-app-1');
    });

    it('组件在页尾时返回 undefined（调用方按追加处理）', () => {
        const p = page('p1', 2);
        expect(appTargetAfterWidget(p, [widget({ id: 'w1', pos: 99 })], 'w1')).toBeUndefined();
    });
});

describe('migrateLegacyLauncherWidgets', () => {
    it('把 tl / tr / wide 搬成组件，dsq 留在旧字段里', () => {
        const result = migrateLegacyLauncherWidgets(
            { tl: 'a', tr: 'b', wide: 'c', dsq: 'd' },
            [],
            'p1',
        );
        expect(result).not.toBeNull();
        expect(result!.widgets.map(w => [w.size, w.image])).toEqual([
            ['2x2', 'a'],
            ['2x2', 'b'],
            ['4x1', 'c'],
        ]);
        expect(result!.widgets.every(w => w.pageId === 'p1')).toBe(true);
        expect(result!.legacyWidgets).toEqual({ dsq: 'd' });
    });

    it('迁移出来的组件排在这一页最前面且互不同位', () => {
        const result = migrateLegacyLauncherWidgets({ tl: 'a', wide: 'c' }, [], 'p1')!;
        const slots = buildLauncherPageSlots(page('p1', 2), result.widgets);
        expect(slots.slice(0, 2).every(slot => slot.kind === 'widget')).toBe(true);
        expect(new Set(result.widgets.map(w => w.pos)).size).toBe(result.widgets.length);
    });

    it('用户已经有自定义组件时不再迁移', () => {
        expect(migrateLegacyLauncherWidgets({ tl: 'a' }, [widget()], 'p1')).toBeNull();
    });

    it('没有旧槽位可搬时返回 null', () => {
        expect(migrateLegacyLauncherWidgets({ dsq: 'd' }, [], 'p1')).toBeNull();
        expect(migrateLegacyLauncherWidgets(undefined, [], 'p1')).toBeNull();
    });
});
