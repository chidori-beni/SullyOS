import { describe, expect, it } from 'vitest';
import type { SocialPost } from '../types';
import { appendMomentComment, applyMomentAiInteractions, deriveMomentNotifications, removeMomentComment, toggleMomentLike } from './momentsInteractions';

const basePost = (overrides: Partial<SocialPost> = {}): SocialPost => ({
    id: 'moment-user-1', authorName: '我', authorAvatar: '', title: '', content: '今天很好', images: [],
    likes: 4, isCollected: false, isLiked: false, comments: [], timestamp: 10, tags: [], authorType: 'user', socialScope: 'moments',
    ...overrides,
});
const me = { id: 'me', name: '我', actorType: 'user' as const };
const char = { id: 'c1', charId: 'c1', name: '小夏', avatar: 'a.png', actorType: 'character' as const };

describe('moments interactions', () => {
    it('toggles a known user while preserving the legacy numeric baseline', () => {
        const liked = toggleMomentLike(basePost(), me);
        expect(liked.likes).toBe(5);
        expect(liked.isLiked).toBe(true);
        expect(liked.likeUsers?.map(item => item.name)).toEqual(['我']);
        const unliked = toggleMomentLike(liked, me);
        expect(unliked.likes).toBe(4);
        expect(unliked.isLiked).toBe(false);
    });

    it('can remove a legacy user like that has no liker detail', () => {
        const unliked = toggleMomentLike(basePost({ isLiked: true }), me);
        expect(unliked.likes).toBe(3);
        expect(unliked.isLiked).toBe(false);
        expect(unliked.likeUsers).toEqual([]);
    });

    it('stores a real reply target without breaking top-level comments', () => {
        const first = appendMomentComment(basePost(), me, '你也要开心', null, 20);
        const replied = appendMomentComment(first, char, '收到啦', first.comments[0], 30);
        expect(replied.comments[0].replyTo).toBeUndefined();
        expect(replied.comments[1].replyTo).toMatchObject({ id: replied.comments[0].id, name: '我', authorType: 'user' });
        expect(removeMomentComment(replied, replied.comments[0].id).comments.map(item => item.id)).toEqual([replied.comments[1].id]);
    });

    it('applies AI likes/comments/replies once and rejects invented targets', () => {
        const withUserComment = appendMomentComment(basePost(), me, '你看到了吗', null, 20);
        const result = applyMomentAiInteractions(withUserComment, [char], [{
            name: '小夏', like: true, comment: '当然看到了', reply: { targetName: '我', content: '刚刚就在看' },
        }], 100);
        expect(result.matched).toBe(1);
        expect(result.post.likes).toBe(5);
        expect(result.post.comments).toHaveLength(3);
        expect(result.post.comments[2].replyTo?.id).toBe(withUserComment.comments[0].id);

        const duplicate = applyMomentAiInteractions(result.post, [char], [{ name: '小夏', like: true, comment: '重复', reply: { targetName: '不存在', content: '幻觉回复' } }], 200);
        expect(duplicate.post.likes).toBe(5);
        expect(duplicate.post.comments).toHaveLength(3);
    });

    it('derives sorted notifications only for user-facing character interactions', () => {
        let post = toggleMomentLike(basePost(), char);
        post = appendMomentComment(post, char, '好看', null, 50);
        post = appendMomentComment(post, me, '谢谢', post.comments[0], 60);
        const notifications = deriveMomentNotifications([post]);
        expect(notifications.map(item => item.type).sort()).toEqual(['comment', 'like']);
        expect(notifications[0].timestamp).toBeGreaterThanOrEqual(notifications[1].timestamp);
        expect(notifications.every(item => item.name === '小夏')).toBe(true);
    });
});
