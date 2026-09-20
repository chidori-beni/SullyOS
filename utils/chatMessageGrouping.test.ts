import { describe, expect, it } from 'vitest';
import { areMessagesWithinGroupGap, CHAT_MESSAGE_GROUP_GAP_MS } from './chatMessageGrouping';

describe('chat message time grouping', () => {
    const at = new Date('2026-09-20T09:00:00').getTime();

    it('keeps bubbles from one continuous burst together', () => {
        expect(areMessagesWithinGroupGap(at, at + 1)).toBe(true);
        expect(areMessagesWithinGroupGap(at, at + CHAT_MESSAGE_GROUP_GAP_MS)).toBe(true);
    });

    it('starts a new time group after the quiet window', () => {
        expect(areMessagesWithinGroupGap(at, at + 15 * 60 * 1000)).toBe(false);
        expect(areMessagesWithinGroupGap(at, at + CHAT_MESSAGE_GROUP_GAP_MS + 1)).toBe(false);
    });

    it('does not merge invalid timestamps', () => {
        expect(areMessagesWithinGroupGap(Number.NaN, at)).toBe(false);
    });
});
