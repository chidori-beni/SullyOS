/**
 * 「这个角色单独一套聊天外观」的覆盖层。
 *
 * 原来的分工是这样的：
 *   · 「所有聊天」能改 **25 项**（聊天壳 / 顶栏 / 气泡与头像 / 输入栏 + 9 项细节微调）
 *   · 「这个角色」只能改其中 **9 项**（`CHAT_FINE_TUNE_KEYS`，走 char.chatFineTune）
 * 于是两个作用域点进去长得完全不一样，也没法给某个角色单独换一套聊天壳。
 *
 * 这份文件补上缺的那 16 项：存进 `char.chatAppearance`，读的时候叠在全局 theme 上。
 *
 * 三层顺序（后面的盖前面的）：
 *
 *     全局 theme  →  char.chatAppearance（这 16 项）  →  char.chatFineTune（那 9 项）
 *
 * 微调放最后是为了**不动老数据**：以前只有微调这一层，谁已经调过就还按 ta 调的来。
 *
 * ⚠️ 白名单是硬要求。`chatAppearance` 声明成 `Partial<OSTheme>`，
 * 不过滤的话一份坏掉/被人改过的角色卡能往里塞任意 theme 字段（壁纸、主色、
 * 甚至将来加的开关），一导入就改了整机设置。所以**读写两头都过 pickChatAppearance**。
 */
import type { CharacterProfile, OSTheme } from '../types';
import { CHAT_FINE_TUNE_KEYS } from './chatFineTuneCss';

/**
 * 允许按角色覆盖的 16 个视觉字段，以及每个字段的合法取值。
 *
 * 和「所有聊天」那一页的控件一一对应（见 components/appearance/ChatAppearanceEditor.tsx
 * 的 6 页面板）。加控件时**这里也要加**，否则新控件在角色作用域下存不进去。
 */
const APPEARANCE_CHOICES = {
    chatChromeStyle: ['soft', 'flat', 'floating', 'pixel'],
    chatHeaderStyle: ['default', 'minimal', 'gradient', 'wechat', 'telegram', 'discord', 'pixel'],
    chatHeaderAlign: ['left', 'center'],
    chatHeaderDensity: ['compact', 'default', 'airy'],
    chatStatusStyle: ['subtle', 'pill', 'dot'],
    chatBubbleStyle: ['modern', 'flat', 'outline', 'shadow', 'wechat', 'ios'],
    chatAvatarShape: ['circle', 'rounded', 'square'],
    chatAvatarSize: ['small', 'medium', 'large'],
    chatAvatarMode: ['grouped', 'every_message'],
    chatMessageSpacing: ['compact', 'default', 'spacious'],
    chatShowTimestamp: ['always', 'hover', 'never'],
    chatEmojiSize: ['small', 'medium', 'large'],
    chatInputStyle: ['default', 'rounded', 'flat', 'wechat', 'ios', 'telegram', 'discord', 'pixel'],
    chatSendButtonStyle: ['circle', 'pill', 'minimal'],
} as const satisfies Partial<Record<keyof OSTheme, readonly string[]>>;

/** 只有 true/false 两种取值的那两项（都是本 fork 独有的）。 */
const APPEARANCE_BOOLEANS = ['chatShowSendButton', 'chatShowVoiceButton'] as const;

export type ChatAppearanceKey = keyof typeof APPEARANCE_CHOICES | (typeof APPEARANCE_BOOLEANS)[number];

export const CHAT_APPEARANCE_KEYS: readonly ChatAppearanceKey[] = [
    ...(Object.keys(APPEARANCE_CHOICES) as (keyof typeof APPEARANCE_CHOICES)[]),
    ...APPEARANCE_BOOLEANS,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * 把任意对象筛成只剩合法的外观字段。
 *
 * 不认识的键、类型不对的值、不在候选里的字符串**一律丢掉**（静默丢，不抛错）——
 * 这条路上最常见的输入是「别人分享的角色卡」和「旧版本存的档」，
 * 为一个坏字段把整个聊天弄崩不值得。
 */
export function pickChatAppearance(value: unknown): Partial<OSTheme> {
    if (!isRecord(value)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, choices] of Object.entries(APPEARANCE_CHOICES)) {
        const candidate = value[key];
        if (typeof candidate === 'string' && (choices as readonly string[]).includes(candidate)) {
            result[key] = candidate;
        }
    }
    for (const key of APPEARANCE_BOOLEANS) {
        if (typeof value[key] === 'boolean') result[key] = value[key];
    }
    return result as Partial<OSTheme>;
}

/** 这个角色现在是不是「单独定制」状态。沿用原来那一个开关，不再多加一个。 */
export const hasChatAppearanceOverride = (char?: Pick<CharacterProfile, 'chatFineTune'> | null): boolean =>
    char?.chatFineTune?.enabled === true;

/**
 * 全局 theme 叠上这个角色的 16 项覆盖。
 *
 * 开关关着（跟随全局）时原样返回传入的 theme —— **同一个对象引用**，
 * 这样 Chat.tsx 里那些 `useMemo([osTheme])` 不会因为每次新建对象而白白重算。
 *
 * 注意这里**不管** `chatFineTune` 那 9 项：它们仍由 mergeChatFineTune 在更外层处理，
 * 顺序在本函数之后，所以微调永远压得过这一层。
 */
export function resolveChatAppearance<T extends OSTheme>(theme: T, char?: CharacterProfile | null): T {
    if (!hasChatAppearanceOverride(char)) return theme;
    const override = pickChatAppearance(char?.chatAppearance);
    return Object.keys(override).length ? { ...theme, ...override } : theme;
}

/**
 * 把一次控件改动拆成「外观 16 项」和「微调 9 项」两份补丁。
 *
 * 「所有聊天」那套控件是按整份 theme 写的（一次 updateTheme 可能同时含两类字段，
 * 比如「快速预设」会一口气写十几项）。角色作用域复用同一套控件，
 * 所以在写入前按字段归属拆开，分别落到 chatAppearance / chatFineTune。
 */
export function splitAppearancePatch(patch: Partial<OSTheme>): {
    appearance: Partial<OSTheme>;
    fineTune: Record<string, unknown>;
} {
    const fineTuneKeys = CHAT_FINE_TUNE_KEYS as readonly string[];
    const fineTune: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        if (fineTuneKeys.includes(key)) fineTune[key] = value;
    }
    return { appearance: pickChatAppearance(patch), fineTune };
}
