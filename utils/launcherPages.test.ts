import { describe, expect, it } from 'vitest';
import {
    LAUNCHER_DOCK_CAPACITY,
    LAUNCHER_HOME_PAGE_ID,
    LAUNCHER_PINWHEEL_PAGE_ID,
    LAUNCHER_WIDGETS_PAGE_ID,
    addLauncherAppPage,
    canDeleteLauncherAppPage,
    createLauncherPageLayout,
    deleteLauncherAppPage,
    flattenLauncherPageApps,
    moveLauncherApp,
    moveLauncherDockAppToPage,
    moveLauncherPageAppToDock,
    normalizeLauncherPageLayout,
    reorderLauncherDockApps,
    reorderLauncherPages,
} from './launcherPages';

const apps = (count: number) => Array.from({ length: count }, (_, index) => `app-${index}`);
const dockApps = ['dock-0', 'dock-1', 'dock-2', 'dock-3'];

const makeDockLayout = (appCount = 29, dockIds: readonly string[] = dockApps) => {
    const available = [...dockIds, ...apps(appCount)];
    return createLauncherPageLayout(available, apps(appCount), {
        legacyDockOrder: dockIds,
        defaultDockIds: dockIds,
    });
};

const expectCompleteLayout = (layout: ReturnType<typeof createLauncherPageLayout>, available: readonly string[]) => {
    const placed = [...(layout.dockAppIds || []), ...flattenLauncherPageApps(layout.pages)];
    expect(layout.dockAppIds?.length || 0).toBeLessThanOrEqual(LAUNCHER_DOCK_CAPACITY);
    expect(new Set(placed).size).toBe(available.length);
    expect(placed).toEqual(expect.arrayContaining([...available]));
};

describe('launcher page layout migration and invariants', () => {
    it('migrates the old flat order into home, pinwheel and regular pages', () => {
        const source = apps(49);
        const layout = normalizeLauncherPageLayout(undefined, source, source);

        expect(layout.pages.map(page => page.appIds.length)).toEqual([20, 8, 20, 1]);
        expect(layout.pages.map(page => page.kind)).toEqual(['home', 'pinwheel', 'app', 'app']);
        expect(flattenLauncherPageApps(layout.pages)).toEqual(source);
        expect(new Set(flattenLauncherPageApps(layout.pages)).size).toBe(source.length);
    });

    it('keeps an explicitly added empty page across normalization', () => {
        const base = createLauncherPageLayout(apps(27), apps(27));
        const added = addLauncherAppPage(base, 'my-empty-page');
        expect(added.ok).toBe(true);
        if (!added.ok) return;

        const restored = normalizeLauncherPageLayout(added.layout, apps(27), added.layout.legacyAppOrder);
        expect(restored.pages.at(-1)).toMatchObject({ id: 'my-empty-page', kind: 'app', appIds: [] });
    });

    it('filters duplicate and unavailable app ids without dropping available ones', () => {
        const restored = normalizeLauncherPageLayout({
            version: 1,
            pages: [
                { id: LAUNCHER_HOME_PAGE_ID, kind: 'home', appIds: ['app-0', 'app-0', 'removed'] },
                { id: LAUNCHER_PINWHEEL_PAGE_ID, kind: 'pinwheel', appIds: ['app-1'] },
            ],
        }, apps(3), apps(3));

        expect(flattenLauncherPageApps(restored.pages)).toEqual(['app-0', 'app-1', 'app-2']);
    });
});

