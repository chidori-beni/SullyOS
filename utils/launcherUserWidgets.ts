/**
 * 桌面自定义图片小组件（用户自己在主界面添加的那种）。
 *
 * 设计要点：
 * · 组件和 App 图标混排在同一个 4 列网格里，靠「同一条数轴」排序 ——
 *   App 第 i 个的排序键就是 i，组件的 pos 用小数插到两个 App 中间。
 *   这样 launcherPageLayout.pages[].appIds 完全不用改结构，旧版本降级也只是丢组件、不丢 App。
 * · 尺寸写作「列 x 行」，一格 = 一个 App 图标位；渲染时翻译成 CSS grid 的 span。
 * · 图片只存短字符串（blobref 令牌或图床直链），因为 theme 整体要写进 localStorage，
 *   直接塞 data URL 会撑爆配额。
 */

import type { LauncherBuiltinWidgetId, LauncherPage, LauncherUserWidget, LauncherWidgetSize } from '../types';

export const LAUNCHER_WIDGET_GRID_COLUMNS = 4;

/** 可选尺寸，按「从小到大」排列，加组件面板直接照这个顺序画。 */
export const LAUNCHER_WIDGET_SIZES: readonly LauncherWidgetSize[] = [
    '1x1', '2x1', '1x2', '2x2', '4x1', '4x2', '4x4',
];

export const LAUNCHER_WIDGET_SIZE_LABELS: Record<LauncherWidgetSize, string> = {
    '1x1': '迷你 1×1',
    '2x1': '横条 2×1',
    '1x2': '竖条 1×2',
    '2x2': '小型 2×2',
    '4x1': '横幅 4×1',
    '4x2': '中型 4×2',
    '4x4': '大型 4×4',
};

/** 一页最多放多少个组件——纯粹是防手滑，避免一页塞几百个把网格拖垮。 */
export const LAUNCHER_WIDGET_PAGE_LIMIT = 12;

export const isLauncherWidgetSize = (value: unknown): value is LauncherWidgetSize => (
    typeof value === 'string' && (LAUNCHER_WIDGET_SIZES as readonly string[]).includes(value)
);

/** '4x2' → { cols: 4, rows: 2 }。 */
export const launcherWidgetSpan = (size: LauncherWidgetSize): { cols: number; rows: number } => {
    const [cols, rows] = size.split('x').map(part => Number.parseInt(part, 10));
    return {
        cols: Math.min(LAUNCHER_WIDGET_GRID_COLUMNS, Math.max(1, cols || 1)),
        rows: Math.max(1, rows || 1),
    };
};

/** 组件在拖拽系统里的 data-launcher-item 值，加前缀避免和 AppID 撞。 */
export const LAUNCHER_WIDGET_ITEM_PREFIX = 'uw:';
export const launcherWidgetItemKey = (id: string): string => LAUNCHER_WIDGET_ITEM_PREFIX + id;
export const launcherWidgetIdFromItemKey = (key: string | undefined): string | null => (
    key && key.startsWith(LAUNCHER_WIDGET_ITEM_PREFIX)
        ? key.slice(LAUNCHER_WIDGET_ITEM_PREFIX.length) || null
        : null
);

const isFiniteNumber = (value: unknown): value is number => (
    typeof value === 'number' && Number.isFinite(value)
);

/**
 * 把持久化下来的任意内容洗成合法组件数组。
 * pageId 不在 validPageIds 里（页被删了 / 存档来自别的布局）的一律归到 fallbackPageId。
 */
