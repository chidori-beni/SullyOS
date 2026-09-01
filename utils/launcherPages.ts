import { LauncherPage, LauncherPageLayout } from '../types';
import {
    LAUNCHER_GRID_APP_CAPACITY,
    LAUNCHER_HOME_APP_CAPACITY,
    LAUNCHER_PINWHEEL_APP_CAPACITY,
    paginateLauncherApps,
} from './launcherPagination';

export const LAUNCHER_HOME_PAGE_ID = 'launcher-home';
export const LAUNCHER_PINWHEEL_PAGE_ID = 'launcher-pinwheel';
export const LAUNCHER_MEDIA_PAGE_ID = 'launcher-media';
export const LAUNCHER_WIDGETS_PAGE_ID = 'launcher-widgets';
export const LAUNCHER_DOCK_CAPACITY = 4;

export type LauncherPageMutation =
    | { ok: true; layout: LauncherPageLayout }
    | { ok: false; layout: LauncherPageLayout; reason: string; neededSlots?: number };

const isLauncherPageKind = (value: unknown): value is LauncherPage['kind'] => (
    value === 'home' || value === 'pinwheel' || value === 'app'
);

const uniqueAvailableIds = (ids: readonly unknown[], available: readonly string[]): string[] => {
    const valid = new Set(available);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of ids) {
        if (typeof value !== 'string' || !valid.has(value) || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
};

const normalizeLegacyOrder = (
    legacyOrder: readonly string[] | undefined,
    available: readonly string[],
    excludedIds: ReadonlySet<string> = new Set(),
): string[] => {
    return uniqueAvailableIds([
        ...(Array.isArray(legacyOrder) ? legacyOrder : []),
        ...available,
    ], available).filter(id => !excludedIds.has(id));
};

const normalizeDockOrder = (
    dockOrder: readonly string[] | undefined,
    available: readonly string[],
    defaultDockIds: readonly string[] = [],
): string[] => uniqueAvailableIds(
    Array.isArray(dockOrder) ? dockOrder : defaultDockIds,
    available,
).slice(0, LAUNCHER_DOCK_CAPACITY);

const makeUniquePageId = (rawId: unknown, fallback: string, used: Set<string>): string => {
    const base = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : fallback;
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) suffix += 1;
    const next = `${base}-${suffix}`;
    used.add(next);
    return next;
};

export const getLauncherPageCapacity = (page: LauncherPage | LauncherPage['kind']): number => {
    const kind = typeof page === 'string' ? page : page.kind;
    if (kind === 'home') return LAUNCHER_HOME_APP_CAPACITY;
    if (kind === 'pinwheel') return LAUNCHER_PINWHEEL_APP_CAPACITY;
    return LAUNCHER_GRID_APP_CAPACITY;
};

export const launcherPageAcceptsApps = (page: LauncherPage | undefined): boolean => (
    !!page && isLauncherPageKind(page.kind)
);

export const flattenLauncherPageApps = (pages: readonly LauncherPage[]): string[] => (
    pages.flatMap(page => page.appIds)
);

const withLegacySnapshot = (pages: LauncherPage[], dockAppIds: readonly string[] = []): LauncherPageLayout => ({
    version: 1,
    pages,
    dockAppIds: [...dockAppIds],
    legacyDockOrder: [...dockAppIds],
    legacyAppOrder: flattenLauncherPageApps(pages),
});

const createAppPage = (id: string, appIds: string[] = [], showMedia = false): LauncherPage => ({
    id,
    kind: 'app',
    appIds,
    ...(showMedia ? { showMedia: true } : {}),
});

/**
 * Creates the v1 layout that visually matches the pre-page-management
 * launcher: 20 apps on home, 8 in the pinwheel, then regular 20-app pages.
 */
export const createLauncherPageLayout = (
    availableAppIds: readonly string[],
    legacyOrder?: readonly string[],
    options: {
        showMediaPage?: boolean;
        legacyDockOrder?: readonly string[];
        defaultDockIds?: readonly string[];
    } = {},
): LauncherPageLayout => {
    const dockAppIds = normalizeDockOrder(options.legacyDockOrder, availableAppIds, options.defaultDockIds);
    const ordered = normalizeLegacyOrder(legacyOrder, availableAppIds, new Set(dockAppIds));
    const groups = paginateLauncherApps(ordered, options.showMediaPage ? 3 : 2);
    const pages: LauncherPage[] = [
        { id: LAUNCHER_HOME_PAGE_ID, kind: 'home', appIds: groups[0] || [] },
        { id: LAUNCHER_PINWHEEL_PAGE_ID, kind: 'pinwheel', appIds: groups[1] || [] },
    ];
    groups.slice(2).forEach((appIds, index) => {
        pages.push(createAppPage(
            options.showMediaPage && index === 0 ? LAUNCHER_MEDIA_PAGE_ID : `launcher-app-${index}`,
            appIds,
            options.showMediaPage && index === 0,
        ));
    });
    return withLegacySnapshot(pages, dockAppIds);
};

