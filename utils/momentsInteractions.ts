import type { SocialComment, SocialPost, SocialReactionUser } from '../types';

export interface MomentActor {
    id: string;
    name: string;
    avatar?: string;
    actorType: 'user' | 'character';
    charId?: string;
}

export interface MomentAiInteraction {
    name: string;
    like?: boolean;
    comment?: string | null;
    reply?: { targetName?: string; content?: string } | null;
}

export interface MomentNotification {
    id: string;
    type: 'like' | 'comment' | 'reply';
    postId: string;
    actorId: string;
    charId?: string;
    name: string;
    avatar?: string;
    content?: string;
    timestamp: number;
    postImage?: string;
    postText: string;
}

const actorMatchesReaction = (reaction: SocialReactionUser, actor: MomentActor): boolean => (
    String(reaction.id) === String(actor.id)
    || (!!actor.charId && String(reaction.charId || '') === String(actor.charId))
);

export const toggleMomentLike = (post: SocialPost, actor: MomentActor): SocialPost => {
    const current = post.likeUsers || [];
    const liked = current.some(reaction => actorMatchesReaction(reaction, actor))
        || (actor.actorType === 'user' && post.isLiked && !current.some(reaction => reaction.actorType === 'user'));
    const nextLikeUsers = liked
        ? current.filter(reaction => !actorMatchesReaction(reaction, actor))
        : [...current, {
            id: actor.id,
            name: actor.name,
            avatar: actor.avatar,
            actorType: actor.actorType,
            charId: actor.charId,
            timestamp: Date.now(),
        } satisfies SocialReactionUser];
    return {
        ...post,
        likes: Math.max(0, Number(post.likes || 0) + (liked ? -1 : 1)),
        isLiked: actor.actorType === 'user' ? !liked : post.isLiked,
        likeUsers: nextLikeUsers,
    };
};

export const appendMomentComment = (
    post: SocialPost,
    actor: MomentActor,
    content: string,
    replyTo?: SocialComment | null,
    now = Date.now(),
): SocialPost => {
    const clean = content.trim();
    if (!clean) return post;
    const comment: SocialComment = {
        id: `moment-comment-${now}-${Math.random().toString(36).slice(2, 7)}`,
        authorName: actor.name,
        authorAvatar: actor.avatar,
        content: clean,
        likes: 0,
        isCharacter: actor.actorType === 'character',
        authorType: actor.actorType,
        authorCharId: actor.charId,
        timestamp: now,
        replyTo: replyTo ? {
            id: replyTo.id,
            name: replyTo.authorName,
            authorType: replyTo.authorType,
            authorCharId: replyTo.authorCharId,
        } : undefined,
    };
    return { ...post, comments: [...(post.comments || []), comment] };
};

export const removeMomentComment = (post: SocialPost, commentId: string): SocialPost => ({
    ...post,
    comments: (post.comments || []).filter(comment => comment.id !== commentId),
});

const findCharacter = (actors: MomentActor[], rawName: string): MomentActor | undefined => {
    const name = String(rawName || '').trim();
    if (!name) return undefined;
    const compact = name.replace(/\s+/g, '').toLocaleLowerCase();
    return actors.find(actor => actor.name === name)
        || actors.find(actor => actor.name.toLocaleLowerCase() === name.toLocaleLowerCase())
        || actors.find(actor => actor.name.replace(/\s+/g, '').toLocaleLowerCase() === compact);
};

/** Apply one model batch with the same duplicate and real-target guards as Nuoji 4.71. */
export const applyMomentAiInteractions = (
    post: SocialPost,
    actors: MomentActor[],
    interactions: MomentAiInteraction[],
    now = Date.now(),
): { post: SocialPost; matched: number } => {
    let next = post;
    let matched = 0;
    interactions.forEach((interaction, index) => {
        const actor = findCharacter(actors, interaction.name);
        if (!actor || actor.actorType !== 'character') return;
        matched += 1;
        if (interaction.like && !(next.likeUsers || []).some(reaction => actorMatchesReaction(reaction, actor))) {
            next = toggleMomentLike(next, actor);
        }

        const comment = String(interaction.comment || '').trim();
        const hasTopLevel = (next.comments || []).some(item => (
            item.authorType === 'character'
            && String(item.authorCharId || '') === String(actor.charId || actor.id)
            && !item.replyTo
        ));
        if (comment && !hasTopLevel) next = appendMomentComment(next, actor, comment, null, now + index);

        const replyContent = String(interaction.reply?.content || '').trim();
        const targetName = String(interaction.reply?.targetName || '').trim();
        if (!replyContent || !targetName) return;
        const target = [...(next.comments || [])].reverse().find(item => item.authorName === targetName);
        if (!target) return;
        const hasReply = (next.comments || []).some(item => (
            item.authorType === 'character'
            && String(item.authorCharId || '') === String(actor.charId || actor.id)
            && item.replyTo?.id === target.id
        ));
        if (!hasReply) next = appendMomentComment(next, actor, replyContent, target, now + interactions.length + index);
    });
    return { post: next, matched };
};

/** Notifications are derived from interaction data, so no second notification database can drift. */
export const deriveMomentNotifications = (posts: SocialPost[]): MomentNotification[] => {
    const notifications: MomentNotification[] = [];
    posts.forEach(post => {
        const userPost = post.authorType === 'user';
        (post.likeUsers || []).forEach(reaction => {
            if (!userPost || reaction.actorType !== 'character') return;
            notifications.push({
                id: `like:${post.id}:${reaction.id}:${reaction.timestamp}`,
                type: 'like', postId: post.id, actorId: reaction.id, charId: reaction.charId,
                name: reaction.name, avatar: reaction.avatar, timestamp: reaction.timestamp,
                postImage: post.images?.[0], postText: post.content || post.title || '',
            });
        });
        (post.comments || []).forEach(comment => {
            if (comment.authorType !== 'character') return;
            const repliesToUser = comment.replyTo?.authorType === 'user';
            if (!userPost && !repliesToUser) return;
            const timestamp = comment.timestamp || post.timestamp;
            notifications.push({
                id: `${repliesToUser ? 'reply' : 'comment'}:${post.id}:${comment.id}`,
                type: repliesToUser ? 'reply' : 'comment', postId: post.id,
                actorId: comment.authorCharId || comment.authorName, charId: comment.authorCharId,
                name: comment.authorName, avatar: comment.authorAvatar, content: comment.content,
                timestamp, postImage: post.images?.[0], postText: post.content || post.title || '',
            });
        });
    });
    return notifications.sort((a, b) => b.timestamp - a.timestamp);
};
