import type { APIConfig, CharacterProfile, Task } from '../types';
import { safeFetchJson } from './safeApi';
import { extractTaskComment, isTaskCommentGenerationAcceptable } from './taskComment';
import { buildTaskSupervisorMessages } from './taskSupervisorPrompt';

/**
 * The supervisor is an optional UI side-channel. It intentionally uses the
 * same small two-message shape as the working monthly-letter request, but it
 * does not retry: a second automatic completion can duplicate billing and
 * make a rate-limit incident worse.
 */
export const TASK_SUPERVISOR_VOICE_TIMEOUT_MS = 60_000;
export const TASK_SUPERVISOR_VOICE_MAX_TOKENS = 512;

export interface TaskSupervisorVoiceRequestOptions {
    character: CharacterProfile;
    task: Task;
    apiConfig: APIConfig;
    userName?: string;
    calendarContext?: string;
}

export interface TaskSupervisorVoiceResponse {
    text: string | null;
    finishReason?: string;
    contentType: string;
    visibleChars: number;
}

const THINKING_BLOCK_TYPES = new Set([
    'thinking', 'reasoning', 'analysis', 'thought',
    'redacted_thinking', 'redacted_reasoning', 'redacted_analysis',
]);
const VISIBLE_TEXT_BLOCK_TYPES = new Set(['text', 'output_text']);

const valueTypeName = (value: unknown): string => {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
};

/** Read only explicit visible content blocks. Never search reasoning fields. */
const visibleText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(item => visibleText(item)).filter(Boolean).join('');
    }
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type.toLocaleLowerCase() : '';
    if (THINKING_BLOCK_TYPES.has(type)) return '';
    if (type && !VISIBLE_TEXT_BLOCK_TYPES.has(type)) return '';
    if (typeof record.text === 'string') return record.text;
    // A few OpenAI-compatible gateways omit `type` on a text block but still
    // provide the explicit `text` field. Do not recursively walk unknown keys.
    return '';
};

const normalizeFinishReason = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const normalized = value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
    if (['length', 'maxtokens', 'maxoutputtokens', 'maxcompletiontokens', 'tokenlimit', 'outputlimit'].includes(normalized)) return 'length';
    if (['contentfilter', 'safety', 'blocked', 'recitation', 'refusal'].includes(normalized)) return 'blocked';
    if (['stop', 'endturn', 'end'].includes(normalized)) return 'stop';
    return value.trim();
};

const looksLikeStructuredOutput = (value: string): boolean => {
    const trimmed = value.trim();
    return trimmed.startsWith('```')
        || ((trimmed.startsWith('{') || trimmed.startsWith('['))
            && (trimmed.endsWith('}') || trimmed.endsWith(']')));
};

const looksLikeTaskDataLabel = (value: string): boolean =>
    /^(?:【|\[|（|\()?\s*(?:用户(?:当前日程|本地时间|资料|信息)|当前日程|用户备注|待办内容|截止(?:日期|时间)|角色(?:名|卡|资料)|写作人格|世界观)\s*[】\]\)）]?\s*[:：]/i.test(value.trim());

/**
 * Chat-completions task voice accepts only choices[0].message.content. In
 * particular it does not accept choice.text, root.output, JSON rescue, or
 * reasoning_content. Those compatibility fallbacks were useful elsewhere,
 * but are exactly how a prompt/schema fragment can reach a task card.
 */
export const extractTaskSupervisorVoiceResponse = (data: unknown): TaskSupervisorVoiceResponse => {
    const root = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const choices = Array.isArray(root.choices) ? root.choices : [];
    const choice = choices[0] && typeof choices[0] === 'object'
        ? choices[0] as Record<string, unknown>
        : undefined;
    const message = choice?.message && typeof choice.message === 'object'
        ? choice.message as Record<string, unknown>
        : undefined;
    const content = message?.content;
    const raw = visibleText(content);
    const normalized = raw.trim();
    const text = normalized && !looksLikeStructuredOutput(normalized) && !looksLikeTaskDataLabel(normalized)
        ? extractTaskComment(normalized)
        : null;
    return {
        text,
        finishReason: normalizeFinishReason(choice?.finish_reason),
        contentType: valueTypeName(content),
        visibleChars: [...normalized.replace(/\s/g, '')].length,
    };
};

const buildSafeTaskVoiceError = (): Error => new Error('角色没有说出可展示的自然台词');

/**
 * One short request, one strict visible-content gate, and no hidden fallback.
 * The task has already been saved before this function is called, so every
 * error here is allowed to leave the task untouched.
 */
export const requestTaskSupervisorVoice = async (
    options: TaskSupervisorVoiceRequestOptions,
): Promise<string> => {
    const baseUrl = options.apiConfig.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) throw new Error('请先在设置中配置主聊天 API');

    const messages = buildTaskSupervisorMessages({
        character: options.character,
        task: options.task,
        completed: true,
        userName: options.userName,
        calendarContext: options.calendarContext,
    });
    const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiConfig.apiKey || 'sk-none'}`,
        },
        body: JSON.stringify({
            model: options.apiConfig.model,
            messages,
            temperature: 0.82,
            max_tokens: TASK_SUPERVISOR_VOICE_MAX_TOKENS,
            stream: false,
        }),
    }, 0, TASK_SUPERVISOR_VOICE_TIMEOUT_MS, {
        appName: '日历',
        charId: options.character.id,
        charName: options.character.name,
        purpose: '完成待办监督台词生成',
    });

    const response = extractTaskSupervisorVoiceResponse(data);
    if (response.finishReason === 'blocked' || response.finishReason === 'length') {
        throw buildSafeTaskVoiceError();
    }
    if (!response.text || !isTaskCommentGenerationAcceptable(response.text, options.task.title)) {
        throw buildSafeTaskVoiceError();
    }
    return response.text;
};

type TaskVoiceLock = object;
type TaskVoiceLockManager = {
    request: (
        name: string,
        options: { ifAvailable: true },
        callback: (lock: TaskVoiceLock | null) => Promise<void> | void,
    ) => Promise<void>;
};

const localTaskVoiceRuns = new Map<string, Promise<boolean>>();

const getTaskVoiceLockManager = (): TaskVoiceLockManager | undefined => {
    if (typeof navigator === 'undefined') return undefined;
    return (navigator as Navigator & { locks?: TaskVoiceLockManager }).locks;
};

/**
 * Deduplicate an event in this tab and, where Chromium exposes Web Locks,
 * across tabs too. A tab that loses the lock simply lets the winner write the
 * result; the caller can reload its local task list afterwards.
 */
export const runTaskSupervisorVoiceOnce = (
    eventId: string,
    job: () => Promise<void>,
): Promise<boolean> => {
    const existing = localTaskVoiceRuns.get(eventId);
    if (existing) return existing;

    const run = (async () => {
        const locks = getTaskVoiceLockManager();
        if (!locks) {
            await job();
            return true;
        }
        let acquired = false;
        await locks.request(`sully-task-supervisor:${eventId}`, { ifAvailable: true }, async lock => {
            if (!lock) return;
            acquired = true;
            await job();
        });
        return acquired;
    })();

    let tracked: Promise<boolean>;
    tracked = run.then(
        value => {
            if (localTaskVoiceRuns.get(eventId) === tracked) localTaskVoiceRuns.delete(eventId);
            return value;
        },
        error => {
            if (localTaskVoiceRuns.get(eventId) === tracked) localTaskVoiceRuns.delete(eventId);
            throw error;
        },
    );
    localTaskVoiceRuns.set(eventId, tracked);
    return tracked;
};