const clonePages = (pages: readonly LauncherPage[]): LauncherPage[] => pages.map(page => ({
    ...page,
    appIds: [...page.appIds],
}));

/** Reflows a known app sequence into the existing page slots, adding regular pages only when needed. */
export const reflowLauncherPageApps = (
    pages: readonly LauncherPage[],
    appIds: readonly string[],
): LauncherPage[] => {
    const next = clonePages(pages);
    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const id of appIds) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        seen.add(id);
        uniqueIds.push(id);
    }

    let cursor = 0;
    for (const page of next) {
        const capacity = getLauncherPageCapacity(page);
        page.appIds = uniqueIds.slice(cursor, cursor + capacity);
        cursor += page.appIds.length;
    }

    const used = new Set(next.map(page => page.id));
    let pageNumber = next.filter(page => page.kind === 'app').length;
    while (cursor < uniqueIds.length) {
        const id = makeUniquePageId(`launcher-app-${pageNumber}`, `launcher-app-${pageNumber}`, used);
        const page = createAppPage(id, uniqueIds.slice(cursor, cursor + LAUNCHER_GRID_APP_CAPACITY));
        cursor += page.appIds.length;
        next.push(page);
        pageNumber += 1;
    }
    return next;
};

const appendMissingApps = (pages: LauncherPage[], missing: readonly string[]): LauncherPage[] => {
    const next = clonePages(pages);
    const used = new Set(next.map(page => page.id));
    let pageNumber = next.filter(page => page.kind === 'app').length;

    for (const appId of missing) {
        let targetIndex = -1;
        for (let index = next.length - 1; index >= 0; index -= 1) {
            const page = next[index];
            if (launcherPageAcceptsApps(page) && page.appIds.length < getLauncherPageCapacity(page)) {
                targetIndex = index;
                break;
            }
        }
        if (targetIndex < 0) {
            const id = makeUniquePageId(`launcher-app-${pageNumber}`, `launcher-app-${pageNumber}`, used);
            next.push(createAppPage(id, [appId]));
            pageNumber += 1;
        } else {
            next[targetIndex].appIds.push(appId);
        }
    }
    return next;
};

const hasValidSavedLayout = (saved: LauncherPageLayout | undefined): saved is LauncherPageLayout => (
    !!saved
    && saved.version === 1
    && Array.isArray(saved.pages)
);

/**
 * Reads both the new page model and the old flat order. Invalid or partial
 * saved pages are repaired without silently dropping an available App.
 */
