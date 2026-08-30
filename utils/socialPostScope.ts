import { SocialPost } from '../types';

export type SocialPostScope = NonNullable<SocialPost['socialScope']>;

/**
 * 旧版本把朋友圈与 Spark 混在同一张表里。旧朋友圈 ID 一直以 moment- 开头；
 * 其余旧记录归入 Spark，避免陌生人动态重新流进朋友圈。
 */
export const getSocialPostScope = (post: Pick<SocialPost, 'id' | 'socialScope'>): SocialPostScope => {
    if (post.socialScope === 'moments' || post.socialScope === 'spark') return post.socialScope;
    return String(post.id || '').startsWith('moment-') ? 'moments' : 'spark';
};

export const isSparkPost = (post: Pick<SocialPost, 'id' | 'socialScope'>): boolean => (
    getSocialPostScope(post) === 'spark'
);

export const isMomentsPost = (
    post: Pick<SocialPost, 'id' | 'socialScope' | 'authorType' | 'authorCharId'>,
    friendIds: ReadonlySet<string>,
): boolean => {
    if (getSocialPostScope(post) !== 'moments') return false;
    if (post.authorType === 'user') return true;
    return post.authorType === 'character' && !!post.authorCharId && friendIds.has(String(post.authorCharId));
};

export const withSocialPostScope = <T extends SocialPost>(post: T, socialScope: SocialPostScope): T => ({
    ...post,
    socialScope,
});
