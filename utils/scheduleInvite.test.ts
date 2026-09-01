import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailySchedule, Message } from '../types';
import { DB } from './db';
import {
    applyScheduleInviteToSchedule,
    ensureScheduleInviteMessage,
    getScheduleInviteEvents,
    getScheduleInviteEventsFingerprint,
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

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('calendar_schedule_invite_enabled');
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

    it('uses a stable order-independent fingerprint for the current invite events', () => {
        const normalized = normalizeScheduleInviteIds(schedule());
        const events = getScheduleInviteEvents(normalized, undefined, Date.now());
        const reversed = [...events].reverse();
        expect(getScheduleInviteEventsFingerprint(events)).toBe(getScheduleInviteEventsFingerprint(reversed));
        expect(getScheduleInviteEventsFingerprint(events)).not.toBe(getScheduleInviteEventsFingerprint([
            { ...events[0], startTime: '20:30' },
        ]));
    });

    it('updates a still-pending card in place when the same day is rerolled', async () => {
        const char = {
            id: 'char-1',
            name: '萧逸',
            customTimezoneEnabled: true,
            customTimezone: 'Asia/Shanghai',
        } as const;
        const oldSchedule = normalizeScheduleInviteIds(schedule());
        const oldEvents = getScheduleInviteEvents(oldSchedule, char, Date.now());
        const existing: Message = {
            id: 42,
            charId: char.id,
            role: 'assistant',
            type: 'schedule_invite',
            content: '[行程邀约]',
            timestamp: Date.now(),
            metadata: {
                source: 'schedule_invite',
                scheduleInviteData: {
                    kind: 'schedule_invite',
                    batchId: 'sinv_char-1_2099-08-24',
                    charId: char.id,
                    charName: char.name,
                    date: oldSchedule.date,
                    status: 'pending',
                    acceptedIds: [],
                    events: oldEvents,
                    sourceTimeZone: 'Asia/Shanghai',
                },
            },
        };
        const getRecent = vi.spyOn(DB, 'getRecentMessagesByCharIdAndSource').mockResolvedValue([existing]);
        const updateMetadata = vi.spyOn(DB, 'updateMessageMetadata').mockResolvedValue(undefined);
        const saveSchedule = vi.spyOn(DB, 'saveDailySchedule').mockResolvedValue(undefined);

        const rerolled = schedule({
            slots: [
                { startTime: '20:30', endTime: '21:30', activity: '晚间语音连麦', description: '线上聊聊今天', emoji: '🎧', withUser: true, inviteKind: 'voice' },
                { startTime: '22:00', activity: '自己看书', emoji: '📖', withUser: false },
            ],
        });
        const result = await ensureScheduleInviteMessage({ char, schedule: rerolled });

        expect(result).toMatchObject({ created: false, updated: true, messageId: 42 });
        expect(getRecent).toHaveBeenCalledWith(char.id, 'schedule_invite', 30);
        expect(saveSchedule).toHaveBeenCalled();
        expect(updateMetadata).toHaveBeenCalledWith(42, expect.any(Function));
        const nextMetadata = (updateMetadata.mock.calls[0][1] as (previous: Message['metadata']) => Message['metadata'])(existing.metadata);
        expect(nextMetadata?.scheduleInviteData).toMatchObject({
            batchId: 'sinv_char-1_2099-08-24',
            status: 'pending',
            events: [expect.objectContaining({ startTime: '20:30', endTime: '21:30' })],
        });
    });
});
