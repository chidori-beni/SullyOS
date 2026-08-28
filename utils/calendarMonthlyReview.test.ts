import { describe, expect, it } from 'vitest';
import type { Anniversary, Task } from '../types';
import { buildMonthlyReviewStats, chooseMonthlyMessageCharacterId } from './calendarMonthlyReview';

const task = (id: string, deadline: string, completed: boolean, supervisorId = 'sully'): Task => ({
    id, title: id, deadline, supervisorId, tone: 'gentle', isCompleted: completed, createdAt: new Date(`${deadline}T08:00:00`).getTime(),
});

describe('calendar monthly review', () => {
    it('counts mood shares, repeated events, and monthly completion rate', () => {
        const events: Anniversary[] = [{
            id: 'class', title: '上课', date: '2026-08-03', charId: '', kind: 'event',
            repeat: { type: 'weekly', weekdays: [1] },
        }];
        const stats = buildMonthlyReviewStats({
            monthKey: '2026-08',
            moods: { '2026-08-01': 'happy', '2026-08-02': 'happy', '2026-08-03': 'tired' },
            tasks: [task('a', '2026-08-01', true), task('b', '2026-08-02', false), task('outside', '2026-07-31', true)],
            events,
        });
        expect(stats.topMoods[0]).toEqual({ id: 'happy', count: 2, percent: 67 });
        expect(stats.eventCount).toBe(5);
        expect(stats.mostFrequentEvent).toBe('上课');
        expect(stats.completionRate).toBe(50);
    });

    it('prefers the character connected to the most monthly activity', () => {
        expect(chooseMonthlyMessageCharacterId({
            characterIds: ['sully', 'mori'], activeCharacterId: 'sully', monthKey: '2026-08',
            tasks: [task('a', '2026-08-01', true, 'sully')],
            events: [{ id: 'e', title: '见面', date: '2026-08-12', charId: 'mori' }],
        })).toBe('mori');
    });

    it('counts an older linked repeating event when choosing the letter writer', () => {
        expect(chooseMonthlyMessageCharacterId({
            characterIds: ['sully', 'mori'], activeCharacterId: 'sully', monthKey: '2026-08', tasks: [],
            events: [{ id: 'weekly', title: '上课', date: '2026-07-06', charId: 'mori', repeat: { type: 'weekly', weekdays: [1] } }],
        })).toBe('mori');
    });
});
