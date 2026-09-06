import type { DateObservation, DateObserveCustomField, Message } from '../types';
import { DatePrompts, extractObservation, hasObservation } from './datePrompts';
import { isDatePhoneBridge } from './datePhoneBridge';
import { nowInTimeZone, wallClockToTimestamp } from './timezone';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 普通对话允许自动推进的最大跨度；更大的跳转交给过场或手动校时。 */
export const SCENE_CLOCK_MAX_DIALOGUE_ADVANCE_MS = 12 * HOUR_MS;

export type ObservationSceneClockPrecision = 'exact' | 'approximate';

export interface ParsedObservationSceneClock {
    sceneClockAt: number;
    precision: ObservationSceneClockPrecision;
}

export type DialogueSceneClockResolution =
    | 'tag'
    | 'observation-exact'
    | 'observation-approximate'
    | 'unchanged'
    | 'missing'
    | 'invalid'
    | 'ambiguous'
    | 'conflict'
    | 'backward-rejected'
    | 'forward-rejected';

export interface DialogueSceneClockResult {
    content: string;
    observation: DateObservation | null;
    sceneClockAt: number;
    sceneClockAdvancedMs: number;
    sceneClockAdvancedDeltaMs: number;
    requestedSceneClockAt?: number;
    observedSceneClockText?: string;
    advanced: boolean;
    source?: 'tag' | 'observation';
    resolution: DialogueSceneClockResolution;
}

type ObservationParseAttempt = {
    parsed: ParsedObservationSceneClock | null;
    reason: 'missing' | 'invalid' | 'ambiguous';
};

const CHINESE_DIGITS: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
};

const parseNumberToken = (raw: string): number | null => {
    const token = raw.trim().replace(/\s+/g, '');
    if (!token) return null;
    if (/^\d+$/.test(token)) {
        const numeric = Number(token);
        return Number.isFinite(numeric) ? numeric : null;
    }
    if (![...token].every(char => char in CHINESE_DIGITS || char === '十')) return null;
    if (!token.includes('十')) {
        if (token.length !== 1) return null;
        return CHINESE_DIGITS[token] ?? null;
    }
    const [tensPart, onesPart] = token.split('十');
    const tens = tensPart ? CHINESE_DIGITS[tensPart] : 1;
    const ones = onesPart ? CHINESE_DIGITS[onesPart] : 0;
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const localDateText = (date: Date): string => (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
);

const shiftLocalDate = (date: Date, dayOffset: number): string => {
    const shifted = new Date(Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + dayOffset,
    ));
    return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

const weekdayValue = (token: string): number | null => {
    const normalized = token.trim().toLowerCase();
    if (/^[1-7]$/.test(normalized)) return Number(normalized) % 7;
    const chinese: Record<string, number> = {
        日: 0,
        天: 0,
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
    };
    if (normalized in chinese) return chinese[normalized];
    const english: Record<string, number> = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
    };
    return english[normalized] ?? null;
};

const makeWallClockTimestamp = (
    currentAt: number,
    timeZone: string | undefined,
    hour: number,
    minute: number,
    dayOffset: number,
): number | null => {
    const wallNow = nowInTimeZone(timeZone, new Date(currentAt));
    const dateText = dayOffset === 0 ? localDateText(wallNow) : shiftLocalDate(wallNow, dayOffset);
    const wallText = `${dateText} ${pad2(hour)}:${pad2(minute)}:00`;
    const timestamp = wallClockToTimestamp(wallText, timeZone);
    if (!Number.isFinite(timestamp)) return null;
    // DST gap（如纽约春季的 02:30）会被部分运行时自动滚到 03:30；
    // 只有墙钟往返仍等于目标时刻才允许提交。重叠时段则保持现有工具选出的确定结果。
    const roundTrip = nowInTimeZone(timeZone, new Date(timestamp));
    const roundTripText = `${localDateText(roundTrip)} ${pad2(roundTrip.getHours())}:${pad2(roundTrip.getMinutes())}:${pad2(roundTrip.getSeconds())}`;
    return roundTripText === wallText ? timestamp : null;
};

const hasTemporalWords = (value: string): boolean => (
    /时间|时刻|凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|深夜|半夜|午夜|夜里|夜间|晚间|明天|次日|第二天|隔天|后|前|刚才|稍后|一会儿|过一会|around|about|am|pm/i.test(value)
);

