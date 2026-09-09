import { describe, it, expect } from 'vitest';
import type { Message, SocialPost } from '../types';
import { normalizeMessageContent, isMessageSemanticallyRelevant } from './messageFormat';
import {
    buildSharedSocialPost,
    formatSocialCardForContext,
    socialCardBriefLabel,
    SHARED_POST_MAX_IMAGES,
} from './socialShareCard';

const photo = (n: number) => `data:image/jpeg;base64,AAAA${n}`;

const moment = (extra: Partial<SocialPost> = {}): SocialPost => ({
    id: 'moment-1',
    authorName: '萧逸',
    authorAvatar: 'https://example.com/a.png',
    title: '',
    content: '下雨了，楼下便利店的灯很好看。',
    images: [],
    likes: 0,
    isCollected: false,
    isLiked: false,
    comments: [],
    timestamp: 1_700_000_000_000,
    tags: [],
    authorType: 'character',
    authorCharId: 'char-1',
    socialScope: 'moments',
    ...extra,
});

const spark = (extra: Partial<SocialPost> = {}): SocialPost => ({
    ...moment(),
    id: 'spark-1',
    socialScope: 'spark',
    authorName: '路人甲',
    authorType: 'stranger',
    authorCharId: undefined,
    title: '一个标题',
    content: '一段正文',
    ...extra,
});

describe('buildSharedSocialPost', () => {
    it('只复制前三张配图进聊天记录，真实张数记在 momentShare 里', () => {
        const post = moment({ images: [photo(1), photo(2), photo(3), photo(4), photo(5)] });
        const { post: shared, momentShare } = buildSharedSocialPost(post);
        expect(shared.images).toHaveLength(SHARED_POST_MAX_IMAGES);
        expect(momentShare.imageCount).toBe(5);
        expect(momentShare.scope).toBe('moments');
    });

    it('贴纸 / txt: 这类短字符串不占图片额度，原样保留', () => {
        const post = moment({ images: ['2728', 'txt:心情', photo(1), photo(2), photo(3), photo(4)] });
        const { post: shared, momentShare } = buildSharedSocialPost(post);
        expect(shared.images).toEqual(['2728', 'txt:心情', photo(1), photo(2), photo(3)]);
        expect(momentShare.imageCount).toBe(4);
    });

    it('旧记录没有 socialScope 时按 id 前缀补回来', () => {
        const { post: shared } = buildSharedSocialPost({ ...moment(), id: 'moment-old', socialScope: undefined });
        expect(shared.socialScope).toBe('moments');
        const { post: sharedSpark } = buildSharedSocialPost({ ...spark(), id: 'post-old', socialScope: undefined });
        expect(sharedSpark.socialScope).toBe('spark');
    });
});

