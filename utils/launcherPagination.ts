/**
 * Keep the first launcher page compact enough for its clock and character card,
 * while still letting the pinwheel page carry its two 2x2 app groups.
 *
 * The returned arrays are ordered slices of the input. Keeping this rule in a
 * small pure helper makes it harder for a new app to disappear when the
 * special pinwheel page and the regular grid pages are both involved.
 */
export const LAUNCHER_HOME_APP_CAPACITY = 20;
export const LAUNCHER_PINWHEEL_APP_CAPACITY = 8;
export const LAUNCHER_GRID_APP_CAPACITY = 20;
export const LAUNCHER_MIN_APP_PAGES = 2;

export const paginateLauncherApps = <T>(
    apps: readonly T[],
    minimumPages = LAUNCHER_MIN_APP_PAGES,
): T[][] => {
    const pages: T[][] = [
        apps.slice(0, LAUNCHER_HOME_APP_CAPACITY),
        apps.slice(
            LAUNCHER_HOME_APP_CAPACITY,
            LAUNCHER_HOME_APP_CAPACITY + LAUNCHER_PINWHEEL_APP_CAPACITY,
        ),
    ];

    for (
        let start = LAUNCHER_HOME_APP_CAPACITY + LAUNCHER_PINWHEEL_APP_CAPACITY;
        start < apps.length;
        start += LAUNCHER_GRID_APP_CAPACITY
    ) {
        pages.push(apps.slice(start, start + LAUNCHER_GRID_APP_CAPACITY));
    }

    while (pages.length < Math.max(LAUNCHER_MIN_APP_PAGES, Math.trunc(minimumPages))) pages.push([]);
    return pages;
};
