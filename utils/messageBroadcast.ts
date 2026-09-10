import type { Message } from '../types';
import { sanitizeForBubble } from './sanitize';
import { parseVoiceOutput } from './minimaxTts';

/**
 * 群发只复制“普通文字”，不把聊天记录卡、系统事件或模型协议带给别的角色。
 * 语音标签本身是已知的可转换格式：取气泡外的文字；纯语音消息则取语音文字。
 * 其它 XML / 双中括号 / 双语协议不猜测清理，直接拒绝，避免误发内部指令。
 */
const UNSUPPORTED_MARKER_RE = /(?:\[\[|\]\]|%%(?:BILINGUAL|TRANS)%%)/i;
const UNSUPPORTED_BRACKET_MARKER_RE = /(?:\[html\]|\[\/html\]|\[(?:QUOTE|引用)\s*[:：]|\[回复\s*["“])/i;
const TAG_RE = /<\s*\/?\s*([A-Za-z\u3400-\u9fff][\w\u3400-\u9fff-]*)[^>]*>/g;
const TAG_START_RE = /<\s*\/?\s*([A-Za-z\u3400-\u9fff][\w\u3400-\u9fff-]*)/g;
const ALLOWED_TAGS = new Set(['语音', '語音', '字幕']);
const UNSUPPORTED_TAG_RE = /^(翻译|原文|译文|think|thinking|thought)$/i;

const hasUnsupportedMarkup = (raw: string): boolean => {
    if (UNSUPPORTED_MARKER_RE.test(raw) || UNSUPPORTED_BRACKET_MARKER_RE.test(raw)) return true;
    TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_RE.exec(raw)) !== null) {
        if (!ALLOWED_TAGS.has(match[1])) return true;
    }
    // 不让截断的协议标签绕过完整标签扫描；普通的数学比较式（如 1 < 2）不匹配。
    TAG_START_RE.lastIndex = 0;
    while ((match = TAG_START_RE.exec(raw)) !== null) {
        const tagName = match[1];
        const rest = raw.slice(match.index);
        if (!/^<\s*\/?\s*[A-Za-z\u3400-\u9fff][\w\u3400-\u9fff-]*[^>]*>/.test(rest)) return true;
        if (UNSUPPORTED_TAG_RE.test(tagName)) return true;
    }
    return false;
};

/** 返回群发时真正要写入目标聊天的文字；不符合条件时返回 null。 */
export const prepareBroadcastText = (message: Message | null | undefined): string | null => {
    if (!message || message.role === 'system' || message.type !== 'text') return null;
    const raw = typeof message.content === 'string' ? message.content : '';
    if (!raw.trim() || hasUnsupportedMarkup(raw)) return null;

    const parsedVoice = parseVoiceOutput(raw);
    // 语音标签可能是历史消息里唯一的正文；没有外部文字时保留口播内容。
    const candidate = parsedVoice.hasVoiceTag
        ? (parsedVoice.display.trim() || parsedVoice.speech.trim())
        : raw;
    if (!candidate.trim()) return null;

    const cleaned = sanitizeForBubble(candidate).trim();
    return cleaned || null;
};

export const isBroadcastableMessage = (message: Message | null | undefined): boolean =>
    prepareBroadcastText(message) !== null;
