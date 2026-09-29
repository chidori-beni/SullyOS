import { beforeEach, describe, expect, it } from 'vitest';
import { CINEMA_PRESENCE_IDLE_MS, endCinemaPresence, getActiveCinemaPresence, touchCinemaPresence } from './cinemaPresence';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
};

describe('正在一起看的标记', () => {
    beforeEach(() => store.clear());

    it('进放映室就算在看，说话会续上，开场时间不变', () => {
        touchCinemaPresence('c1', { id: 's1', title: '钟表馆事件' }, 1000);
        touchCinemaPresence('c1', { id: 's1', title: '钟表馆事件' }, 5000);
        expect(getActiveCinemaPresence('c1', 6000)).toMatchObject({ sessionId: 's1', startedAt: 1000, lastActiveAt: 5000 });
    });

    it('太久没说话就当作散了，并清掉', () => {
        touchCinemaPresence('c1', { id: 's1', title: 'x' }, 0);
        expect(getActiveCinemaPresence('c1', CINEMA_PRESENCE_IDLE_MS + 1)).toBeNull();
        expect(store.size).toBe(0);
    });

    it('散场只清同一场', () => {
        touchCinemaPresence('c1', { id: 's2', title: 'x' }, 0);
        endCinemaPresence('c1', 's1');
        expect(getActiveCinemaPresence('c1', 1)).not.toBeNull();
        endCinemaPresence('c1', 's2');
        expect(getActiveCinemaPresence('c1', 1)).toBeNull();
    });

    it('各个角色互不影响', () => {
        touchCinemaPresence('c1', { id: 's1', title: 'x' }, 0);
        expect(getActiveCinemaPresence('c2', 1)).toBeNull();
    });
});
