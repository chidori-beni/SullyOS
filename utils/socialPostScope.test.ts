import { describe, expect, it } from 'vitest';
import { SocialPost } from '../types';
import { getSocialPostScope, isMomentsPost, isSparkPost, withSocialPostScope } from './socialPostScope';

const post = (overrides: Partial<SocialPost>): SocialPost => ({
    id: 'post-1', authorName: '路人', authorAvatar: '', title: '', content: '', images: [], likes: 0,
    isCollected: false, isLiked: false, comments: [], timestamp: 1, tags: [], authorType: 'stranger',
    ...overrides,
});

describe('social post surface isolation', () => {
    it('migrates old moment IDs to Moments and all other legacy IDs to Spark', () => {
        expect(getSocialPostScope(post({ id: 'moment-char-1' }))).toBe('moments');
        expect(getSocialPostScope(post({ id: 'post-1' }))).toBe('spark');
    });

    it('keeps strangers out of Moments and only admits current friends', () => {
        const friends = new Set(['friend-1']);
        expect(isMomentsPost(post({ id: 'moment-user-1', authorType: 'user' }), friends)).toBe(true);
        expect(isMomentsPost(post({ id: 'moment-char-1', authorType: 'character', authorCharId: 'friend-1' }), friends)).toBe(true);
        expect(isMomentsPost(post({ id: 'moment-char-2', authorType: 'character', authorCharId: 'removed-friend' }), friends)).toBe(false);
        expect(isMomentsPost(post({ id: 'moment-stranger-1', authorType: 'stranger' }), friends)).toBe(false);
    });

    it('marks new Spark records explicitly', () => {
        const scoped = withSocialPostScope(post({}), 'spark');
        expect(scoped.socialScope).toBe('spark');
        expect(isSparkPost(scoped)).toBe(true);
    });
});
