/**
 * Extract one user-facing sentence from the small comment generated below a task.
 *
 * Character cards can contain output schemas or mode names. A model occasionally
 * answers with the field name (for example "平时用语") instead of the sentence;
 * that is metadata, not a comment and must never be persisted as one.
 */

const META_LABELS = new Set([
    '平时用语', '日常用语', '评价', '评论', '角色评价', '待办评价', '台词',
    'comment', 'task comment', 'text', 'content', 'response', 'output',
    'due date', 'due_date', 'due-date', 'duedate', 'deadline', 'deadline date',
    // A character-card profile tag that has appeared in generated output. It is
    // not a sentence for the task and must not be persisted below the card.
    '留学生 in tokyo', '留学生intokyo',
]);

// Keep extraction deliberately lenient enough to preserve a short, natural
// model response while a repair request is running. Completeness is checked
// separately by `isTaskCommentUsable`; otherwise a rejected response makes the
// whole card line disappear before the retry has a chance to replace it.
const MIN_EXTRACTED_TASK_COMMENT_LENGTH = 3;
const MIN_COMPLETE_TASK_COMMENT_LENGTH = 12;
// Keep this high enough for a natural Chinese sentence plus a short second
// clause. The old 80-character ceiling rejected otherwise good in-character
// replies and silently replaced them with the generic fallback.
const MAX_COMPLETE_TASK_COMMENT_LENGTH = 160;

const isMetaLabel = (value: string): boolean => {
    const normalized = value.trim()
        .replace(/^[【\[（(「『]+|[】\]）)」』]+$/g, '')
        .replace(/[：:]+$/g, '')
        .trim()
        .toLocaleLowerCase();
    if (META_LABELS.has(normalized)) return true;
    // A provider may echo the field together with its value, e.g.
    // `Due date: 2026-08-28`. That is still schema metadata, not a sentence.
    if (/^(?:due\s*date|deadline)(?:\s*[:：-]|\s+\d|$)/i.test(normalized)) return true;
    // Some responses prefix the profile tag with punctuation, e.g.
    // `,留学生 in Tokyo`. Compare a compact form as well.
    const compact = normalized.replace(/[,，\s:：_\-–—]+/g, '');
    return compact === '留学生intokyo' || compact.startsWith('留学生intokyo');
};

// A model can copy the output protocol from the system prompt instead of
// speaking as the character. These are not user-facing comments even when
// they happen to end in punctuation (the exact regression was
// `Must end with proper terminal punctuation (. ! ? ......`).
const isPromptProtocolLeak = (value: string): boolean => {
    const normalized = value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    return /(?:must|should)\s+(?:end|finish|output|return|write)\b/.test(normalized)
        || /proper\s+terminal\s+punctuation|terminal\s+punctuation/.test(normalized)
        || /(?:only\s+output|do\s+not\s+(?:output|include|write)|without\s+(?:json|title|quotes?|prefix))\b/.test(normalized)
        || /(?:只输出|不要输出|必须以).*(?:台词|正文|标点|角色名|引号|句末)/.test(value);
};

