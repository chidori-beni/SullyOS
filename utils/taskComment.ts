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

// Extraction is deliberately separate from the strict generation gate below:
// old, already-saved short speech can remain readable while a new response is
// retried and checked before it is written back to IndexedDB.
// Nuoji's supervisor can naturally answer with very short speech such as
// “嗯” or “去吧”. Length is not a reliable proxy for whether a response is
// visible speech; protocol/meta detection below does that job.
const MIN_EXTRACTED_TASK_COMMENT_LENGTH = 1;
const MIN_COMPLETE_TASK_COMMENT_LENGTH = 12;
// Keep this high enough for a natural Chinese sentence plus a short second
// clause. The old 80-character ceiling rejected otherwise good in-character
// replies and silently replaced them with the generic fallback.
const MAX_COMPLETE_TASK_COMMENT_LENGTH = 160;

const THINKING_BLOCK_TYPES = new Set([
    'thinking', 'reasoning', 'analysis', 'thought',
    'redacted_thinking', 'redacted_reasoning', 'redacted_analysis',
]);
const VISIBLE_TEXT_BLOCK_TYPES = new Set(['text', 'output_text']);
const RESPONSE_CONTAINER_TYPES = new Set(['message', 'content', 'output', 'response']);

export interface TaskCommentPolicyContext {
    /** The character's writing profile, used only for source-aware leak checks. */
    writerPersona?: string;
}

/**
 * Stored task voices are versioned separately from the task schema.  This lets
 * the UI hide sentences written by an older, over-broad prompt without
 * deleting the user's task or silently reusing a possibly private line.
 */
export const TASK_COMMENT_SAFETY_VERSION = 2;

export interface TaskCommentSafetyContext {
    /** Current task title/note and explicitly user-entered calendar text. */
    taskTexts?: string[];
    /** Private local-only source text; this is never serialized into the API request. */
    forbiddenEchoTexts?: string[];
    stage?: 'pending' | 'completed';
    safetyVersion?: number;
}

const normalizeSafetyText = (value: string): string => value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、,.!?;:/／＼|｜'"“”‘’`()[\]{}<>《》【】]/g, '');

