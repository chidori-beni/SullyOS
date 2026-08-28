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
]);

const isMetaLabel = (value: string): boolean => {
    const normalized = value.trim()
        .replace(/^[【\[（(「『]+|[】\]）)」』]+$/g, '')
        .trim()
        .toLocaleLowerCase();
    return META_LABELS.has(normalized);
};

const stripWrapping = (value: string): string => value
    .trim()
    .replace(/^```(?:text|txt|纯文本)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .replace(/^[「『“"'`]|[」』”"'`]$/g, '')
    .trim();

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
    if (typeof raw !== 'string') return null;
    let text = raw.trim();
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
    text = stripWrapping(text).replace(/\s+/g, ' ').trim();
    if (!text || isMetaLabel(text)) return null;
    return text.slice(0, 40);
};

export const isTaskCommentUsable = (value: unknown): value is string => Boolean(extractTaskComment(value));