describe('launcher app movement', () => {
    it('moves an App from home to an empty page', () => {
        const base = createLauncherPageLayout(apps(27), apps(27));
        const added = addLauncherAppPage(base, 'empty');
        if (!added.ok) throw new Error(added.reason);

        const result = moveLauncherApp(added.layout, LAUNCHER_HOME_PAGE_ID, 'app-0', 'empty');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.pages.find(page => page.id === LAUNCHER_HOME_PAGE_ID)?.appIds).not.toContain('app-0');
        expect(result.layout.pages.find(page => page.id === 'empty')?.appIds).toEqual(['app-0']);
        expect(new Set(flattenLauncherPageApps(result.layout.pages)).size).toBe(27);
    });

    it('reflows fixed-capacity slots when dropping into a full pinwheel', () => {
        const base = createLauncherPageLayout(apps(29), apps(29));
        const result = moveLauncherApp(base, LAUNCHER_HOME_PAGE_ID, 'app-0', LAUNCHER_PINWHEEL_PAGE_ID, 'app-20');
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.layout.pages.map(page => page.appIds.length)).toEqual([20, 8, 1]);
        expect(flattenLauncherPageApps(result.layout.pages)).toContain('app-0');
        expect(new Set(flattenLauncherPageApps(result.layout.pages)).size).toBe(29);
    });

    it('can append to a page background and keeps the source item unique', () => {
        const base = createLauncherPageLayout(apps(21), apps(21));
        const result = moveLauncherApp(base, LAUNCHER_PINWHEEL_PAGE_ID, 'app-20', LAUNCHER_HOME_PAGE_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(flattenLauncherPageApps(result.layout.pages).filter(id => id === 'app-20')).toHaveLength(1);
    });
});

describe('launcher page management', () => {
    it('reorders pages by stable page id while keeping home first', () => {
        const base = createLauncherPageLayout(apps(49), apps(49));
        const appPage = base.pages.find(page => page.kind === 'app')?.id;
        if (!appPage) throw new Error('missing app page');

        const result = reorderLauncherPages(base, appPage, LAUNCHER_PINWHEEL_PAGE_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.pages[0].kind).toBe('home');
        expect(result.layout.pages.map(page => page.id)).toEqual([
            LAUNCHER_HOME_PAGE_ID,
            appPage,
            LAUNCHER_PINWHEEL_PAGE_ID,
            ...base.pages.filter(page => page.id !== LAUNCHER_HOME_PAGE_ID && page.id !== LAUNCHER_PINWHEEL_PAGE_ID && page.id !== appPage).map(page => page.id),
        ]);
    });

    it('can move an ordinary page to the final slot before fixed Widgets', () => {
        const base = createLauncherPageLayout(apps(69), apps(69));
        const firstAppPage = base.pages.find(page => page.kind === 'app')?.id;
        if (!firstAppPage) throw new Error('missing app page');

        const result = reorderLauncherPages(base, firstAppPage, LAUNCHER_WIDGETS_PAGE_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.pages.at(-1)?.id).toBe(firstAppPage);
        expect(result.layout.pages[0].kind).toBe('home');
    });

    it('deletes an ordinary page and preserves all remaining apps', () => {
        const base = createLauncherPageLayout(apps(49), apps(49));
        const lastPage = base.pages[base.pages.length - 1];
        expect(canDeleteLauncherAppPage(base, lastPage.id).ok).toBe(true);
        const result = deleteLauncherAppPage(base, lastPage.id);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.pages.some(page => page.id === lastPage.id)).toBe(false);
        expect(flattenLauncherPageApps(result.layout.pages)).toEqual(apps(49).slice(0, -1));
    });

    it('refuses to delete the protected pages', () => {
        const base = createLauncherPageLayout(apps(27), apps(27));
        expect(canDeleteLauncherAppPage(base, LAUNCHER_HOME_PAGE_ID).ok).toBe(false);
        expect(canDeleteLauncherAppPage(base, LAUNCHER_PINWHEEL_PAGE_ID).ok).toBe(false);
    });
});

