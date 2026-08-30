import { describe, expect, it } from 'vitest';
import {
    messagingLengthBucket,
    messagingTimeSlot,
    messagingUnreadBucket,
    makeDefaultMessagingProfile,
    scopeMessagingCss,
    validateMessagingCss,
} from './messagingTheme';

describe('messaging theme CSS compatibility', () => {
    it('scopes ordinary nj hooks to every messaging root', () => {
        const css = scopeMessagingCss('.nj-chat-item { color: red; }');
        expect(css).toContain('#messaging-chat-tab .nj-chat-item');
        expect(css).toContain('#messaging-moments-tab .nj-chat-item');
        expect(css).toContain('#messaging-bottom-bar .nj-chat-item');
    });

    it('turns :root variables into the five supported roots', () => {
        const css = scopeMessagingCss(':root { --nj-msg-bg: pink; }');
        expect(css).toContain('#messaging-chat-tab');
        expect(css).toContain('#messaging-favorites-tab');
        expect(css).toContain('#messaging-bottom-bar');
        expect(css).not.toContain(':root{');
    });

    it('keeps already-scoped selectors and keyframes usable', () => {
        const css = scopeMessagingCss('#messaging-chat-tab .nj-chat-item { opacity: .8 } @keyframes sparkle { to { opacity: 1 } }');
        expect(css).toContain('#messaging-chat-tab .nj-chat-item');
        expect(css).toContain('@keyframes sparkle');
        expect(css).not.toContain('#messaging-moments-tab #messaging-chat-tab');
    });

    it('recursively scopes media queries and preserves contextual branches', () => {
        const css = scopeMessagingCss('@media (max-width: 600px) { [data-time-slot="night"] .nj-chat-item { color: white; } }');
        expect(css).toContain('@media (max-width: 600px)');
        expect(css).toContain('[data-time-slot="night"] #messaging-chat-tab .nj-chat-item');
    });

    it('preserves declarations exactly like the 4.71 scoper', () => {
        const css = scopeMessagingCss('.nj-tab-bottom-bar { backdrop-filter: blur(12px); }');
        expect(css).toContain('backdrop-filter: blur(12px)');
        expect(css).not.toContain('-webkit-backdrop-filter');
    });

    it('keeps pseudo elements on the same hook instead of moving them below the root', () => {
        const css = scopeMessagingCss('.nj-chat-tab-decor-top::before { content: "x"; }');
        expect(css).toContain(':is(#messaging-chat-tab.nj-chat-tab-decor-top)::before');
        expect(css).toContain('#messaging-chat-tab .nj-chat-tab-decor-top::before');
    });

    it.each([
        ['@import url("https://example.com/x.css");', '@import'],
        ['.x{background:url(javascript:alert(1))}', 'javascript'],
        ['.x{width:expression(alert(1))}', 'expression'],
        ['.x{-moz-binding:url(x)}', '-moz-binding'],
    ])('rejects unsafe CSS: %s', (css, marker) => {
        const result = validateMessagingCss(css);
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.error.toLowerCase()).toContain(marker.toLowerCase());
    });

    it('matches the documented context buckets', () => {
        expect(messagingTimeSlot(3)).toBe('lateNight');
        expect(messagingTimeSlot(22)).toBe('night');
        expect(messagingUnreadBucket(0)).toBe('0');
        expect(messagingUnreadBucket(9)).toBe('few');
        expect(messagingUnreadBucket(12)).toBe('many');
        expect(messagingLengthBucket('a'.repeat(41))).toBe('long');
    });

    it('migrates the two legacy location fields into one visible location', () => {
        const profile = makeDefaultMessagingProfile({ version: 1, virtualLocation: 'Tokyo', realLocation: 'Japan' });
        expect(profile.version).toBe(2);
        expect(profile.location).toBe('Tokyo');
        expect(profile).not.toHaveProperty('virtualLocation');
        expect(profile).not.toHaveProperty('realLocation');
    });
});
