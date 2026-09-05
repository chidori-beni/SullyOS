import type { DialogueItem } from '../types';
import { cleanVoiceMarkupForDisplay, VALID_EMOTIONS, VALID_INTERJECTION_TAGS } from './minimaxTts';
import { stripMessageReactionTags } from './messageReactions';
import { stripFaceToFacePhoneSourceTags } from './sanitize';

const VOICE_EMOTION_TAG_RE = /\[v:\s*([a-zA-Z]+)\s*\]/i;
const INTERJECTION_TAG_RE = /\(([^)]{1,80})\)/g;
const QUOTE_SPAN_RE = /"([^"]*)"|“([^”]*)”|「([^」]*)」/g;

const isValidInterjection = (inner: string): boolean =>
    VALID_INTERJECTION_TAGS.has(inner.trim().toLowerCase());

const extractValidInterjectionTags = (text: string): string[] => {
    return [...text.matchAll(INTERJECTION_TAG_RE)]
        .filter(([, inner]) => isValidInterjection(inner))
        .map(([, inner]) => `(${inner.trim().toLowerCase()})`);
};

const getQuoteContent = (match: RegExpMatchArray): string => match[1] ?? match[2] ?? match[3] ?? '';

/**
 * 见面正文的统一显示清洗：保留普通括号，只隐藏给 TTS 的 MiniMax 标签/停顿，
 * 并沿用见面已有的情绪、反应和手机桥接标记清洗规则。
 */
export const cleanDateTextForDisplay = (text?: string | null): string => {
    if (!text) return '';
    return cleanVoiceMarkupForDisplay(
        stripFaceToFacePhoneSourceTags(stripMessageReactionTags(text.replace(/\[.*?\]/g, ''))),
    ).trim();
};