/** A response ending in these tokens is almost always a truncated/protocol line. */
const hasIncompleteTaskCommentEnding = (value: string): boolean => {
    const text = value.trim();
    return /[\/\\／＼|｜，、：；:;([{]$/.test(text)
        || /(?:因为|如果|但是|然后|以及|并且|为了)$/.test(text);
};

const TASK_COMMENT_URL_RE = /(?:https?:\/\/|www\.)\S+/i;
const TASK_COMMENT_EMAIL_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const TASK_COMMENT_PHONE_RE = /(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)/;
const TASK_COMMENT_PRIVATE_LABEL_RE = /(?:电话|手机号|手机号码|邮箱|电子邮件|微信|QQ|LINE|Telegram|地址|身份证|护照|银行卡|密码|验证码)/i;
const TASK_COMMENT_PROFILE_PATTERNS: RegExp[] = [
    /(?:在|于|来自|住在|居住在|就读于|工作于|留学于)[\p{Script=Han}\p{L}\p{N}·\s]{0,24}(?:留学|留学生|就读|上学|大学|学院|学校|公司|工作|居住|住在)/u,
    /(?:日本|东京|大阪|京都)[\p{Script=Han}\p{L}\p{N}·\s]{0,12}(?:留学|留学生|就读|上学|大学|学院|学校|公司|工作|居住|住在)/u,
    /(?:我|用户|本人|你|对方).{0,12}(?:在|于|来自|住在|就读于|工作于|留学于).{0,20}(?:日本|东京|大阪|京都|学校|大学|公司|留学|留学生|居住|工作)/iu,
    /(?:留学生|留学)\s*(?:in|at|from)\s*(?:tokyo|japan|osaka|kyoto)/i,
];

const taskTextCoversPrivatePhrase = (candidate: string, taskTexts: string[]): boolean => {
    const candidateText = normalizeSafetyText(candidate)
        .replace(/^(?:我|你|他|她|用户|本人|对方|在|于|从|去|就|是)+/u, '')
        .replace(/(?:吧|呢|啊|呀|了|哦|嘛)+$/u, '');
    if (candidateText.length < 4) return false;
    return taskTexts.some(task => normalizeSafetyText(task).includes(candidateText));
};

/** High-confidence personal-data patterns that must never become a card line. */
const hasHighConfidencePrivateProfileLeak = (value: string, taskTexts: string[]): boolean => {
    if (TASK_COMMENT_URL_RE.test(value)
        || TASK_COMMENT_EMAIL_RE.test(value)
        || TASK_COMMENT_PHONE_RE.test(value)
        || TASK_COMMENT_PRIVATE_LABEL_RE.test(value)) return true;
    return TASK_COMMENT_PROFILE_PATTERNS.some(pattern => {
        const match = value.match(pattern)?.[0];
        if (!match) return false;
        return !taskTextCoversPrivatePhrase(match, taskTexts);
    });
};

/**
 * Catch a model copying a salient private phrase from a local memory/profile
 * source.  The source strings are deliberately accepted as an argument only
 * for an in-memory comparison; callers must never put this context in JSON.
 */
const containsForbiddenEcho = (
    candidate: string,
    forbiddenSources: string[],
    taskTexts: string[],
): boolean => {
    const normalizedCandidate = normalizeSafetyText(candidate);
    const candidateCharacters = Array.from(normalizedCandidate);
    const minimumLength = /[\p{Script=Han}]/u.test(candidate) ? 6 : 12;
    if (candidateCharacters.length < minimumLength) return false;
    const normalizedTasks = taskTexts
        .map(normalizeSafetyText)
        .filter(text => text.length >= minimumLength);

    for (const source of forbiddenSources) {
        const normalizedSource = normalizeSafetyText(source).slice(0, 4_000);
        if (normalizedSource.length < minimumLength) continue;
        for (let start = 0; start <= candidateCharacters.length - minimumLength; start += 1) {
            const maxLength = Math.min(candidateCharacters.length - start, 32);
            for (let length = minimumLength; length <= maxLength; length += 1) {
                const fragment = candidateCharacters.slice(start, start + length).join('');
                if (!fragment || normalizedTasks.some(task => task.includes(fragment))) continue;
                if (normalizedSource.includes(fragment)) return true;
            }
        }
    }
    return false;
};

const isTaskCommentSafetyAcceptable = (
    value: string,
    safety: TaskCommentSafetyContext = {},
): boolean => !hasIncompleteTaskCommentEnding(value)
    && !hasHighConfidencePrivateProfileLeak(value, safety.taskTexts || [])
    && !containsForbiddenEcho(value, safety.forbiddenEchoTexts || [], safety.taskTexts || []);

const stripThinkingBlocks = (value: string): string => value
    .replace(/<(think|thinking|thought|analysis|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|thinking|thought|analysis|reasoning)>[\s\S]*$/gi, '');

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

/**
 * A provider may copy the speaker prefix before leaking a style instruction,
 * for example `萧逸：. Uses casual, succinct language.`. Remove that prefix
 * only for policy matching; the original text is never rewritten from this
 * normalized value.
 */
const stripLikelySpeakerPrefixForPolicy = (value: string): string => value
    .normalize('NFKC')
    .replace(/^\s*([\p{Script=Han}\p{L}\p{N}][\p{Script=Han}\p{L}\p{N}\s·._'’-]{0,31})\s*[：:]\s*/u, (match, prefix: string) => {
        const normalizedPrefix = prefix.trim();
        const isStyleLabel = /^(?:writing|speaking|communication)\s+(?:style|tone|voice)$/i.test(normalizedPrefix)
            || /^(?:写作|说话|表达|沟通)(?:风格|语气|方式|口吻|措辞)$/.test(normalizedPrefix);
        return isStyleLabel ? match : '';
    })
    .replace(/^[\s.。,:：;；!！?？、—–-]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

const isHighConfidenceWriterPersonaMetaLine = (value: string): boolean => {
    const normalized = stripLikelySpeakerPrefixForPolicy(value);
    if (!normalized) return false;

    // Keep this intentionally structural. A normal line such as
    // `I use that café all the time.` must not be rejected merely because it
    // contains `use`; the leak has a style noun and an instruction-like shape.
    const englishMeta = /^(?:(?:uses?|speaks?|writes?|responds?|answers?|communicates?)\s+(?:a\s+)?[^.!?\n]{0,100}\b(?:language|tone|style|voice|manner|wording)\b|(?:writing|speaking|communication)\s+(?:style|tone|voice)\s*[:\-]\s*[^.!?\n]{1,100}|(?:use|write|speak|respond|answer)\s+(?:in\s+)?(?:a\s+)?[^.!?\n]{0,100}\b(?:language|tone|style|voice|manner|wording)\b|(?:he|she|they|the\s+character|character)\s+(?:uses?|speaks?|writes?|responds?|answers?)\s+[^.!?\n]{0,100}\b(?:language|tone|style|voice|manner|wording)\b)[.!?]*$/i.test(normalized);
    if (englishMeta) return true;

    const chineseMeta = /^(?:(?:写作|说话|表达|沟通)(?:风格|语气|方式|口吻|措辞)\s*[:：\-]\s*[^。！？.!?\n]{1,80}|(?:使用|采用|保持|以|用)[^。！？.!?\n]{0,80}(?:语言|语气|口吻|风格|措辞)|(?:回复|回答|说话|表达)(?:时)?(?:要|应|需)?(?:保持|使用|采用)[^。！？.!?\n]{0,80}(?:语言|语气|口吻|风格|措辞))[。！？.!?]*$/u.test(normalized);
    return chineseMeta;
};

const splitPolicySegments = (value: string): string[] => value
    .split(/\r?\n|(?<=[。！？!?])\s+/u)
    .map(segment => segment.trim())
    .filter(Boolean);

/** True when a visible candidate is an instruction/profile fragment. */
const isWriterPersonaMetaLeak = (value: string, writerPersona?: string): boolean => {
    if (splitPolicySegments(value).some(isHighConfidenceWriterPersonaMetaLine)) return true;
    if (!writerPersona?.trim()) return false;

    // A generated writer profile can contain a longer, role-specific style
    // sentence. Compare only profile fragments that already look like
    // metadata; matching the entire persona would wrongly reject an example
    // line that the character naturally reuses.
    const candidate = stripLikelySpeakerPrefixForPolicy(value)
        .toLocaleLowerCase()
        .replace(/[\s，。！？；：,.!?;:、'"“”‘’`()[\]{}]+/g, '');
    if (candidate.length < 12) return false;
    return splitPolicySegments(writerPersona).some(fragment => {
        if (!isHighConfidenceWriterPersonaMetaLine(fragment)) return false;
        const profile = stripLikelySpeakerPrefixForPolicy(fragment)
            .toLocaleLowerCase()
            .replace(/[\s，。！？；：,.!?;:、'"“”‘’`()[\]{}]+/g, '');
        if (profile.length < 12) return false;
        return candidate === profile || candidate.includes(profile) || profile.includes(candidate);
    });
};

// A model can copy the output protocol from the system prompt instead of
// speaking as the character. These are not user-facing comments even when
// they happen to end in punctuation (the exact regression was
// `Must end with proper terminal punctuation (. ! ? ......`).
const isPromptProtocolLeak = (value: string): boolean => {
    const normalized = value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const hasProtocolToken = /(?:reasoning[_ ]?content|chain\s+of\s+thought|system\s+prompt|developer\s+(?:message|instruction)|output\s+protocol|思维链|思考过程|推理过程|系统提示|开发者消息|\b(?:json|xml|yaml|schema|nsfw)\b)/i.test(normalized);
    const hasMetaRelation = /(?:规则|字段|格式|协议|提示词|提到|提及|要求|规定|输出|返回|生成|调用|上下文|分析|推理|according\s+to|based\s+on|mention|output|return)/i.test(normalized);
    const startsAsReasoning = /(?:^|\s)(?:analysis|reasoning|thinking|thought|assistant|system|developer|user|final|思考|分析|推理|结论)\s*[:：]/i.test(normalized);
    const echoesPromptContext = /(?:角色卡|世界书|用户画像|写作人格|聊天历史|系统消息|字段名|输出协议|根据上述|基于上下文)/i.test(value);
    const hasStructuredProtocolKey = /[{}]|```|["'](?:analysis|reasoning|thinking|content|role)["']\s*:/i.test(value);
    const narratesGenerationProcess = /(?:我(?:需要|先|应该|得)|接下来|首先|然后|最后|让我(?:先)?)(?:.{0,24})(?:分析|思考|推理|组织语言|生成|输出|任务|上下文|人设)/i.test(value);
    const englishGenerationProcess = /(?:\b(?:i|we)\s+(?:need|should|must|will)\b|\bthe\s+user\b)(?:.{0,80})\b(?:analy[sz]e|reason|generate|output|respond|task|character)\b/i.test(value);
    return /(?:must|should)\s+(?:end|finish|output|return|write)\b/.test(normalized)
        || /proper\s+terminal\s+punctuation|terminal\s+punctuation/.test(normalized)
        || /(?:only\s+output|do\s+not\s+(?:output|include|write)|without\s+(?:json|title|quotes?|prefix))\b/.test(normalized)
        || /(?:只输出|不要输出|必须以).*(?:台词|正文|标点|角色名|引号|句末)/.test(value)
        || startsAsReasoning
        || echoesPromptContext
        || hasStructuredProtocolKey
        || narratesGenerationProcess
        || englishGenerationProcess
        || (hasProtocolToken && hasMetaRelation)
        || isWriterPersonaMetaLeak(value);
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

const hasVisibleSpeechCharacter = (value: string): boolean =>
    /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(value);

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
    if (typeof value === 'string') return stripThinkingBlocks(value);
    if (Array.isArray(value)) {
        return value.map(item => flattenTaskCommentContent(item)).filter(Boolean).join('');
    }
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type.toLocaleLowerCase() : '';
    if (THINKING_BLOCK_TYPES.has(type)) return '';
    if (type && !VISIBLE_TEXT_BLOCK_TYPES.has(type) && !RESPONSE_CONTAINER_TYPES.has(type)) return '';
    if (VISIBLE_TEXT_BLOCK_TYPES.has(type)) return flattenTaskCommentContent(record.text ?? record.content ?? record.value);
    if ('text' in record) return flattenTaskCommentContent(record.text);
    if ('content' in record) return flattenTaskCommentContent(record.content);
    if ('value' in record) return flattenTaskCommentContent(record.value);
    return '';
};

const extractFromObject = (value: Record<string, unknown>): string => {
    const preferred = ['平时用语', '日常用语', '评价', '评论', 'comment', 'text', 'content', 'response', 'output_text', 'value'];
    for (const key of preferred) {
        if (!(key in value)) continue;
        const candidate = flattenTaskCommentContent(value[key]);
        if (candidate.trim()) return candidate;
    }
    return '';
};

const hasPrivateResponseField = (value: Record<string, unknown>): boolean => Object.keys(value)
    .some(key => /^(?:analysis|reasoning|reasoning_content|thinking|thought|chain_of_thought|hidden_reasoning)$/i.test(key));

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
            else if (parsed && typeof parsed === 'object') {
                const record = parsed as Record<string, unknown>;
                if (hasPrivateResponseField(record)) return null;
                text = extractFromObject(record);
            }
        } catch {
            // Keep treating it as plain text below; the response may contain
            // harmless braces from a role's custom speech style.
        }
    }

    text = stripThinkingBlocks(stripWrapping(text));
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
    if (!text
        || !hasVisibleSpeechCharacter(text)
        || isMetaLabel(text)
        || isIdentityPossessiveFragment(text)
        || isPromptProtocolLeak(text)
        || hasIncompleteTaskCommentEnding(text)) return null;
    if ([...text].filter(character => !/\s/.test(character)).length < MIN_EXTRACTED_TASK_COMMENT_LENGTH) return null;
    return text;
};

/**
 * Extract only a provider's explicit visible-output slot for a task voice.
 * In particular, do not fall back to reasoning_content/reasoning/thinking:
 * those fields are useful to the chat thinking-chain UI but can never become
 * a sentence persisted below a task.
 */
export const extractTaskCommentResponse = (data: unknown): string | null => {
    if (!data || typeof data !== 'object') return null;
    const root = data as Record<string, unknown>;
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const choice = choices[0] && typeof choices[0] === 'object'
        ? choices[0] as Record<string, unknown>
        : undefined;
    const message = choice?.message && typeof choice.message === 'object'
        ? choice.message as Record<string, unknown>
        : undefined;
    const candidates: unknown[] = [
        message?.content,
        choice?.text,
        root.output_text,
        // Responses-style payloads are accepted only through their explicit
        // output container; unknown debug fields are never searched.
        root.output,
    ];
    for (const candidate of candidates) {
        const visible = flattenTaskCommentContent(candidate);
        if (!visible.trim()) continue;
        const text = extractTaskComment(visible);
        if (text) return text;
    }
    return null;
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

const hasMeaningfulTitleOverlap = (text: string, title: string): boolean => {
    if (!title || title.length < 2) return false;
    const compactText = normalizeCommentForTemplateCheck(text);
    const compactTitle = normalizeCommentForTemplateCheck(title);
    if (compactText.includes(compactTitle)) return true;
    let longest = 0;
    for (let start = 0; start < compactTitle.length; start += 1) {
        for (let end = start + 2; end <= compactTitle.length; end += 1) {
            const part = compactTitle.slice(start, end);
            if ([...part].every(character => /[\p{Script=Han}\p{L}\p{N}]/u.test(character)) && compactText.includes(part)) {
                longest = Math.max(longest, part.length);
            }
        }
    }
    return longest >= 2;
};

const isLikelyTaskEcho = (value: string, taskTitle: string): boolean => {
    const title = shortTitleForTemplateCheck(taskTitle);
    if (!hasMeaningfulTitleOverlap(value, title)) return false;
    return /(?:又打算|打算去|准备去|要去|进货|采购|搞定|完成|任务|待办|提醒|提到|输出|生成)/i.test(value)
        && [...value].filter(character => !/\s/.test(character)).length <= title.length + 12;
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
 * Strict gate for anything newly generated or used to repair an old row.
 * It deliberately allows short complete speech such as `去吧。`, while
 * refusing unfinished task echoes and protocol/reasoning fragments.
 */
export const isTaskCommentGenerationAcceptable = (
    value: unknown,
    taskTitle = '',
    policy: TaskCommentPolicyContext = {},
    safety: TaskCommentSafetyContext = {},
): value is string => {
    const text = extractTaskComment(value);
    if (!text) return false;
    const effectiveLength = [...text].filter(character => !/\s/.test(character)).length;
    const effectiveSafety: TaskCommentSafetyContext = {
        ...safety,
        taskTexts: [taskTitle, ...(safety.taskTexts || [])].filter(Boolean),
    };
    return effectiveLength >= MIN_EXTRACTED_TASK_COMMENT_LENGTH
        && text.length <= MAX_COMPLETE_TASK_COMMENT_LENGTH
        && hasVisibleSpeechCharacter(text)
        && !isWriterPersonaMetaLeak(text, policy.writerPersona)
        && !isTaskCommentTooGeneric(text, taskTitle)
        && !isLikelyTaskEcho(text, taskTitle)
        && isTaskCommentSafetyAcceptable(text, effectiveSafety);
};

/**
 * A task comment is safe to show after content/schema cleanup and the
 * anti-template check. Do not require punctuation or twelve characters here:
 * both are useful generation hints, but natural character speech can be short
 * (`去吧。`) or intentionally omit a final full stop. The strict helper above
 * remains available for callers that specifically need a complete sentence.
 */
export const isTaskCommentDisplayable = (
    value: unknown,
    taskTitle = '',
    policy: TaskCommentPolicyContext = {},
    safety: TaskCommentSafetyContext = {},
): value is string => {
    const text = extractTaskComment(value);
    if (!text) return false;
    const effectiveLength = [...text].filter(character => !/\s/.test(character)).length;
    const effectiveSafety: TaskCommentSafetyContext = {
        ...safety,
        taskTexts: [taskTitle, ...(safety.taskTexts || [])].filter(Boolean),
    };
    return effectiveLength >= MIN_EXTRACTED_TASK_COMMENT_LENGTH
        && text.length <= MAX_COMPLETE_TASK_COMMENT_LENGTH
        && hasVisibleSpeechCharacter(text)
        && !isWriterPersonaMetaLeak(text, policy.writerPersona)
        && !isTaskCommentTooGeneric(text, taskTitle)
        && !isLikelyTaskEcho(text, taskTitle)
        && isTaskCommentSafetyAcceptable(text, effectiveSafety);
};

/** True when a stored value should be replaced by one fresh, strict reply. */
export const shouldRepairTaskComment = (
    value: unknown,
    taskTitle = '',
    policy: TaskCommentPolicyContext = {},
    safety: TaskCommentSafetyContext = {},
): boolean => {
    const hasStoredValue = typeof value === 'string'
        ? value.trim().length > 0
        : value !== null && value !== undefined;
    return hasStoredValue && !isTaskCommentGenerationAcceptable(value, taskTitle, policy, safety);
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