export const normalizeLauncherPageLayout = (
    saved: LauncherPageLayout | undefined,
    availableAppIds: readonly string[],
    legacyOrder?: readonly string[],
    options: {
        showMediaPage?: boolean;
        legacyDockOrder?: readonly string[];
        defaultDockIds?: readonly string[];
    } = {},
): LauncherPageLayout => {
    if (!hasValidSavedLayout(saved)) {
        return createLauncherPageLayout(availableAppIds, legacyOrder, options);
    }

    // A saved dockAppIds array, including [], is authoritative. If a legacy
    // client changed launcherDockOrder after this layout was saved, the
    // snapshot lets that older edit win once, just like legacyAppOrder below.
    const savedDockSnapshot = Array.isArray(saved.legacyDockOrder)
        ? normalizeDockOrder(saved.legacyDockOrder, availableAppIds)
        : undefined;
    const currentLegacyDock = Array.isArray(options.legacyDockOrder)
        ? normalizeDockOrder(options.legacyDockOrder, availableAppIds)
        : undefined;
    const dockWasEditedByOlderClient = !!savedDockSnapshot
        && !!currentLegacyDock
        && savedDockSnapshot.join('\u0000') !== currentLegacyDock.join('\u0000');
    const savedDockOrder = dockWasEditedByOlderClient
        ? currentLegacyDock
        : Array.isArray(saved.dockAppIds)
            ? saved.dockAppIds
            : options.legacyDockOrder;
    const dockAppIds = normalizeDockOrder(savedDockOrder, availableAppIds, options.defaultDockIds);
    const usedPageIds = new Set<string>();
    const claimedApps = new Set<string>(dockAppIds);
    let home: LauncherPage | undefined;
    let pinwheel: LauncherPage | undefined;
    const rest: LauncherPage[] = [];

    for (let index = 0; index < saved.pages.length; index += 1) {
        const raw = saved.pages[index] as Partial<LauncherPage> | null;
        if (!raw || typeof raw !== 'object') continue;
        const originalKind = isLauncherPageKind(raw.kind) ? raw.kind : 'app';
        const isFirstSpecial = originalKind === 'home' ? !home : originalKind === 'pinwheel' ? !pinwheel : false;
        const kind = isFirstSpecial ? originalKind : (originalKind === 'home' || originalKind === 'pinwheel' ? 'app' : originalKind);
        const specialId = kind === 'home'
            ? LAUNCHER_HOME_PAGE_ID
            : kind === 'pinwheel'
                ? LAUNCHER_PINWHEEL_PAGE_ID
                : undefined;
        const id = makeUniquePageId(specialId || raw.id, `launcher-app-${index}`, usedPageIds);
        const rawIds = Array.isArray(raw.appIds) ? raw.appIds : [];
        const appIds = uniqueAvailableIds(rawIds.filter(idValue => {
            if (typeof idValue !== 'string' || claimedApps.has(idValue)) return false;
            claimedApps.add(idValue);
            return true;
        }), availableAppIds);
        const page: LauncherPage = {
            id,
            kind,
            appIds,
            ...(kind === 'app' && raw.showMedia ? { showMedia: true } : {}),
        };
        if (kind === 'home') home = page;
        else if (kind === 'pinwheel') pinwheel = page;
        else rest.push(page);
    }

    if (!home) {
        home = { id: makeUniquePageId(LAUNCHER_HOME_PAGE_ID, LAUNCHER_HOME_PAGE_ID, usedPageIds), kind: 'home', appIds: [] };
    }
    if (!pinwheel) {
        pinwheel = { id: makeUniquePageId(LAUNCHER_PINWHEEL_PAGE_ID, LAUNCHER_PINWHEEL_PAGE_ID, usedPageIds), kind: 'pinwheel', appIds: [] };
    }

    // Home is the launch page. The pinwheel keeps its saved relative position
    // among the remaining pages, but can never precede home.
    const pages: LauncherPage[] = [home, ...rest];
    const pinwheelIndex = saved.pages.findIndex(page => page?.kind === 'pinwheel');
    const desiredPinwheelPosition = pinwheelIndex < 0
        ? 1
        : Math.max(1, Math.min(pages.length, pinwheelIndex));
    pages.splice(Math.min(desiredPinwheelPosition, pages.length), 0, pinwheel);

    const pageAppIds = flattenLauncherPageApps(pages);
    const dockIds = new Set(dockAppIds);
    const currentLegacy = normalizeLegacyOrder(legacyOrder, availableAppIds, dockIds);
    const savedLegacy = Array.isArray(saved.legacyAppOrder)
        ? normalizeLegacyOrder(saved.legacyAppOrder, availableAppIds, dockIds)
        : undefined;
    const legacyWasEditedByOlderClient = !!savedLegacy
        && Array.isArray(legacyOrder)
        && currentLegacy.join('\u0000') !== savedLegacy.join('\u0000');
    const overCapacity = pages.some(page => page.appIds.length > getLauncherPageCapacity(page));

    let nextPages: LauncherPage[];
    if (legacyWasEditedByOlderClient) {
        nextPages = reflowLauncherPageApps(pages, currentLegacy);
    } else if (overCapacity) {
        nextPages = reflowLauncherPageApps(pages, pageAppIds);
    } else {
        const missing = currentLegacy.filter(appId => !claimedApps.has(appId));
        nextPages = appendMissingApps(pages, missing);
    }

    if (options.showMediaPage && !nextPages.some(page => page.kind === 'app' && page.showMedia)) {
        const firstAppPage = nextPages.find(page => page.kind === 'app');
        if (firstAppPage) firstAppPage.showMedia = true;
        else nextPages.push(createAppPage(LAUNCHER_MEDIA_PAGE_ID, [], true));
    }

    return withLegacySnapshot(nextPages, dockAppIds);
};

export const projectLauncherLayoutToLegacy = (layout: LauncherPageLayout): { appOrder: string[]; dockOrder: string[] } => ({
    appOrder: flattenLauncherPageApps(layout.pages),
    dockOrder: [...(layout.dockAppIds || [])],
});

const launcherDockIds = (layout: LauncherPageLayout): string[] => [...(layout.dockAppIds || [])];