/** 只把“开头就是引号”的行当作可播放台词，旁白中的偶发引号不算。 */
export const isDateDialogueLine = (text: string): boolean => {
    return /^["“「]/.test(cleanDateTextForDisplay(text));
};

/**
 * 从一行台词中提取显示用的纯引号内容。这个函数只用于旧快照/兜底，
 * TTS 应使用 extractDateDialogueSpeechText，以免丢失语气词。
 */
export const extractDateDialogueText = (text: string): string => {
    const matches = [...text.matchAll(QUOTE_SPAN_RE)];
    if (matches.length > 0) {
        return cleanDateTextForDisplay(matches.map(getQuoteContent).join(' '));
    }
    return cleanDateTextForDisplay(text);
};

/**
 * 提取 TTS 专用文本：去掉引号本身，但保留引号内、引号前后以及多段引号之间
 * 的官方 MiniMax 语气词。未知的普通括号不在这里擅自改写，最终交给 provider
 * cleaner 按既有白名单规则处理。
 */
export const extractDateDialogueSpeechText = (text: string): string => {
    const matches = [...text.matchAll(QUOTE_SPAN_RE)];
    if (matches.length === 0) return '';

    const parts: string[] = [];
    let cursor = 0;
    for (const match of matches) {
        const start = match.index ?? 0;
        parts.push(...extractValidInterjectionTags(text.slice(cursor, start)));
        parts.push(getQuoteContent(match));
        cursor = start + match[0].length;
    }
    parts.push(...extractValidInterjectionTags(text.slice(cursor)));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
};

export const extractDateVoiceEmotionTag = (line: string): { voiceEmotion?: string; rest: string } => {
    let voiceEmotion: string | undefined;
    const rest = line.replace(VOICE_EMOTION_TAG_RE, (_match, emotion: string) => {
        const normalized = (emotion || '').toLowerCase();
        if (VALID_EMOTIONS.has(normalized)) voiceEmotion = normalized;
        return '';
    });
    return { voiceEmotion, rest };
};

const isContextNoise = (line: string): boolean => {
    const normalized = line.trim().toLowerCase();
    if (normalized.startsWith('(') && normalized.endsWith(')')) {
        if (normalized.includes('in person') || normalized.includes('face-to-face') || normalized.includes('location') || normalized.includes('time')) return true;
    }
    if (normalized.startsWith('[system') || normalized.startsWith('(system')) return true;
    return false;
};

type DateLineParts = {
    content: string;
    emotion: string;
    voiceEmotion?: string;
};

const splitDateLineParts = (rawLine: string, currentEmotion: string): DateLineParts => {
    const { voiceEmotion, rest } = extractDateVoiceEmotionTag(rawLine);
    const line = rest.trim();
    const tagMatch = line.match(/^\[([a-zA-Z0-9_\-]+)\]\s*(.*)/);
    if (tagMatch) {
        return {
            content: tagMatch[2].trim(),
            emotion: tagMatch[1].toLowerCase(),
            voiceEmotion,
        };
    }
    return { content: line, emotion: currentEmotion, voiceEmotion };
};

export const parseDateDialogueLine = (rawLine: string, initialEmotion: string = 'normal'): DialogueItem | null => {
    if (!rawLine?.trim() || isContextNoise(rawLine)) return null;
    const parts = splitDateLineParts(rawLine.trim(), initialEmotion);
    const displayText = cleanDateTextForDisplay(parts.content);
    if (!displayText) return null;

    const speechText = extractDateDialogueSpeechText(parts.content);
    return {
        text: displayText,
        ...(speechText ? { speechText } : {}),
        emotion: parts.emotion,
        voiceEmotion: parts.voiceEmotion,
    };
};

export const parseDateDialogue = (fullText: string, initialEmotion: string = 'normal'): DialogueItem[] => {
    if (!fullText) return [];
    const results: DialogueItem[] = [];
    let currentEmotion = initialEmotion;

    for (const rawLine of fullText.split('\n').map(line => line.trim()).filter(Boolean)) {
        if (isContextNoise(rawLine)) continue;
        const parts = splitDateLineParts(rawLine, currentEmotion);
        // A standalone [emotion] line changes the following sprite but does not
        // create an empty visible/TTS line.
        currentEmotion = parts.emotion;
        if (!parts.content) continue;

        const displayText = cleanDateTextForDisplay(parts.content);
        if (!displayText) continue;
        const speechText = extractDateDialogueSpeechText(parts.content);
        results.push({
            text: displayText,
            ...(speechText ? { speechText } : {}),
            emotion: currentEmotion,
            voiceEmotion: parts.voiceEmotion,
        });
    }
    return results;
};

export const hasDateMiniMaxInterjection = (text?: string | null): boolean => {
    if (!text) return false;
    return [...text.matchAll(INTERJECTION_TAG_RE)].some(([, inner]) => isValidInterjection(inner));
};

/**
 * 只在没有模型标签时，为一整段回复补一个极保守的语气声。
 * 这是 TTS 专用字段的兜底，不改 item.text，所以正文、收藏和翻译显示不受影响。
 */
export const inferDateMiniMaxInterjection = (text: string, voiceEmotion?: string): string => {
    const normalized = cleanDateTextForDisplay(text).replace(/["“”「」]/g, '');
    if (/(哈哈|呵呵|嘿嘿|笑|好笑|有趣)/.test(normalized)) return 'chuckle';
    if (/(唉|叹气|叹|累|困|疲惫|抱歉|对不起|算了)/.test(normalized)
        || voiceEmotion === 'sad' || voiceEmotion === 'fearful') {
        return 'sighs';
    }
    return 'breath';
};

export const addFallbackDateInterjectionToReply = (
    items: DialogueItem[],
    enabled: boolean = true,
): DialogueItem[] => {
    if (!enabled || items.length === 0) return items;

    const hasExistingTag = items.some(item =>
        hasDateMiniMaxInterjection(item.speechText || item.text),
    );
    if (hasExistingTag) return items;

    const index = items.findIndex(item => {
        if (!isDateDialogueLine(item.text)) return false;
        const speechText = item.speechText || extractDateDialogueSpeechText(item.text);
        return speechText.replace(/\(([^)]{1,80})\)/g, '').trim().length >= 4;
    });
    if (index < 0) return items;

    const item = items[index];
    const speechText = item.speechText || extractDateDialogueSpeechText(item.text);
    if (!speechText) return items;
    const tag = inferDateMiniMaxInterjection(item.text, item.voiceEmotion);
    const nextSpeechText = tag === 'chuckle'
        ? speechText + ' (chuckle)'
        : '(' + tag + ') ' + speechText;

    return items.map((candidate, itemIndex) =>
        itemIndex === index ? { ...candidate, speechText: nextSpeechText } : candidate,
    );
};

type ProtectedVoiceTag = { token: string; tag: string };

export type ProtectedMiniMaxInterjections = {
    text: string;
    hasTags: boolean;
    /** Returns null if translation changed, dropped, or duplicated a protected tag. */
    restore: (translated: string) => string | null;
};

/**
 * Protect MiniMax's inline tags while an optional voice-language translation runs.
 * A failed placeholder check falls back to the original source text, which is safer
 * than sending a translated sentence with silently missing acting cues.
 */
export const protectMiniMaxInterjectionsForTranslation = (text: string): ProtectedMiniMaxInterjections => {
    const tags: ProtectedVoiceTag[] = [];
    const protectedText = text.replace(INTERJECTION_TAG_RE, (match, inner: string) => {
        const normalized = inner.trim().toLowerCase();
        if (!VALID_INTERJECTION_TAGS.has(normalized)) return match;
        const token = `SULLYMMVOICECUE${tags.length}END`;
        tags.push({ token, tag: `(${normalized})` });
        return token;
    });

    return {
        text: protectedText,
        hasTags: tags.length > 0,
        restore: (translated: string): string | null => {
            if (tags.length === 0) return translated;
            for (const { token } of tags) {
                if (translated.split(token).length - 1 !== 1) return null;
            }
            return tags.reduce((result, { token, tag }) => result.replace(token, tag), translated);
        },
    };
};
