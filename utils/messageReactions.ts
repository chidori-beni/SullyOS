import type { Message } from '../types';

export type MessageReactionActor = 'user' | 'assistant';

export interface MessageReaction {
    emoji: string;
    by: MessageReactionActor;
    at: number;
}

export interface MessageReactionCommand {
    emoji: string;
    target?: string;
}

export const DEFAULT_REACTION_SHORTCUTS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥'];
export const REACTION_SHORTCUTS_STORAGE_KEY = 'sully-message-reaction-shortcuts-v1';

const firstGrapheme = (value: string): string => {
    const text = value.trim();
    if (!text) return '';
    try {
        const Segmenter = (Intl as any).Segmenter;
        if (Segmenter) return (Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) as Array<{ segment: string }>)[0]?.segment || '';
    } catch {}
    return Array.from(text)[0] || '';
};

export const normalizeReactionEmoji = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const emoji = firstGrapheme(value.replace(/[\r\n|\]]/g, '').trim());
    if (!emoji || emoji.length > 24) return '';
    // Extended_Pictographic covers ordinary emoji; the extra alternatives preserve flags/keycaps.
    try {
        return /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\u20e3/u.test(emoji) ? emoji : '';
    } catch {
        return emoji.length <= 8 ? emoji : '';
    }
};

export const parseReactionShortcutInput = (value: string, limit = 12): string[] => {
    const candidates = /[\s,，、]/u.test(value)
        ? value.split(/[\s,，、]+/u)
        : (() => {
            try {
                const Segmenter = (Intl as any).Segmenter;
                return Segmenter ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (x: any) => x.segment) : Array.from(value);
            } catch { return Array.from(value); }
        })();
    const normalized = candidates.map(normalizeReactionEmoji).filter(Boolean);
    return Array.from(new Set(normalized)).slice(0, limit);
};

export const loadReactionShortcuts = (): string[] => {
    if (typeof localStorage === 'undefined') return [...DEFAULT_REACTION_SHORTCUTS];
    try {
        const raw = JSON.parse(localStorage.getItem(REACTION_SHORTCUTS_STORAGE_KEY) || '[]');
        const shortcuts = Array.isArray(raw) ? raw.map(normalizeReactionEmoji).filter(Boolean) : [];
        return shortcuts.length ? Array.from(new Set(shortcuts)).slice(0, 12) : [...DEFAULT_REACTION_SHORTCUTS];
    } catch { return [...DEFAULT_REACTION_SHORTCUTS]; }
};

export const saveReactionShortcuts = (shortcuts: string[]): string[] => {
    const normalized = Array.from(new Set(shortcuts.map(normalizeReactionEmoji).filter(Boolean))).slice(0, 12);
    const value = normalized.length ? normalized : [...DEFAULT_REACTION_SHORTCUTS];
    if (typeof localStorage !== 'undefined') localStorage.setItem(REACTION_SHORTCUTS_STORAGE_KEY, JSON.stringify(value));
    return value;
};

export const getMessageReactions = (messageOrMetadata: Message | Record<string, any> | null | undefined): MessageReaction[] => {
    const metadata = messageOrMetadata && 'metadata' in messageOrMetadata ? (messageOrMetadata as Message).metadata : messageOrMetadata;
    const raw = metadata?.messageReactions;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item: any) => {
        const emoji = normalizeReactionEmoji(item?.emoji);
        const by = item?.by === 'user' || item?.by === 'assistant' ? item.by : null;
        if (!emoji || !by) return [];
        return [{ emoji, by, at: Number.isFinite(item?.at) ? item.at : 0 }];
    });
};

export const toggleReactionInMetadata = (metadata: Record<string, any> | undefined, emojiInput: string, by: MessageReactionActor, at = Date.now()) => {
    const emoji = normalizeReactionEmoji(emojiInput);
    if (!emoji) return metadata || {};
    const reactions = getMessageReactions(metadata);
    const exists = reactions.some((reaction) => reaction.emoji === emoji && reaction.by === by);
    return {
        ...(metadata || {}),
        messageReactions: exists
            ? reactions.filter((reaction) => !(reaction.emoji === emoji && reaction.by === by))
            : [...reactions, { emoji, by, at }],
    };
};