/** Moves a Dock App to a page, swapping with a page App when that page is full. */
export const moveLauncherDockAppToPage = (
    layout: LauncherPageLayout,
    dockAppId: string,
    targetPageId: string,
    targetAppId?: string,
): LauncherPageMutation => {
    const next = clonePages(layout.pages);
    const dockAppIds = launcherDockIds(layout);
    const target = next.find(page => page.id === targetPageId);
    const dockIndex = dockAppIds.indexOf(dockAppId);
    if (!target || !launcherPageAcceptsApps(target) || dockIndex < 0) {
        return { ok: false, layout, reason: '这个位置不能放置 App' };
    }
    if (target.appIds.includes(dockAppId)) {
        return { ok: false, layout, reason: '这个 App 已经在目标页面' };
    }
    if (targetAppId && !target.appIds.includes(targetAppId)) {
        return { ok: false, layout, reason: '目标 App 已经离开当前页面' };
    }

    const capacity = getLauncherPageCapacity(target);
    const targetIndex = targetAppId ? target.appIds.indexOf(targetAppId) : target.appIds.length;
    if (target.appIds.length >= capacity && !targetAppId) {
        return { ok: false, layout, reason: '目标页面已满，请拖到具体 App 上交换' };
    }

    dockAppIds.splice(dockIndex, 1);
    if (target.appIds.length < capacity) {
        target.appIds.splice(targetIndex, 0, dockAppId);
    } else {
        const displacedAppId = target.appIds[targetIndex];
        target.appIds[targetIndex] = dockAppId;
        dockAppIds.splice(dockIndex, 0, displacedAppId);
    }
    return { ok: true, layout: withLegacySnapshot(next, dockAppIds) };
};

/** Moves a page App into Dock, or swaps with a specific Dock App when full. */
export const moveLauncherPageAppToDock = (
    layout: LauncherPageLayout,
    sourcePageId: string,
    appId: string,
    targetDockAppId?: string,
): LauncherPageMutation => {
    const next = clonePages(layout.pages);
    const dockAppIds = launcherDockIds(layout);
    const source = next.find(page => page.id === sourcePageId);
    const sourceIndex = source?.appIds.indexOf(appId) ?? -1;
    if (!source || !launcherPageAcceptsApps(source) || sourceIndex < 0) {
        return { ok: false, layout, reason: '没有找到要移动的 App' };
    }
    if (dockAppIds.includes(appId)) {
        return { ok: false, layout, reason: '这个 App 已经在 Dock' };
    }

    const dockIndex = targetDockAppId ? dockAppIds.indexOf(targetDockAppId) : -1;
    if (targetDockAppId && dockIndex < 0) {
        return { ok: false, layout, reason: '目标 Dock App 已经离开当前 Dock' };
    }
    if (!targetDockAppId && dockAppIds.length >= LAUNCHER_DOCK_CAPACITY) {
        return { ok: false, layout, reason: 'Dock 已满，请拖到具体 Dock App 上交换' };
    }

    source.appIds.splice(sourceIndex, 1);
    if (targetDockAppId) {
        const displacedAppId = dockAppIds[dockIndex];
        dockAppIds[dockIndex] = appId;
        source.appIds.splice(Math.min(sourceIndex, source.appIds.length), 0, displacedAppId);
    } else {
        dockAppIds.push(appId);
    }
    return { ok: true, layout: withLegacySnapshot(next, dockAppIds) };
};

/** Reorders two concrete Dock slots while keeping the page layout authoritative. */
export const reorderLauncherDockApps = (
    layout: LauncherPageLayout,
    sourceDockAppId: string,
    targetDockAppId: string,
): LauncherPageMutation => {
    if (sourceDockAppId === targetDockAppId) return { ok: true, layout };
    const dockAppIds = launcherDockIds(layout);
    const sourceIndex = dockAppIds.indexOf(sourceDockAppId);
    const targetIndex = dockAppIds.indexOf(targetDockAppId);
    if (sourceIndex < 0 || targetIndex < 0) {
        return { ok: false, layout, reason: 'Dock App 不存在' };
    }
    const nextDockAppIds = [...dockAppIds];
    const [moved] = nextDockAppIds.splice(sourceIndex, 1);
    nextDockAppIds.splice(targetIndex, 0, moved);
    return { ok: true, layout: withLegacySnapshot(clonePages(layout.pages), nextDockAppIds) };
};

/**
 * Moves an App before another App or to the end of a page. When the target is
 * full, reflowing the fixed-capacity slots provides iOS-like push behaviour.
 */
