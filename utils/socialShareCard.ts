/**
 * 分享到聊天的社交动态卡片（`social_card`）单点实现。
 *
 * 背景：`social_card` 原本只有 Spark（小红书那套）一个来源——SocialApp 的「分享帖子」。
 * 消息 App 的朋友圈没有转发入口，动态只能截图口述给角色。现在朋友圈也能转发进聊天，
 * 同一个 type 承载两种来源（`post.socialScope`），于是这三件事必须收在一处，
 * 否则又会像历史上的 type-switch 一样在三个文件里各演化一份：
 *
 *   1. `buildSharedSocialPost()`      落库前把动态压成可安全塞进 message.metadata 的形态
 *   2. `formatSocialCardForContext()` 喂给模型的可读文本（聊天上下文 / 归档 / 记忆宫殿共用）
 *   3. `socialCardBriefLabel()`       「别人对话的背景叙述」里的短占位符
 *
 * ⚠️ 朋友圈配图是 data URL（processImage 出来的 1600px JPEG，一张可能几百 KB）。
 * 整条动态照抄进 message.metadata 等于在聊天库里再复制一份，而聊天库是要走云备份的。
 * 所以落库只留前 SHARED_POST_MAX_IMAGES 张，真实张数记在 momentShare.imageCount 里，
 * 卡片和上下文都按真实张数说话，不假装原动态只有 3 张。
 */

import type { SocialPost } from '../types';
import { getSocialPostScope, SocialPostScope } from './socialPostScope';

/** 落库时最多复制几张配图进聊天记录（卡片只展示缩略图，多了纯属重复占空间）。 */
export const SHARED_POST_MAX_IMAGES = 3;

/** 上下文里最多列几条评论，防止一条热闹动态把 token 吃光。 */
const CONTEXT_MAX_COMMENTS = 20;

/** `metadata.momentShare`：卡片和上下文都要用、但压缩后从 post 本身读不出来的信息。 */
export interface SharedSocialPostMeta {
    scope: SocialPostScope;
    /** 原动态的真实配图张数（被 SHARED_POST_MAX_IMAGES 截断之前）。 */
    imageCount: number;
    sharedAt: number;
}

const isImageSource = (value: unknown): boolean =>
    /^(?:data:image\/|https?:\/\/|blob:|blobref:)/i.test(String(value || '').trim());

/**
 * 把一条动态压成可以落进 `message.metadata` 的形态。
 * 贴纸 / `txt:` 这类短字符串原样保留（本来就只有几个字符），只截真正的图片源。
 */
export const buildSharedSocialPost = (
    post: SocialPost,
): { post: SocialPost; momentShare: SharedSocialPostMeta } => {
    const scope = getSocialPostScope(post);
    const rawImages = Array.isArray(post.images) ? post.images : [];
    const imageCount = rawImages.filter(isImageSource).length;
    let kept = 0;
    const images = rawImages.filter(value => {
        if (!isImageSource(value)) return true;
        kept += 1;
        return kept <= SHARED_POST_MAX_IMAGES;
    });
    return {
        post: { ...post, socialScope: scope, images },
        momentShare: { scope, imageCount, sharedAt: Date.now() },
    };
};

export interface SocialCardContextOptions {
    /** 聊天对面这个角色的名字。 */
    charName: string;
    /** 角色 id；有的话用它判断动态是不是角色本人发的（比按名字判断准）。 */
    charId?: string;
    userName: string;
    /** 这张卡片是谁发进聊天的。 */
    sharedByRole?: 'user' | 'assistant' | 'system';
    /** 角色在 Spark 上的马甲名，只有 Spark 分支用得到。 */
    charHandles?: ReadonlyArray<string>;
    /** 原动态真实配图张数；不传就按 post.images 里剩下的图片数算。 */
    imageCount?: number;
    /** 是否附上「请发表看法」这类引导句。归档 / 记忆宫殿路径不需要。 */
    withGuidance?: boolean;
    /** 动态发布时间的可读文本；不传就不写这一行。 */
    postTimeLabel?: string;
}

const countImages = (post: SocialPost, override?: number): number => {
    if (typeof override === 'number' && override >= 0) return override;
    return (Array.isArray(post.images) ? post.images : []).filter(isImageSource).length;
};

/**
 * 朋友圈动态：楼主身份是理解这条卡片的关键——
 * 「用户转发角色自己发的朋友圈」和「用户转发别的好友的朋友圈」是两种完全不同的对话。
 */
const describeMomentAuthor = (
    post: SocialPost,
    options: SocialCardContextOptions,
): { label: string; note: string } => {
    const name = post.authorName || '某人';
    const isSelf = post.authorType === 'character'
        && (options.charId
            ? String(post.authorCharId || '') === String(options.charId)
            : name === options.charName);
    if (isSelf) {
        return {
            label: `${name}（你自己）`,
            note: '\n（注意：这条朋友圈是你自己发的，用户把它翻出来跟你说事，别当成别人的动态。）',
        };
    }
    if (post.authorType === 'user' || name === options.userName) {
        return { label: `${name}（用户本人）`, note: '\n（注意：这条朋友圈是用户自己发的。）' };
    }
    return { label: `${name}（你的另一个好友）`, note: '' };
};