export const addReactionToMetadata = (metadata: Record<string, any> | undefined, emojiInput: string, by: MessageReactionActor, at = Date.now()) => {
    const emoji = normalizeReactionEmoji(emojiInput);
    if (!emoji) return metadata || {};
    const reactions = getMessageReactions(metadata);
    if (reactions.some((reaction) => reaction.emoji === emoji && reaction.by === by)) return metadata || {};
    return { ...(metadata || {}), messageReactions: [...reactions, { emoji, by, at }] };
};

export const reactionSignature = (message: Message): string =>
    getMessageReactions(message).map((reaction) => `${reaction.emoji}:${reaction.by}:${reaction.at}`).join('|');

export const formatMessageReactionContext = (message: Message, charName = '你', userName = '用户'): string => {
    const reactions = getMessageReactions(message);
    if (!reactions.length) return '';
    const notes = reactions.map((reaction) => {
        if (reaction.by === 'assistant') return `[${charName}用 ${reaction.emoji} 回应了${userName}这条消息]`;
        return `[${userName}用 ${reaction.emoji} 回应了${charName}这条消息]`;
    });
    return `\n${notes.join(' ')}`;
};

// 模型有时会把提示里的规范双层括号简写成单层括号。
// 两种都属于控制标签，必须在落库前消费，不能让 `[REACT: ...]` 变成普通气泡。
// 双层分支放在前面，避免合法 `[[REACT:...]]` 被单层分支从第二个 `[` 开始误认。
const REACTION_TAG_RE = /(?:\[\[\s*REACT\s*[:：]\s*([^|｜\]\r\n]+?)(?:\s*[|｜]\s*([^\]\r\n]{0,120}?))?\s*\]\]|\[\s*REACT\s*[:：]\s*([^|｜\]\r\n]+?)(?:\s*[|｜]\s*([^\]\r\n]{0,120}?))?\s*\])/giu;
const LOOSE_REACTION_TAG_RE = /(?:\[\[\s*REACT\s*[:：][\s\S]*?\]\]|\[\s*REACT\s*[:：][^\]\r\n]*?\])/giu;

/**
 * 只用于历史消息的显示清理。新消息会在落库前由 extractMessageReactionCommands
 * 消费标签并写入 metadata；这里不再尝试补写 reaction，避免渲染阶段产生副作用。
 */
export const stripMessageReactionTags = (content: string): string => content.replace(LOOSE_REACTION_TAG_RE, '');

export const extractMessageReactionCommands = (content: string): { text: string; commands: MessageReactionCommand[] } => {
    const commands: MessageReactionCommand[] = [];
    content.replace(REACTION_TAG_RE, (_full, doubleEmojiRaw: string, doubleTargetRaw: string | undefined, singleEmojiRaw: string, singleTargetRaw: string | undefined) => {
        const emojiRaw = doubleEmojiRaw ?? singleEmojiRaw;
        const targetRaw = doubleEmojiRaw !== undefined ? doubleTargetRaw : singleTargetRaw;
        const emoji = normalizeReactionEmoji(emojiRaw);
        if (emoji) {
            const target = typeof targetRaw === 'string' ? targetRaw.trim().slice(0, 80) : '';
            commands.push({ emoji, ...(target ? { target } : {}) });
        }
        return '';
    });
    return { text: content.replace(LOOSE_REACTION_TAG_RE, '').trim(), commands };
};

const searchableContent = (message: Message): string => {
    const normalized = typeof message.content === 'string' ? message.content : '';
    return normalized.replace(/\s+/g, ' ').trim();
};

export const findReactionTarget = (messages: Message[], target?: string, beforeTimestamp?: number): Message | undefined => {
    const candidates = messages.filter((message) => message.role === 'user' && (beforeTimestamp == null || message.timestamp <= beforeTimestamp));
    const needle = (target || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (needle) {
        const matched = [...candidates].reverse().find((message) => searchableContent(message).toLocaleLowerCase().includes(needle));
        if (matched) return matched;
    }
    return candidates[candidates.length - 1];
};
