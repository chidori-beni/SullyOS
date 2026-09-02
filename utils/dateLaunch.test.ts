import { beforeEach, describe, expect, it } from 'vitest';
import { dateLaunch } from './dateLaunch';

describe('dateLaunch', () => {
    beforeEach(() => {
        dateLaunch.consume();
    });

    it('keeps a launch intent until DateApp consumes it', () => {
        dateLaunch.request({ surface: 'story' });

        expect(dateLaunch.peek()).toEqual({ surface: 'story' });
        expect(dateLaunch.consume()).toEqual({ surface: 'story' });
        expect(dateLaunch.peek()).toBeNull();
    });

    it('replaces a stale intent with the latest request', () => {
        dateLaunch.request({ surface: 'companion' });
        dateLaunch.request({ surface: 'story' });

        expect(dateLaunch.consume()).toEqual({ surface: 'story' });
    });

    it('keeps a direct history target for a completed-meeting card', () => {
        dateLaunch.request({ surface: 'companion', charId: 'char-1', encounterId: 'encounter-1', openHistory: true });

        expect(dateLaunch.peek()).toEqual({
            surface: 'companion',
            charId: 'char-1',
            encounterId: 'encounter-1',
            openHistory: true,
        });
    });

    it('keeps the accepted-invite entry and source card id together', () => {
        dateLaunch.request({
            surface: 'companion',
            charId: 'char-1',
            autoStart: true,
            meetingInviteMessageId: 18,
            returnTo: 'chat',
        });

        expect(dateLaunch.consume()).toEqual({
            surface: 'companion',
            charId: 'char-1',
            autoStart: true,
            meetingInviteMessageId: 18,
            returnTo: 'chat',
        });
    });
});