export const normalizeLauncherUserWidgets = (
    raw: unknown,
    validPageIds: readonly string[] = [],
    fallbackPageId?: string,
): LauncherUserWidget[] => {
    if (!Array.isArray(raw)) return [];
    const allowed = new Set(validPageIds);
    const fallback = fallbackPageId || validPageIds[0];
    const seen = new Set<string>();
    const result: LauncherUserWidget[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Partial<LauncherUserWidget>;
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        if (!id || seen.has(id)) continue;
        if (!isLauncherWidgetSize(candidate.size)) continue;
        let pageId = typeof candidate.pageId === 'string' ? candidate.pageId : '';
        if (allowed.size > 0 && !allowed.has(pageId)) {
            if (!fallback) continue;
            pageId = fallback;
        }
        if (!pageId) continue;
        seen.add(id);
        result.push({
            id,
            pageId,
            size: candidate.size,
            pos: isFiniteNumber(candidate.pos) ? candidate.pos : result.length,
            ...(typeof candidate.image === 'string' && candidate.image ? { image: candidate.image } : {}),
            ...(candidate.fit === 'contain' ? { fit: 'contain' as const } : {}),
        });
    }
    return result;
};

export const launcherWidgetsForPage = (
    widgets: readonly LauncherUserWidget[],
    pageId: string,
): LauncherUserWidget[] => (
    widgets
        .filter(widget => widget.pageId === pageId)
        .sort((a, b) => (a.pos - b.pos) || a.id.localeCompare(b.id))
);

export type LauncherPageSlot =
    | { kind: 'app'; key: string; appId: string; sortKey: number }
    | { kind: 'widget'; key: string; widget: LauncherUserWidget; sortKey: number };

/**
 * 把一页的 App 和组件合成一条渲染顺序。
 * App 的排序键是它在 appIds 里的下标，组件用自己的 pos；同键时组件排在 App 前面
 * （因为「插到第 i 个 App 前面」正是拖放语义）。
 */
export const buildLauncherPageSlots = (
    page: Pick<LauncherPage, 'id' | 'appIds'>,
    widgets: readonly LauncherUserWidget[],
): LauncherPageSlot[] => {
    const slots: LauncherPageSlot[] = page.appIds.map((appId, index) => ({
        kind: 'app' as const,
        key: appId,
        appId,
        sortKey: index,
    }));
    for (const widget of launcherWidgetsForPage(widgets, page.id)) {
        slots.push({
            kind: 'widget',
            key: launcherWidgetItemKey(widget.id),
            widget,
            sortKey: widget.pos,
        });
    }
    return slots.sort((a, b) => {
        if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
        if (a.kind === b.kind) return a.key.localeCompare(b.key);
        return a.kind === 'widget' ? -1 : 1;
    });
};

/** 追加到某页末尾时用的排序键。 */
const appendPos = (page: Pick<LauncherPage, 'id' | 'appIds'>, widgets: readonly LauncherUserWidget[]): number => {
    const slots = buildLauncherPageSlots(page, widgets);
    const last = slots[slots.length - 1];
    return (last ? last.sortKey : -1) + 1;
};

let widgetSeq = 0;
export const createLauncherWidgetId = (): string => (
    `uw_${Date.now().toString(36)}_${(widgetSeq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`
);

export type LauncherWidgetMutation =
    | { ok: true; widgets: LauncherUserWidget[]; widget: LauncherUserWidget }
    | { ok: false; reason: string };

export const addLauncherUserWidget = (
    widgets: readonly LauncherUserWidget[],
    page: Pick<LauncherPage, 'id' | 'appIds'>,
    size: LauncherWidgetSize,
    options: { id?: string; image?: string; fit?: 'cover' | 'contain' } = {},
): LauncherWidgetMutation => {
    if (!isLauncherWidgetSize(size)) return { ok: false, reason: '不认识的组件尺寸' };
    if (launcherWidgetsForPage(widgets, page.id).length >= LAUNCHER_WIDGET_PAGE_LIMIT) {
        return { ok: false, reason: `一页最多放 ${LAUNCHER_WIDGET_PAGE_LIMIT} 个组件，先删一个再加` };
    }
    const widget: LauncherUserWidget = {
        id: options.id || createLauncherWidgetId(),
        pageId: page.id,
        size,
        pos: appendPos(page, widgets),
        ...(options.image ? { image: options.image } : {}),
        ...(options.fit === 'contain' ? { fit: 'contain' as const } : {}),
    };
    return { ok: true, widgets: [...widgets, widget], widget };
};