const formatComments = (post: SocialPost): string => {
    const comments = Array.isArray(post.comments) ? post.comments : [];
    if (!comments.length) return '';
    const lines = comments.slice(0, CONTEXT_MAX_COMMENTS).map(comment => {
        const replyPart = comment.replyTo?.name ? `回复 ${comment.replyTo.name}：` : '';
        return `· ${comment.authorName || '匿名'}：${replyPart}${comment.content || ''}`;
    });
    const more = comments.length > lines.length ? `\n· …还有 ${comments.length - lines.length} 条评论` : '';
    return `\n评论区：\n${lines.join('\n')}${more}`;
};

const formatLikes = (post: SocialPost): string => {
    const total = post.likes || 0;
    const named = (post.likeUsers || []).map(user => user.name).filter(Boolean);
    if (!total && !named.length) return '';
    if (!named.length) return `\n点赞：${total} 人`;
    const rest = total > named.length ? ` 等 ${total} 人` : '';
    return `\n点赞：${named.join('、')}${rest}`;
};

const formatImages = (post: SocialPost, count: number): string => {
    if (!count) return '';
    const prompt = (post.imagePrompt || '').trim();
    // 图片本身模型看不见（除非开了识图），所以宁可说清楚「有几张 + 画面描述」，
    // 也不能让它对着一句「配图」自己脑补内容。
    return prompt
        ? `\n配图：${count} 张，画面描述：${prompt}`
        : `\n配图：${count} 张（没有画面描述，你看不到图里具体是什么，别假装看过）`;
};

const formatMomentsCard = (post: SocialPost, options: SocialCardContextOptions): string => {
    const sharer = options.sharedByRole === 'assistant' ? options.charName : options.userName;
    const author = describeMomentAuthor(post, options);
    const body = (post.content || post.title || '').trim();
    const head = [
        `[朋友圈动态] ${sharer}把一条朋友圈转发进了聊天`,
        `楼主：${author.label}`,
        options.postTimeLabel ? `发布时间：${options.postTimeLabel}` : '',
        body ? `正文：${body}` : '正文：（这条动态只有配图，没写文字）',
        post.location ? `位置：${post.location}` : '',
    ].filter(Boolean).join('\n');
    const tail = [
        formatImages(post, countImages(post, options.imageCount)),
        formatLikes(post),
        formatComments(post),
        author.note,
        options.withGuidance
            ? '\n（这条动态现在是你们共同的话题，请按你的性格聊它——共情、追问、吐槽都行；但它是过去发的，别说成刚刚才发生。）'
            : '',
    ].join('');
    return `${head}${tail}`;
};

const formatSparkCard = (post: SocialPost, options: SocialCardContextOptions): string => {
    const handles = new Set(
        (options.charHandles || []).filter(handle => typeof handle === 'string' && handle.trim()),
    );
    const tagAuthor = (name: string): string => {
        if (!name) return '路人';
        if (handles.has(name)) return `${name} (你自己的马甲)`;
        if (name === options.userName) return `${name} (用户)`;
        return name;
    };
    const authorName = post.authorName || '路人';
    const comments = (post.comments || []).slice(0, CONTEXT_MAX_COMMENTS)
        .map(comment => `${tagAuthor(comment.authorName)}: ${comment.content}`)
        .join(' | ');
    const identityHint = handles.size
        ? `\n(你在 Spark 上的马甲: ${[...handles].map(handle => `"${handle}"`).join(', ')}。如果上面的楼主或评论作者出现这些名字，那就是你自己发的，请按此自洽回应，不要把自己的马甲当陌生人。)`
        : '';
    const authorship = handles.has(authorName)
        ? '\n(注意：这条 Spark 笔记的楼主是你自己的马甲，用户在向你转发你自己发的帖子。)'
        : authorName === options.userName
            ? '\n(注意：这条 Spark 笔记是用户本人发的。)'
            : '';
    const guidance = options.withGuidance
        ? '\n(请根据你的性格对这个帖子发表看法，比如吐槽、感兴趣或者不屑)'
        : '';
    return `[用户分享了 Spark 笔记]\n楼主: ${tagAuthor(authorName)}\n标题: ${post.title}\n内容: ${post.content}\n热评: ${comments}${identityHint}${authorship}${guidance}`;
};

/** 把一张 `social_card` 翻成喂给模型的可读文本。上下文、归档、记忆宫殿共用同一份。 */
export const formatSocialCardForContext = (
    post: SocialPost | null | undefined,
    options: SocialCardContextOptions,
): string => {
    if (!post) return '[分享帖子]';
    return getSocialPostScope(post) === 'moments'
        ? formatMomentsCard(post, options)
        : formatSparkCard(post, options);
};

/** 「别人对话的背景叙述」用的短占位符——那片全是 [图片]/[表情] 式短标签，不能塞长文本。 */
export const socialCardBriefLabel = (post: SocialPost | null | undefined): string => {
    if (!post) return '[分享帖子]';
    const title = (post.content || post.title || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    const kind = getSocialPostScope(post) === 'moments' ? '朋友圈' : '帖子';
    return `[分享${kind}${title ? '：' + title : ''}]`;
};
