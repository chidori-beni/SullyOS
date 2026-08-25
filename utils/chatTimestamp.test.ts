import { afterAll, describe, expect, it } from 'vitest';
import { formatChatTimestamp } from './chatTimestamp';

const originalTimeZone = process.env.TZ;

afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
});

describe('formatChatTimestamp', () => {
    it('keeps messages from today as HH:mm', () => {
        process.env.TZ = 'Asia/Shanghai';

        expect(formatChatTimestamp(
            new Date('2026-08-26T09:05:00+08:00').getTime(),
            new Date('2026-08-26T10:00:00+08:00').getTime(),
        )).toBe('09:05');
    });

    it('adds the month and day after crossing a local calendar day', () => {
        process.env.TZ = 'Asia/Shanghai';

        expect(formatChatTimestamp(
            new Date('2026-08-25T23:45:00+08:00').getTime(),
            new Date('2026-08-26T01:05:00+08:00').getTime(),
        )).toBe('8月25日 23:45');
    });

    it('adds the year when the message is from another year', () => {
        process.env.TZ = 'Asia/Shanghai';

        expect(formatChatTimestamp(
            new Date('2025-12-31T23:45:00+08:00').getTime(),
            new Date('2026-01-01T01:05:00+08:00').getTime(),
        )).toBe('2025年12月31日 23:45');
    });

    it('uses the device calendar day rather than UTC day', () => {
        process.env.TZ = 'Asia/Shanghai';

        expect(formatChatTimestamp(
            new Date('2026-08-25T16:05:00Z').getTime(),
            new Date('2026-08-25T16:30:00Z').getTime(),
        )).toBe('00:05');
    });
});