export const moveLauncherApp = (
    layout: LauncherPageLayout,
    sourcePageId: string,
    appId: string,
    targetPageId: string,
    targetAppId?: string,
): LauncherPageMutation => {
    const next = clonePages(layout.pages);
    const source = next.find(page => page.id === sourcePageId);
    const target = next.find(page => page.id === targetPageId);
    if (!source || !target || !launcherPageAcceptsApps(source) || !launcherPageAcceptsApps(target)) {
        return { ok: false, layout, reason: '这个位置不能放置 App' };
    }
    const sourceIndex = source.appIds.indexOf(appId);
    if (sourceIndex < 0) return { ok: false, layout, reason: '没有找到要移动的 App' };
    if (targetAppId === appId) return { ok: true, layout };

    source.appIds.splice(sourceIndex, 1);
    if (targetAppId && !target.appIds.includes(targetAppId)) {
        return { ok: false, layout, reason: '目标 App 已经离开当前页面' };
    }
    const targetIndex = targetAppId ? target.appIds.indexOf(targetAppId) : target.appIds.length;
    target.appIds.splice(targetIndex, 0, appId);

    const targetOverCapacity = target.appIds.length > getLauncherPageCapacity(target);
    const resultPages = targetOverCapacity
        ? reflowLauncherPageApps(next, flattenLauncherPageApps(next))
        : next;
    return { ok: true, layout: withLegacySnapshot(resultPages, layout.dockAppIds) };
};

export const reorderLauncherPages = (
    layout: LauncherPageLayout,
    sourcePageId: string,
    targetPageId: string,
): LauncherPageMutation => {
    if (sourcePageId === targetPageId) return { ok: true, layout };
    const next = clonePages(layout.pages);
    const sourceIndex = next.findIndex(page => page.id === sourcePageId);
    if (sourceIndex < 0) return { ok: false, layout, reason: '页面不存在' };
    if (next[sourceIndex].kind === 'home') return { ok: false, layout, reason: '主页固定在第一页' };

    const [moved] = next.splice(sourceIndex, 1);
    // Widgets is a synthetic page rendered after the persisted list. It is a
    // useful, visible end-drop target while remaining fixed in the last slot.
    if (targetPageId === LAUNCHER_WIDGETS_PAGE_ID) {
        next.push(moved);
        return { ok: true, layout: withLegacySnapshot(next, layout.dockAppIds) };
    }

    const targetIndex = next.findIndex(page => page.id === targetPageId);
    if (targetIndex < 0) return { ok: false, layout, reason: '页面不存在' };
    const adjustedTargetIndex = next.findIndex(page => page.id === targetPageId);
    const insertIndex = next[adjustedTargetIndex]?.kind === 'home'
        ? 1
        : Math.max(1, adjustedTargetIndex);
    next.splice(Math.min(insertIndex, next.length), 0, moved);
    return { ok: true, layout: withLegacySnapshot(next, layout.dockAppIds) };
};

export const addLauncherAppPage = (
    layout: LauncherPageLayout,
    pageId: string,
): LauncherPageMutation => {
    if (!pageId.trim()) return { ok: false, layout, reason: '新页面缺少身份' };
    const next = clonePages(layout.pages);
    if (next.some(page => page.id === pageId)) return { ok: false, layout, reason: '页面身份重复' };
    next.push(createAppPage(pageId));
    return { ok: true, layout: withLegacySnapshot(next, layout.dockAppIds) };
};

export const canDeleteLauncherAppPage = (
    layout: LauncherPageLayout,
    pageId: string,
): { ok: boolean; reason?: string; neededSlots?: number } => {
    const page = layout.pages.find(item => item.id === pageId);
    if (!page) return { ok: false, reason: '页面不存在' };
    if (page.kind !== 'app') return { ok: false, reason: '主页和快捷页不能删除' };

    const remainingPages = layout.pages.filter(item => item.id !== pageId);
    const remainingAppCount = flattenLauncherPageApps(remainingPages).length;
    const remainingCapacity = remainingPages.reduce((sum, item) => sum + getLauncherPageCapacity(item), 0);
    if (remainingAppCount > remainingCapacity) {
        return {
            ok: false,
            reason: '其他页面没有足够空间安置这一页的 App',
            neededSlots: remainingAppCount - remainingCapacity,
        };
    }
    return { ok: true };
};

export const deleteLauncherAppPage = (
    layout: LauncherPageLayout,
    pageId: string,
): LauncherPageMutation => {
    const check = canDeleteLauncherAppPage(layout, pageId);
    if (!check.ok) return { ok: false, layout, reason: check.reason || '页面不能删除', neededSlots: check.neededSlots };
    const next = layout.pages.filter(page => page.id !== pageId);
    const reflowed = reflowLauncherPageApps(next, flattenLauncherPageApps(next));
    return { ok: true, layout: withLegacySnapshot(reflowed, layout.dockAppIds) };
};