describe('launcher Dock/page movement', () => {
    it('migrates the default Dock out of page slots and preserves an explicit empty Dock', () => {
        const available = [...dockApps, ...apps(5)];
        const migrated = normalizeLauncherPageLayout(undefined, available, available, {
            defaultDockIds: dockApps,
        });
        expect(migrated.dockAppIds).toEqual(dockApps);
        expect(flattenLauncherPageApps(migrated.pages)).not.toEqual(expect.arrayContaining(dockApps));
        expectCompleteLayout(migrated, available);

        const emptied = normalizeLauncherPageLayout({ ...migrated, dockAppIds: [] }, available, apps(5), {
            legacyDockOrder: dockApps,
            defaultDockIds: dockApps,
        });
        expect(emptied.dockAppIds).toEqual([]);
        expectCompleteLayout(emptied, available);
    });

    it('accepts a Dock order changed by an older client when the snapshot differs', () => {
        const available = [...dockApps, ...apps(5)];
        const legacyDockOrder = ['dock-2', 'dock-0', 'dock-1', 'dock-3'];
        const restored = normalizeLauncherPageLayout(
            makeDockLayout(5),
            available,
            apps(5),
            { legacyDockOrder, defaultDockIds: dockApps },
        );
        expect(restored.dockAppIds).toEqual(legacyDockOrder);
        expect(restored.legacyDockOrder).toEqual(legacyDockOrder);
        expectCompleteLayout(restored, available);
    });

    it('moves a Dock App into an empty page and keeps every App unique', () => {
        const available = [...dockApps, ...apps(29)];
        const base = makeDockLayout(29);
        const added = addLauncherAppPage(base, 'empty');
        if (!added.ok) throw new Error(added.reason);

        const result = moveLauncherDockAppToPage(added.layout, 'dock-0', 'empty');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.dockAppIds).toEqual(['dock-1', 'dock-2', 'dock-3']);
        expect(result.layout.pages.find(page => page.id === 'empty')?.appIds).toEqual(['dock-0']);
        expectCompleteLayout(result.layout, available);
    });

    it('swaps a Dock App with a concrete App when the target page is full', () => {
        const available = [...dockApps, ...apps(29)];
        const result = moveLauncherDockAppToPage(makeDockLayout(29), 'dock-0', LAUNCHER_HOME_PAGE_ID, 'app-1');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.dockAppIds).toEqual(['app-1', 'dock-1', 'dock-2', 'dock-3']);
        expect(result.layout.pages[0].appIds[1]).toBe('dock-0');
        expectCompleteLayout(result.layout, available);
    });

    it('moves a page App into a Dock with room and preserves the layout projection', () => {
        const available = ['dock-0', 'dock-1', ...apps(5)];
        const result = moveLauncherPageAppToDock(makeDockLayout(5, ['dock-0', 'dock-1']), LAUNCHER_HOME_PAGE_ID, 'app-0');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.dockAppIds).toEqual(['dock-0', 'dock-1', 'app-0']);
        expect(result.layout.legacyAppOrder).toEqual(flattenLauncherPageApps(result.layout.pages));
        expectCompleteLayout(result.layout, available);
    });

    it('swaps a page App with a concrete Dock App when Dock is full', () => {
        const available = [...dockApps, ...apps(5)];
        const result = moveLauncherPageAppToDock(makeDockLayout(5), LAUNCHER_HOME_PAGE_ID, 'app-0', 'dock-1');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.layout.dockAppIds).toEqual(['dock-0', 'app-0', 'dock-2', 'dock-3']);
        expect(result.layout.pages[0].appIds[0]).toBe('dock-1');
        expectCompleteLayout(result.layout, available);
    });

    it('rejects a full Dock/page background drop but supports Dock reordering', () => {
        const base = makeDockLayout(29);
        const rejected = moveLauncherPageAppToDock(base, LAUNCHER_HOME_PAGE_ID, 'app-0');
        expect(rejected.ok).toBe(false);
        expect(rejected.layout).toBe(base);

        const reordered = reorderLauncherDockApps(base, 'dock-0', 'dock-2');
        expect(reordered.ok).toBe(true);
        if (!reordered.ok) return;
        expect(reordered.layout.dockAppIds).toEqual(['dock-1', 'dock-2', 'dock-0', 'dock-3']);
        expectCompleteLayout(reordered.layout, [...dockApps, ...apps(29)]);
    });
});