export const removeLauncherUserWidget = (
    widgets: readonly LauncherUserWidget[],
    id: string,
): LauncherUserWidget[] => widgets.filter(widget => widget.id !== id);

export const updateLauncherUserWidget = (
    widgets: readonly LauncherUserWidget[],
    id: string,
    patch: Partial<Pick<LauncherUserWidget, 'size' | 'image' | 'fit'>>,
): LauncherUserWidget[] => widgets.map(widget => {
    if (widget.id !== id) return widget;
    const next: LauncherUserWidget = { ...widget };
    if (patch.size !== undefined && isLauncherWidgetSize(patch.size)) next.size = patch.size;
    if ('image' in patch) {
        if (patch.image) next.image = patch.image;
        else delete next.image;
    }
    if ('fit' in patch) {
        if (patch.fit === 'contain') next.fit = 'contain';
        else delete next.fit;
    }
    return next;
});

/**
 * 把组件挪到目标页的某个位置。
 * target 给的是「落在谁身上」，语义是插到它前面；不给就丢到那一页末尾。
 */
export const moveLauncherUserWidget = (
    widgets: readonly LauncherUserWidget[],
    id: string,
    targetPage: Pick<LauncherPage, 'id' | 'appIds'>,
    targetKey?: string,
): LauncherWidgetMutation => {
    const moving = widgets.find(widget => widget.id === id);
    if (!moving) return { ok: false, reason: '组件不存在' };
    const others = widgets.filter(widget => widget.id !== id);
    if (
        moving.pageId !== targetPage.id
        && launcherWidgetsForPage(others, targetPage.id).length >= LAUNCHER_WIDGET_PAGE_LIMIT
    ) {
        return { ok: false, reason: `目标页最多放 ${LAUNCHER_WIDGET_PAGE_LIMIT} 个组件` };
    }
    const slots = buildLauncherPageSlots(targetPage, others);
    const targetIndex = targetKey ? slots.findIndex(slot => slot.key === targetKey) : -1;
    let pos: number;
    if (targetIndex < 0) {
        pos = appendPos(targetPage, others);
    } else {
        const previousKey = targetIndex > 0 ? slots[targetIndex - 1].sortKey : slots[targetIndex].sortKey - 1;
        pos = (previousKey + slots[targetIndex].sortKey) / 2;
    }
    const next: LauncherUserWidget = { ...moving, pageId: targetPage.id, pos };
    return { ok: true, widgets: [...others, next], widget: next };
};

/**
 * App 图标被拖到某个组件身上时，转译成「插到该组件后面那个 App 前面」。
 * 返回 undefined 表示这页组件后面没有 App 了，调用方按「追加到页尾」处理。
 */
export const appTargetAfterWidget = (
    page: Pick<LauncherPage, 'id' | 'appIds'>,
    widgets: readonly LauncherUserWidget[],
    widgetId: string,
): string | undefined => {
    const slots = buildLauncherPageSlots(page, widgets);
    const index = slots.findIndex(slot => slot.kind === 'widget' && slot.widget.id === widgetId);
    if (index < 0) return undefined;
    for (let i = index + 1; i < slots.length; i += 1) {
        const slot = slots[i];
        if (slot.kind === 'app') return slot.appId;
    }
    return undefined;
};

/** 旧固定槽位 → 新组件的尺寸映射。dsq 不在此列，它是风车页那格方图，保持原样。 */
const LEGACY_SLOT_SIZES: Record<string, LauncherWidgetSize> = {
    tl: '2x2',
    tr: '2x2',
    wide: '4x1',
};