const parseRelativeObservationTime = (
    value: string,
    currentAt: number,
): ParsedObservationSceneClock | null => {
    const halfHour = value.match(/^(?:过了|又过了)?\s*半(?:个)?小时(?:后|之后|以后)/i);
    if (halfHour) {
        return { sceneClockAt: currentAt + 30 * MINUTE_MS, precision: 'exact' };
    }
    const amount = value.match(/^(?:过了|又过了)?\s*([0-9零〇一二两三四五六七八九十]+)\s*(分钟|分|小时|个小时|天|日)\s*(?:后|之后|以后)/i);
    if (!amount) return null;
    const numeric = parseNumberToken(amount[1]);
    if (numeric === null || numeric <= 0) return null;
    const unit = amount[2];
    const multiplier = /天|日/.test(unit)
        ? DAY_MS
        : /小时/.test(unit)
            ? HOUR_MS
            : MINUTE_MS;
    return { sceneClockAt: currentAt + numeric * multiplier, precision: 'exact' };
};

const parseObservationTimeInternal = (
    value: string,
    currentAt: number,
    timeZone?: string,
): ObservationParseAttempt => {
    const original = value.trim();
    if (!original) return { parsed: null, reason: 'missing' };
    if (/(?:以前|之前|刚才|刚刚|八分钟前|分钟前|小时前|前发生|ago|earlier)/i.test(original)) {
        return { parsed: null, reason: 'ambiguous' };
    }

    const strictDate = original.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)(?:\s|$|[，,。；;、])/);
    if (strictDate) {
        const parsed = DatePrompts.parseSceneClockInput(strictDate[1], timeZone);
        return parsed === null
            ? { parsed: null, reason: 'invalid' }
            : { parsed: { sceneClockAt: parsed, precision: 'exact' }, reason: 'invalid' };
    }

    const relative = parseRelativeObservationTime(original, currentAt);
    if (relative) return { parsed: relative, reason: 'invalid' };

    let text = original.replace(/^(?:约|大约|大概|around|about)\s*/i, '');
    let approximate = text !== original;
    let dayOffset = 0;
    let hasDayMarker = false;

    const weekday = text.match(/^(?:周|星期|礼拜)\s*([一二三四五六日天1-7])\s*/i)
        || text.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+/i);
    if (weekday) {
        const targetDay = weekdayValue(weekday[1]);
        if (targetDay === null) return { parsed: null, reason: 'invalid' };
        const wallNow = nowInTimeZone(timeZone, new Date(currentAt));
        dayOffset = (targetDay - wallNow.getDay() + 7) % 7;
        hasDayMarker = true;
        text = text.slice(weekday[0].length).trim();
    }

    const explicitNextDay = text.match(/^(次日|第二天|隔天|明天|tomorrow)\s*/i);
    if (explicitNextDay) {
        dayOffset += 1;
        hasDayMarker = true;
        text = text.slice(explicitNextDay[0].length).trim();
    }

    const qualifierMatch = text.match(/^(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|深夜|半夜|午夜|夜里|夜间|晚间|黎明|dawn|morning|afternoon|evening|night|midnight)\s*/i);
    const qualifier = qualifierMatch?.[1]?.toLowerCase() || '';
    if (qualifierMatch) text = text.slice(qualifierMatch[0].length).trim();

    const timeMatch = text.match(/^(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*(?::|：|点钟|点|時|时)\s*(?:(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*(?:分|分钟|min(?:ute)?s?)?)?(?:\s*(AM|PM))?(?:\s*(左右|上下|过|多|整点|整))?(?:\s*[，,。；;、].*)?$/i);
    if (!timeMatch) {
        return { parsed: null, reason: hasTemporalWords(original) ? 'ambiguous' : 'invalid' };
    }

    const hourToken = parseNumberToken(timeMatch[1]);
    const minuteToken = timeMatch[2] ? parseNumberToken(timeMatch[2]) : 0;
    const amPm = timeMatch[3]?.toUpperCase();
    const approximationToken = timeMatch[4];
    if (hourToken === null || minuteToken === null || hourToken < 0 || minuteToken < 0 || minuteToken > 59) {
        return { parsed: null, reason: 'invalid' };
    }
    if (/^\d{1,2}\s*[:：]/.test(text) && !timeMatch[2]) {
        return { parsed: null, reason: 'invalid' };
    }

    let hour = hourToken;
    if (amPm) {
        if (hour < 1 || hour > 12) return { parsed: null, reason: 'invalid' };
        if (amPm === 'AM' && hour === 12) hour = 0;
        if (amPm === 'PM' && hour < 12) hour += 12;
    } else if (qualifier) {
        if (hour > 23) return { parsed: null, reason: 'invalid' };
        if (/午夜|midnight/i.test(qualifier)) {
            if (hour > 12) return { parsed: null, reason: 'invalid' };
            if (hour === 12) hour = 0;
        } else if (/凌晨|清晨|早上|上午|黎明|dawn|morning/i.test(qualifier)) {
            if (hour > 12) return { parsed: null, reason: 'invalid' };
            if (hour === 12) hour = 0;
        } else if (/中午|下午|傍晚|晚上|深夜|半夜|夜里|夜间|晚间|afternoon|evening|night/i.test(qualifier)) {
            if (/晚上|深夜|半夜|夜里|夜间|晚间|evening|night/i.test(qualifier) && hour === 12) hour = 0;
            else if (hour >= 1 && hour <= 11) hour += 12;
        }
    } else {
        if (hour > 23) return { parsed: null, reason: 'invalid' };
        // 没有时段限定的 1–12 点无法区分上午/下午，宁可不推进。
        if (hour >= 1 && hour <= 12) return { parsed: null, reason: 'ambiguous' };
    }

    if (hour > 23) return { parsed: null, reason: 'invalid' };
    approximate = approximate || !timeMatch[2] || !!approximationToken;

    // 只有“深夜 → 凌晨”的窄规则允许无日期表达跨午夜；普通白天不会凭空换日。
    if (!hasDayMarker) {
        const wallNow = nowInTimeZone(timeZone, new Date(currentAt));
        if (wallNow.getHours() >= 22 && hour < 6 && hour < wallNow.getHours()) dayOffset = 1;
    }
    const timestamp = makeWallClockTimestamp(currentAt, timeZone, hour, minuteToken, dayOffset);
    if (timestamp === null) return { parsed: null, reason: 'invalid' };
    return {
        parsed: { sceneClockAt: timestamp, precision: approximate ? 'approximate' : 'exact' },
        reason: 'invalid',
    };
};

/** 只解析 OBSERVE 的时间字段，不扫描叙事正文。无法确定时返回 null。 */
export const parseObservationSceneClock = (
    value: string | undefined,
    currentAt: number,
    timeZone?: string,
): ParsedObservationSceneClock | null => parseObservationTimeInternal(value || '', currentAt, timeZone).parsed;

const resolveParseFailure = (attempt: ObservationParseAttempt): 'missing' | 'invalid' | 'ambiguous' => attempt.reason;

/**
 * 普通见面回复的剧情时钟解析器。
 *
 * 机器标签优先，OBSERVE.time 只作兼容回退；任何缺失、含糊、冲突、倒退或远跳
 * 都保持原时钟。函数本身不触碰 DB，调用方在消息落库边界做 revision CAS。
 */
export const resolveDialogueSceneClock = (input: {
    rawContent: string;
    observation?: DateObservation | null;
    currentAt: number;
    currentAdvancedMs?: number;
    timeZone?: string;
}): DialogueSceneClockResult => {
    const currentAt = Number.isFinite(input.currentAt) ? input.currentAt : Date.now();
    const currentAdvancedMs = Math.max(0, Number(input.currentAdvancedMs) || 0);
    const tag = DatePrompts.parseSceneClockTag(input.rawContent || '', input.timeZone);
    const observationTime = typeof input.observation?.time === 'string'
        ? input.observation.time.trim()
        : '';
    const observationAttempt = parseObservationTimeInternal(observationTime, currentAt, input.timeZone);
    const observationParsed = observationAttempt.parsed;
    const tagAt = tag.requestedAt;
    const source: 'tag' | 'observation' | undefined = tagAt !== undefined
        ? 'tag'
        : observationParsed
            ? 'observation'
            : undefined;
    const common = {
        content: tag.content.trim(),
        observation: input.observation || null,
        observedSceneClockText: observationTime || undefined,
        ...(source ? { source } : {}),
    };

    if (tagAt !== undefined && observationParsed && Math.floor(tagAt / MINUTE_MS) !== Math.floor(observationParsed.sceneClockAt / MINUTE_MS)) {
        return {
            ...common,
            sceneClockAt: currentAt,
            sceneClockAdvancedMs: currentAdvancedMs,
            sceneClockAdvancedDeltaMs: 0,
            requestedSceneClockAt: tagAt,
            advanced: false,
            resolution: 'conflict',
        };
    }

    const requestedAt = tagAt ?? observationParsed?.sceneClockAt;
    if (requestedAt === undefined) {
        const resolution = tag.resolution === 'invalid'
            ? 'invalid'
            : observationTime
                ? resolveParseFailure(observationAttempt)
                : 'missing';
        return {
            ...common,
            sceneClockAt: currentAt,
            sceneClockAdvancedMs: currentAdvancedMs,
            sceneClockAdvancedDeltaMs: 0,
            advanced: false,
            resolution,
        };
    }

    const sameMinute = Math.floor(requestedAt / MINUTE_MS) === Math.floor(currentAt / MINUTE_MS);
    const deltaMs = requestedAt - currentAt;
    if (sameMinute) {
        return {
            ...common,
            sceneClockAt: currentAt,
            sceneClockAdvancedMs: currentAdvancedMs,
            sceneClockAdvancedDeltaMs: 0,
            requestedSceneClockAt: requestedAt,
            advanced: false,
            resolution: 'unchanged',
        };
    }
    if (deltaMs < 0) {
        return {
            ...common,
            sceneClockAt: currentAt,
            sceneClockAdvancedMs: currentAdvancedMs,
            sceneClockAdvancedDeltaMs: 0,
            requestedSceneClockAt: requestedAt,
            advanced: false,
            resolution: 'backward-rejected',
        };
    }
    if (deltaMs > SCENE_CLOCK_MAX_DIALOGUE_ADVANCE_MS) {
        return {
            ...common,
            sceneClockAt: currentAt,
            sceneClockAdvancedMs: currentAdvancedMs,
            sceneClockAdvancedDeltaMs: 0,
            requestedSceneClockAt: requestedAt,
            advanced: false,
            resolution: 'forward-rejected',
        };
    }

    const resolution: DialogueSceneClockResolution = tagAt !== undefined
        ? 'tag'
        : observationParsed?.precision === 'approximate'
            ? 'observation-approximate'
            : 'observation-exact';
    return {
        ...common,
        sceneClockAt: requestedAt,
        sceneClockAdvancedMs: currentAdvancedMs + deltaMs,
        sceneClockAdvancedDeltaMs: deltaMs,
        requestedSceneClockAt: requestedAt,
        advanced: true,
        resolution,
    };
};

/**
 * 当前见面界面使用的单一时间快照。
 *
 * DateApp 生成它，DateSession 只消费它。这样左上角、立绘观测和阅读模式
 * 的“当前剧情时间”不会再分别从 runtime、state 和消息内容各取一份。
 */
export interface DateSceneSnapshot {
    sceneClockAt?: number;
    sceneClockAdvancedMs: number;
    sceneClockRevision: number;
    sceneClockUpdatedAt?: number;
    sceneClockTimeZone?: string;
    observation: DateObservation | null;
    source: 'runtime' | 'message' | 'saved' | 'timestamp';
    sceneClockSource?: string;
    sourceMessageId?: number;
}

export interface DateSceneClockSource {
    encounterId?: string;
    sceneClockAt?: number;
    sceneClockAdvancedMs?: number;
    sceneClockRevision?: number;
    sceneClockUpdatedAt?: number;
    sceneClockTimeZone?: string;
    sceneClockSource?: string;
}

export interface BuildDateSceneSnapshotInput {
    messages: Message[];
    encounterId?: string;
    runtime?: DateSceneClockSource | null;
    savedState?: DateSceneClockSource | null;
    observeEnabled?: boolean;
    customObservationFields?: DateObserveCustomField[];
    timeZone?: string;
}

type SceneClockCandidate = {
    at: number;
    advancedMs: number;
    revision: number;
    updatedAt?: number;
    timeZone?: string;
    clockSource?: string;
    source: DateSceneSnapshot['source'];
    sourceMessageId?: number;
    priority: number;
};

const finiteOrUndefined = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const isEligibleSceneAssistant = (
    message: Message,
    encounterId?: string,
    allowUnscopedLegacy = true,
): boolean => {
    if (message.role !== 'assistant' || isDatePhoneBridge(message)) return false;
    if (message.metadata?.isDateEnding === true) return false;
    if (message.metadata?.source && message.metadata.source !== 'date') return false;
    const messageEncounterId = typeof message.metadata?.dateEncounterId === 'string'
        ? message.metadata.dateEncounterId
        : undefined;
    return !encounterId
        || messageEncounterId === encounterId
        || (allowUnscopedLegacy && !messageEncounterId);
};

const candidateFromSource = (
    source: DateSceneClockSource | null | undefined,
    sourceKind: DateSceneSnapshot['source'],
    priority: number,
    sourceMessageId?: number,
): SceneClockCandidate | null => {
    const at = finiteOrUndefined(source?.sceneClockAt);
    if (at === undefined) return null;
    const advancedMs = Math.max(0, finiteOrUndefined(source?.sceneClockAdvancedMs) || 0);
    const revision = Math.max(0, Math.floor(finiteOrUndefined(source?.sceneClockRevision) || 0));
    return {
        at,
        advancedMs,
        revision,
        updatedAt: finiteOrUndefined(source?.sceneClockUpdatedAt),
        timeZone: typeof source?.sceneClockTimeZone === 'string' ? source.sceneClockTimeZone : undefined,
        clockSource: typeof source?.sceneClockSource === 'string' ? source.sceneClockSource : undefined,
        source: sourceKind,
        sourceMessageId,
        priority,
    };
};

const newerSceneClockCandidate = (
    current: SceneClockCandidate | null,
    next: SceneClockCandidate | null,
): SceneClockCandidate | null => {
    if (!current) return next;
    if (!next) return current;
    if (next.revision !== current.revision) return next.revision > current.revision ? next : current;
    if ((next.updatedAt || 0) !== (current.updatedAt || 0)) {
        return (next.updatedAt || 0) > (current.updatedAt || 0) ? next : current;
    }
    return next.priority > current.priority ? next : current;
};

/**
 * 从当前见面消息和持久化 runtime 生成统一的显示快照。
 * 消息 metadata 只作为已经提交的 checkpoint；OBSERVE.time 只负责提供当前
 * 观察原文，不能在渲染阶段再次推进剧情钟。旧数据的一次性迁移由 DateApp
 * 在进入会话的事件边界处理，避免 useMemo / 重渲染重复产生状态变化。
 */
export const buildDateSceneSnapshot = (
    input: BuildDateSceneSnapshotInput,
): DateSceneSnapshot | null => {
    const hasScopedEncounterMessage = !!input.encounterId && input.messages.some(message => (
        message.metadata?.source === 'date'
        && message.metadata?.dateEncounterId === input.encounterId
    ));
    const isCurrentEncounterAssistant = (message: Message): boolean => (
        isEligibleSceneAssistant(message, input.encounterId, !hasScopedEncounterMessage)
    );
    const latestAssistantMessage = [...input.messages].reverse().find(isCurrentEncounterAssistant);
    if (!latestAssistantMessage && !input.runtime && !input.savedState) return null;

    // 最新回复可能是旧格式、没有 checkpoint；此时仍从同一 encounter 的较早
    // assistant checkpoint 恢复，绝不退回用自然语言 observation 推算当前时刻。
    const latestCheckpointMessage = [...input.messages].reverse().find(message => (
        isCurrentEncounterAssistant(message)
        && finiteOrUndefined(message.metadata?.sceneClockAt) !== undefined
    ));
    const messageClock = candidateFromSource(
        latestCheckpointMessage?.metadata,
        'message',
        20,
        latestCheckpointMessage?.id,
    );
    let candidate = newerSceneClockCandidate(
        candidateFromSource(input.savedState, 'saved', 10),
        newerSceneClockCandidate(candidateFromSource(input.runtime, 'runtime', 30), messageClock),
    );

    if (!candidate && latestAssistantMessage) {
        candidate = {
            at: latestAssistantMessage.timestamp,
            advancedMs: 0,
            revision: 0,
            source: 'timestamp',
            sourceMessageId: latestAssistantMessage.id,
            priority: 0,
        };
    }
    if (!candidate) return null;

    const observation = latestAssistantMessage
        ? extractObservation(
            latestAssistantMessage.content,
            {
                lenient: input.observeEnabled === true,
                custom: input.customObservationFields,
            },
        )
        : null;
    const displayObservation = hasObservation(observation?.observation) ? observation.observation : null;
    const sceneClockAt = candidate.at;
    const sceneClockAdvancedMs = candidate.advancedMs;
    const sceneClockRevision = candidate.revision;
    const sceneClockUpdatedAt = candidate.updatedAt;
    const source = candidate.source;

    return {
        sceneClockAt,
        sceneClockAdvancedMs,
        sceneClockRevision,
        sceneClockUpdatedAt,
        sceneClockTimeZone: candidate.timeZone || input.timeZone,
        observation: displayObservation,
        source,
        sceneClockSource: candidate.clockSource,
        sourceMessageId: latestAssistantMessage?.id ?? candidate.sourceMessageId,
    };
};