// Some character cards expose a field such as `萧逸 (Xiao Yi)’s` when the
// model fills an English schema. It is an identity/possessive fragment, not a
// sentence. Keep this pattern narrow so a normal in-character sentence with a
// parenthetical aside is not discarded.
const isIdentityPossessiveFragment = (value: string): boolean => {
    const candidate = value.trim().replace(/[：:]+$/g, '').trim();
    if (!/[()（）]/.test(candidate) || !/(?:['’]s|的)\s*$/i.test(candidate)) return false;
    if (/[。！？!?，,；;]/.test(candidate)) return false;
    return /[\p{L}\p{N}\p{Script=Han}]/u.test(candidate);
};

const isLikelyCompleteSentence = (value: string): boolean => {
    // Allow a closing quote / bracket after the actual terminator. The normal
    // wrapper cleanup removes most of these already, but keeping this check
    // tolerant avoids rejecting a provider's harmless presentation wrapper.
    const withoutClosing = value.replace(/[」』”"'`）)\]】]+$/g, '').trim();
    return /[。！？!?…\.]+$/.test(withoutClosing);
};

const stripWrapping = (value: string): string => {
    let text = value
        .trim()
        .replace(/^```(?:text|txt|纯文本)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    // Only remove a pair when it actually wraps the whole response. The old
    // one-sided regex removed the opening quote from `“标题”已经...` first,
    // leaving the closing quote stranded in the middle of the sentence.
    const pairs: Array<[string, string]> = [
        ['「', '」'], ['『', '』'], ['“', '”'], ['"', '"'], ['`', '`'],
    ];
    for (const [opening, closing] of pairs) {
        if (text.startsWith(opening) && text.endsWith(closing) && text.length >= opening.length + closing.length) {
            text = text.slice(opening.length, text.length - closing.length).trim();
            break;
        }
    }
    return text;
};

/**
 * OpenAI-compatible providers do not all serialize message content the same
 * way. Text may be a string, an Anthropic-style block array, or an object with
 * a nested `text`/`content` field. Ignore thinking blocks: a task card should
 * never expose a model's private reasoning as the character's voice.
 */
const flattenTaskCommentContent = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(item => flattenTaskCommentContent(item)).filter(Boolean).join('');
    }
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    if (record.type === 'thinking' || record.type === 'reasoning' || record.type === 'redacted_thinking') return '';
    return flattenTaskCommentContent(record.text ?? record.content ?? record.value);
};

const extractFromObject = (value: Record<string, unknown>): string => {
    const preferred = ['平时用语', '日常用语', '评价', '评论', 'comment', 'text', 'content', 'response'];
    for (const key of preferred) {
        if (typeof value[key] === 'string') return value[key] as string;
    }
    const stringValue = Object.values(value).find(item => typeof item === 'string');
    return typeof stringValue === 'string' ? stringValue : '';
};

/** Returns null for an empty response or a field/mode name without a sentence. */
export const extractTaskComment = (raw: unknown): string | null => {
    let text = flattenTaskCommentContent(raw).trim();
    if (!text) return null;

    // Some OpenAI-compatible providers ignore the requested plain-text format
    // and return a tiny JSON object instead. Keep its value, not its field name.
    const candidate = stripWrapping(text);
    if ((candidate.startsWith('{') && candidate.endsWith('}')) || (candidate.startsWith('[') && candidate.endsWith(']'))) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            if (Array.isArray(parsed)) text = parsed.find(item => typeof item === 'string') as string || '';
            else if (parsed && typeof parsed === 'object') text = extractFromObject(parsed as Record<string, unknown>);
        } catch {
            // Keep treating it as plain text below; the response may contain
            // harmless braces from a role's custom speech style.
        }
    }

    text = stripWrapping(text);
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    // A mode name on its own line is a wrapper, while a real following line is
    // the content we want. This handles `平时用语\n记得带伞`.
    while (lines.length > 1 && isMetaLabel(lines[0].replace(/[：:]$/, ''))) lines.shift();
    text = lines.join(' ');
    text = text.replace(/^(?:平时用语|日常用语|评价|评论|角色评价|待办评价|comment|task\s*comment|text|content|response|output)\s*[:：\-]\s*/i, '').trim();
    // Task cards already show the speaker name, so presentation quotes are not
    // part of the stored sentence. Removing them here also repairs old rows
    // where only the opening quote was stripped and a lone `”` was persisted.
    text = stripWrapping(text).replace(/[「」『』“”"]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || isMetaLabel(text) || isIdentityPossessiveFragment(text) || isPromptProtocolLeak(text)) return null;
    if ([...text].filter(character => !/\s/.test(character)).length < MIN_EXTRACTED_TASK_COMMENT_LENGTH) return null;
    return text;
};

export const isTaskCommentUsable = (value: unknown): value is string => {
    const text = extractTaskComment(value);
    if (!text) return false;
    const effectiveLength = [...text].filter(character => !/\s/.test(character)).length;
    return effectiveLength >= MIN_COMPLETE_TASK_COMMENT_LENGTH
        && text.length <= MAX_COMPLETE_TASK_COMMENT_LENGTH
        && isLikelyCompleteSentence(text);
};

const normalizeCommentForTemplateCheck = (value: string): string =>
    value.replace(/[\s，。！？；：,.!?;:、]/g, '');

const shortTitleForTemplateCheck = (value: string): string => {
    const title = value.trim().replace(/[“”"']/g, '').replace(/\s+/g, ' ');
    return [...title].slice(0, 18).join('');
};

/**
 * Reject the old canned task copy even when it passes the sentence parser.
 * A single ordinary phrase is not enough to reject a real character voice:
 * `慢慢来，别急。` can be perfectly in character. Combinations of template
 * phrases or a line that echoes the task title are still not useful.
 */
export const isTaskCommentTooGeneric = (value: unknown, taskTitle = ''): boolean => {
    const text = extractTaskComment(value);
    if (!text) return true;
    const compact = normalizeCommentForTemplateCheck(text);
    const title = normalizeCommentForTemplateCheck(shortTitleForTemplateCheck(taskTitle));
    const templateMarkers = [
        '我替你记着', '先记在这儿', '准备好了就去做', '等你做完了',
        '回来告诉我', '回来跟我说', '辛苦你', '辛苦了', '先歇一会儿',
        '先喘口气', '慢慢来', '任务完成', '完成确认', '应用提醒',
    ];
    const markerHits = templateMarkers.filter(marker => compact.includes(marker)).length;
    const titleEcho = !!title && compact.includes(title);
    return markerHits >= 2 || (markerHits >= 1 && titleEcho);
};

/**
 * A task comment is safe to show after content/schema cleanup and the
 * anti-template check. Do not require punctuation or twelve characters here:
 * both are useful generation hints, but natural character speech can be short
 * (`去吧。`) or intentionally omit a final full stop. The strict helper above
 * remains available for callers that specifically need a complete sentence.
 */
export const isTaskCommentDisplayable = (value: unknown, taskTitle = ''): value is string => {
    const text = extractTaskComment(value);
    if (!text) return false;
    const effectiveLength = [...text].filter(character => !/\s/.test(character)).length;
    return effectiveLength >= 3
        && text.length <= MAX_COMPLETE_TASK_COMMENT_LENGTH
        && !isTaskCommentTooGeneric(text, taskTitle);
};

/**
 * Put the speaker in front of a persisted task sentence without duplicating a
 * prefix if an older provider response already included the role name.
 */
export const formatTaskComment = (speakerName: string | undefined, value: unknown): string | null => {
    const text = extractTaskComment(value);
    if (!text) return null;
    const name = speakerName?.trim() || '角色';
    const rest = text.slice(0, name.length).toLocaleLowerCase() === name.toLocaleLowerCase()
        ? text.slice(name.length)
        : '';
    if (rest && /^\s*[:：-]/.test(rest)) {
        return `${name}：${rest.replace(/^\s*[:：-]\s*/, '')}`;
    }
    return `${name}：${text}`;
};
