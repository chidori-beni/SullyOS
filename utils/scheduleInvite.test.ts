import { describe, expect, it } from 'vitest';
import type { DailySchedule } from '../types';
import {
    applyScheduleInviteToSchedule,
    getScheduleInviteEvents,
    normalizeScheduleInviteIds,
} from './scheduleInvite';

const schedule = (overrides: Partial<DailySchedule> = {}): DailySchedule => ({
    id: 'char-1_2099-08-24',
    charId: 'char-1',
    date: '2099-08-24',
    generatedAt: Date.now(),
    slots: [
        { startTime: '20:00', endTime: '21:00', activity: '晚间语音连麦', description: '线上聊聊今天', emoji: '🎧', withUser: true, inviteKind: 'voice' },
        { startTime: '22:00', activity: '自己看书', emoji: '📖', withUser: false },
    ],
    ...overrides,
});

describe('schedule invite', () => {
    it('only exposes future remote shared slots and gives them stable ids', () => {
        const normalized = normalizeScheduleInviteIds(schedule());
        const events = getScheduleInviteEvents(normalized, undefined, Date.now());

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            startTime: '20:00',
            endTime: '21:00',
            activity: '晚间语音连麦',
            kind: 'voice',
            slotIndex: 0,
        });
        expect(normalized.slots[0].inviteId).toContain('sinv_char-1_2099-08-24_2000');
    });

    it('marks accepted and declined events back onto the daily schedule', () => {
        const normalized = normalizeScheduleInviteIds(schedule());
        const events = getScheduleInviteEvents(normalized, undefined, Date.now());
        const updated = applyScheduleInviteToSchedule(normalized, events, []);

        expect(updated.slots[0].inviteStatus).toBe('declined');
        expect(updated.slots[0].withUser).toBe(true);

        const accepted = applyScheduleInviteToSchedule(normalized, events, [events[0].id]);
        expect(accepted.slots[0].inviteStatus).toBe('accepted');
    });
});
