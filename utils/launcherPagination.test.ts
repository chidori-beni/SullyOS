import { describe, expect, it } from 'vitest';
import {
    LAUNCHER_HOME_APP_CAPACITY,
    LAUNCHER_PINWHEEL_APP_CAPACITY,
    paginateLauncherApps,
} from './launcherPagination';

const apps = (count: number) => Array.from({ length: count }, (_, index) => `app-${index}`);

describe('paginateLauncherApps', () => {
    it('keeps the home page at twenty apps and the pinwheel at eight', () => {
        const pages = paginateLauncherApps(apps(28));

        expect(pages.map(page => page.length)).toEqual([LAUNCHER_HOME_APP_CAPACITY, LAUNCHER_PINWHEEL_APP_CAPACITY]);
        expect(pages.flat()).toEqual(apps(28));
    });

    it('puts later apps on regular twenty-app pages without dropping or duplicating any', () => {
        const source = apps(69);
        const pages = paginateLauncherApps(source);

        expect(pages.map(page => page.length)).toEqual([20, 8, 20, 20, 1]);
        expect(pages.flat()).toEqual(source);
        expect(new Set(pages.flat()).size).toBe(source.length);
    });

    it('keeps the special pages available for a short or empty app list', () => {
        expect(paginateLauncherApps([])).toEqual([[], []]);
        expect(paginateLauncherApps(apps(1))).toEqual([['app-0'], []]);
        expect(paginateLauncherApps([], 3)).toEqual([[], [], []]);
    });
});