export interface LegacyWidgetMigration {
    widgets: LauncherUserWidget[];
    /** 迁移后应写回 theme.launcherWidgets 的剩余槽位（只剩 dsq），空对象表示要清成 undefined。 */
    legacyWidgets: Record<string, string>;
}

/**
 * 一次性迁移：把外观定制里那三个固定槽位（tl / tr / wide）搬到用户组件列表。
 * 只在用户还没有任何自定义组件时执行；没东西可搬就返回 null。
 */
export const migrateLegacyLauncherWidgets = (
    legacy: Record<string, string> | undefined,
    existing: readonly LauncherUserWidget[],
    targetPageId: string,
): LegacyWidgetMigration | null => {
    if (!legacy || existing.length > 0) return null;
    const slots = Object.keys(LEGACY_SLOT_SIZES).filter(slot => !!legacy[slot]);
    if (slots.length === 0) return null;
    const widgets: LauncherUserWidget[] = slots.map((slot, index) => ({
        id: `uw_legacy_${slot}`,
        pageId: targetPageId,
        size: LEGACY_SLOT_SIZES[slot],
        image: legacy[slot],
        pos: -1 + index / slots.length,
    }));
    const legacyWidgets: Record<string, string> = {};
    for (const [key, value] of Object.entries(legacy)) {
        if (LEGACY_SLOT_SIZES[key]) continue;
        if (value) legacyWidgets[key] = value;
    }
    return { widgets, legacyWidgets };
};

// ── 自带风车组件（音乐卡片 / 方形图片）的移除与恢复 ──────────────────────
//
// 这两格是写死在风车页布局里的，以前没有任何入口能去掉。移除做成「隐藏 + 可恢复」
// 而不是从 launcherPinwheelOrder 里删掉：顺序还留着，恢复时能回到原来的位置。

export const LAUNCHER_BUILTIN_WIDGET_IDS: readonly LauncherBuiltinWidgetId[] = ['music', 'image'];

export const LAUNCHER_BUILTIN_WIDGET_LABELS: Record<LauncherBuiltinWidgetId, string> = {
    music: '音乐卡片',
    image: '方形图片',
};

export const LAUNCHER_BUILTIN_WIDGET_HINTS: Record<LauncherBuiltinWidgetId, string> = {
    music: '桌面第二页的「正在播放」卡片',
    image: '桌面第二页风车右下角那张方图',
};

export const isLauncherBuiltinWidgetId = (value: unknown): value is LauncherBuiltinWidgetId => (
    typeof value === 'string' && (LAUNCHER_BUILTIN_WIDGET_IDS as readonly string[]).includes(value)
);

export const normalizeHiddenBuiltinWidgets = (raw: unknown): LauncherBuiltinWidgetId[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<LauncherBuiltinWidgetId>();
    for (const value of raw) {
        if (isLauncherBuiltinWidgetId(value)) seen.add(value);
    }
    // 固定按 LAUNCHER_BUILTIN_WIDGET_IDS 的顺序输出，免得存档顺序不同就被当成「变了」。
    return LAUNCHER_BUILTIN_WIDGET_IDS.filter(id => seen.has(id));
};

export const hideLauncherBuiltinWidget = (
    hidden: readonly LauncherBuiltinWidgetId[],
    id: LauncherBuiltinWidgetId,
): LauncherBuiltinWidgetId[] => normalizeHiddenBuiltinWidgets([...hidden, id]);

export const restoreLauncherBuiltinWidget = (
    hidden: readonly LauncherBuiltinWidgetId[],
    id: LauncherBuiltinWidgetId,
): LauncherBuiltinWidgetId[] => normalizeHiddenBuiltinWidgets(hidden.filter(item => item !== id));

export const isLauncherBuiltinWidgetHidden = (
    hidden: readonly LauncherBuiltinWidgetId[],
    id: string,
): boolean => isLauncherBuiltinWidgetId(id) && hidden.includes(id);
