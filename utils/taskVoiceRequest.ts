/**
 * Small, side-channel-only helpers for calendar task voice requests.
 *
 * Task comments are optional UI enrichment, not the main chat turn. They must
 * never retry a chat completion automatically: a provider may already have
 * accepted the first request, and sending another one can duplicate billing
 * or amplify a rate-limit incident.
 */

export const TASK_VOICE_DEFAULT_COOLDOWN_MS = 60_000;
export const TASK_VOICE_MAX_COOLDOWN_MS = 10 * 60_000;

export const parseRetryAfterMs = (
    header: string | null | undefined,
    now = Date.now(),
): number | null => {
    if (!header?.trim()) return null;
    const value = header.trim();
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(TASK_VOICE_MAX_COOLDOWN_MS, Math.ceil(seconds * 1000));
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    return Math.min(TASK_VOICE_MAX_COOLDOWN_MS, Math.max(0, timestamp - now));
};

export class TaskVoiceApiError extends Error {
    readonly status?: number;
    readonly retryAfterMs?: number | null;
    readonly providerMessage?: string;

    constructor(
        message: string,
        options: { status?: number; retryAfterMs?: number | null; providerMessage?: string } = {},
    ) {
        super(message);
        this.name = 'TaskVoiceApiError';
        this.status = options.status;
        this.retryAfterMs = options.retryAfterMs;
        this.providerMessage = options.providerMessage;
    }
}

export const isTaskVoiceRateLimitError = (error: unknown): boolean => {
    if (error instanceof TaskVoiceApiError) return error.status === 429;
    if (!error || typeof error !== 'object') return false;
    const status = (error as { status?: unknown }).status;
    return status === 429 || (error instanceof Error && /(?:API\s+)?Error\s+429\b/.test(error.message));
};

export const getTaskVoiceRetryAfterMs = (error: unknown): number | null => {
    if (!(error instanceof TaskVoiceApiError)) return null;
    return error.retryAfterMs ?? null;
};