describe('formatSocialCardForContext · 朋友圈', () => {
    it('角色自己发的动态要明确点出来，别当成别人的', () => {
        const out = formatSocialCardForContext(moment(), {
            charName: '萧逸', charId: 'char-1', userName: '颜千夜', withGuidance: true,
        });
        expect(out).toContain('[朋友圈动态]');
        expect(out).toContain('楼主：萧逸（你自己）');
        expect(out).toContain('这条朋友圈是你自己发的');
        expect(out).toContain('下雨了');
    });

    it('用户自己发的动态标成用户本人', () => {
        const out = formatSocialCardForContext(
            moment({ authorType: 'user', authorCharId: undefined, authorName: '颜千夜' }),
            { charName: '萧逸', charId: 'char-1', userName: '颜千夜' },
        );
        expect(out).toContain('楼主：颜千夜（用户本人）');
        expect(out).toContain('这条朋友圈是用户自己发的');
    });

    it('别的好友发的动态既不是"你自己"也不是"用户"', () => {
        const out = formatSocialCardForContext(
            moment({ authorName: '别人', authorCharId: 'char-2' }),
            { charName: '萧逸', charId: 'char-1', userName: '颜千夜' },
        );
        expect(out).toContain('楼主：别人（你的另一个好友）');
        expect(out).not.toContain('你自己');
    });

    it('位置、点赞、评论和配图张数都要进上下文', () => {
        const out = formatSocialCardForContext(moment({
            location: '东京 · 中野',
            likes: 3,
            likeUsers: [{ id: 'u1', name: '颜千夜', actorType: 'user', timestamp: 1 }],
            comments: [
                { id: 'c1', authorName: '颜千夜', content: '好看', likes: 0 },
                { id: 'c2', authorName: '萧逸', content: '嗯', likes: 0, replyTo: { id: 'c1', name: '颜千夜' } },
            ],
            images: [photo(1), photo(2)],
            imagePrompt: 'rainy tokyo street',
        }), { charName: '萧逸', charId: 'char-1', userName: '颜千夜', imageCount: 4 });
        expect(out).toContain('位置：东京 · 中野');
        expect(out).toContain('点赞：颜千夜 等 3 人');
        expect(out).toContain('· 颜千夜：好看');
        expect(out).toContain('· 萧逸：回复 颜千夜：嗯');
        // imageCount 覆盖 post.images 的长度：卡片里只留了 2 张，原动态其实有 4 张
        expect(out).toContain('配图：4 张，画面描述：rainy tokyo street');
    });

    it('没有画面描述时明说看不见图，不让角色瞎编', () => {
        const out = formatSocialCardForContext(moment({ images: [photo(1)] }), {
            charName: '萧逸', userName: '颜千夜',
        });
        expect(out).toContain('别假装看过');
    });

    it('归档路径不带一次性引导句', () => {
        const withGuidance = formatSocialCardForContext(moment(), { charName: '萧逸', userName: '颜千夜', withGuidance: true });
        const archived = formatSocialCardForContext(moment(), { charName: '萧逸', userName: '颜千夜' });
        expect(withGuidance).toContain('共同的话题');
        expect(archived).not.toContain('共同的话题');
        expect(archived).toContain('[朋友圈动态]');
    });
});

describe('formatSocialCardForContext · Spark 保持原样', () => {
    it('马甲身份提示照旧', () => {
        const out = formatSocialCardForContext(spark({ authorName: '夜行者' }), {
            charName: '萧逸', charId: 'char-1', userName: '颜千夜',
            charHandles: ['夜行者'], withGuidance: true,
        });
        expect(out).toContain('[用户分享了 Spark 笔记]');
        expect(out).toContain('楼主: 夜行者 (你自己的马甲)');
        expect(out).toContain('楼主是你自己的马甲');
        expect(out).toContain('请根据你的性格对这个帖子发表看法');
    });
});

describe('socialCardBriefLabel', () => {
    it('朋友圈和 Spark 用不同的短占位符', () => {
        expect(socialCardBriefLabel(moment())).toBe('[分享朋友圈：下雨了，楼下便利店的灯很好看。]');
        expect(socialCardBriefLabel(spark())).toBe('[分享帖子：一段正文]');
        expect(socialCardBriefLabel(undefined)).toBe('[分享帖子]');
    });
});

describe('social_card 会进记忆 / 归档', () => {
    const msg = (): Message => ({
        id: 1, charId: 'char-1', role: 'user', type: 'social_card',
        content: '[分享朋友圈：下雨了]', timestamp: 0,
        metadata: { post: moment(), momentShare: { scope: 'moments', imageCount: 0, sharedAt: 0 } },
    } as Message);

    it('normalizeMessageContent 翻出完整动态，而不是那句 [分享帖子]', () => {
        const out = normalizeMessageContent(msg(), '萧逸', '颜千夜');
        expect(out).toContain('[朋友圈动态]');
        expect(out).toContain('下雨了');
        // 没有 charId 时按名字判断楼主是不是角色本人
        expect(out).toContain('楼主：萧逸（你自己）');
    });

    it('被记忆宫殿 / 缓冲区计数认成有语义的消息', () => {
        expect(isMessageSemanticallyRelevant(msg())).toBe(true);
    });
});
