import type { CharacterProfile } from '../../types';
import { nowInTimeZone, resolveCharTimeZone, wallClockToTimestamp } from '../timezone';

/** 自主活动读取到的角色状态；busy/sleep 只会让本轮顺延，不会强行调用模型。 */
export type VRAutonomyActivityState = 'free' | 'light' | 'busy' | 'sleep' | 'unavailable';

export interface VRAutonomyProfile {
    /** 画像只轻微调节频率，不决定角色永远不活动。 */
    baseDelayMinutes: number;
    minDelayMinutes: number;
    maxDelayMinutes: number;
    checkpointHour: number;
    checkpointMinute: number;
    fingerprint: string;
}

export interface VRAutonomyPlan {
    version: 1;
    charId: string;
    dayKey: string;
    nextNaturalAt: number;
    /** 当天还没有成功活动时的软保障检查点。 */
    dailyCheckpointAt: number;
    /** busy/sleep/API 错误等原因的低频重查，不计作一次活动。 */
    retryNotBefore?: number;
    planSequence: number;
    reason?: string;
    profileFingerprint: string;
    /** 避免 visibility/focus/轮询在同一轮重复抢到同一角色。 */
    claimedUntil?: number;
}

const MIN_DELAY_MINUTES = 75;
const MAX_DELAY_MINUTES = 8 * 60;
const DAILY_CHECKPOINT_GRACE_MINUTES = 5;
const DAILY_CHECKPOINT_JITTER_MINUTES = 16;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeText = (value: unknown): string => typeof value === 'string' ? value.toLowerCase() : '';

const countMatches = (text: string, patterns: RegExp[]): number =>
    patterns.reduce((count, pattern) => count + (text.match(pattern)?.length || 0), 0);

const stableHash = (value: string): number => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const formatDayKey = (wall: Date): string =>
    `${wall.getFullYear().toString().padStart(4, '0')}-${(wall.getMonth() + 1).toString().padStart(2, '0')}-${wall.getDate().toString().padStart(2, '0')}`;

/** 用角色自己的时区取日历日；未设置时跟随设备时区。 */
export const getCharacterLocalDayKey = (timestamp: number = Date.now(), timeZone?: string): string =>
    formatDayKey(nowInTimeZone(timeZone, new Date(timestamp)));

const shiftDayKey = (dayKey: string, amount: number): string => {
    const parsed = new Date(`${dayKey}T12:00:00`);
    if (!Number.isFinite(parsed.getTime())) return dayKey;
    parsed.setDate(parsed.getDate() + amount);
    return formatDayKey(parsed);
};

const localTimestamp = (dayKey: string, hour: number, minute: number, timeZone?: string): number =>
    wallClockToTimestamp(
        `${dayKey} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        timeZone,
    );

/**
 * 从角色已有的人设字段做一个确定性的本地轻量画像。
 * 不调用模型，也不读取“自然主动”开关：想不出明确倾向时就用中性频率。
 */
export const deriveVRAutonomyProfile = (char: Pick<CharacterProfile, 'id' | 'description' | 'systemPrompt' | 'worldview' | 'writerPersona' | 'personalityStyle'>): VRAutonomyProfile => {
    const text = [char.description, char.worldview, char.writerPersona, char.systemPrompt]
        .map(normalizeText)
        .filter(Boolean)
        .join('\n')
        .slice(0, 36_000);
    const social = countMatches(text, [
        /外向|热情|活泼|爱玩|好奇|探索|冒险|社交|热闹|话多|闲不住|黏人|粘人|精力旺盛/g,
        /outgoing|social|curious|adventurous|energetic|chatty|clingy|restless/g,
    ]);
    const solitary = countMatches(text, [
        /安静|独处|冷淡|疏离|慢热|寡言|内向|克制|宅|谨慎|疲惫|懒散|独立/g,
        /quiet|solitary|reserved|introvert|aloof|independent|low[- ]key|tired/g,
    ]);
    const routine = countMatches(text, [
        /规律|自律|按时|习惯|计划|固定|秩序/g,
        /routine|disciplined|schedule|orderly|habitual/g,
    ]);
    const nocturnal = countMatches(text, [
        /夜猫|熬夜|夜行|夜晚精神|深夜/g,
        /nocturnal|night owl|awake at night/g,
    ]);

    const drive = clamp(social - solitary, -4, 4);
    const baseDelayMinutes = clamp(260 - drive * 28 - routine * 6, 150, 360);
    const minDelayMinutes = clamp(baseDelayMinutes * (routine > 0 ? 0.55 : 0.45), MIN_DELAY_MINUTES, 210);
    const maxDelayMinutes = clamp(baseDelayMinutes * (routine > 0 ? 1.7 : 2.1), 360, MAX_DELAY_MINUTES);
    const fingerprint = [
        char.id,
        text,
        char.personalityStyle || '',
        Math.round(baseDelayMinutes),
        Math.round(minDelayMinutes),
        Math.round(maxDelayMinutes),
    ].join('|');

    return {
        baseDelayMinutes,
        minDelayMinutes,
        maxDelayMinutes,
        checkpointHour: nocturnal > 0 ? 21 : 19,
        checkpointMinute: 30,
        fingerprint: `${stableHash(fingerprint).toString(36)}:${fingerprint.length}`,
    };
};

/** 当前空闲程度对下一次自然活动的影响：free 更容易出门，light 适当放慢。 */
export const computeNaturalDelayMinutes = (
    profile: VRAutonomyProfile,
    activityState: VRAutonomyActivityState = 'free',
    random: () => number = Math.random,
): number => {
    const raw = Number(random());
    const jitter = 0.78 + (Number.isFinite(raw) ? clamp(raw, 0, 0.999999) : 0.5) * 0.52;
    const stateMultiplier = activityState === 'light' ? 1.25 : activityState === 'unavailable' ? 1.65 : 1;
    return Math.round(clamp(profile.baseDelayMinutes * jitter * stateMultiplier, profile.minDelayMinutes, profile.maxDelayMinutes));
};

/**
 * 每天的软保障时刻。它不是硬闹钟：忙/睡、PWA 未运行或 API 失败都可以顺延。
 * 以角色 id + 当地日期抖开，避免所有角色同一秒一起调用。
 */
export const computeDailyCheckpoint = (
    charId: string,
    dayKey: string,
    profile: VRAutonomyProfile,
    timeZone?: string,
): number => {
    const jitter = stableHash(`${charId}:${dayKey}`) % DAILY_CHECKPOINT_JITTER_MINUTES;
    const minute = profile.checkpointMinute + jitter;
    const hourCarry = Math.floor(minute / 60);
    const wallMinute = minute % 60;
    return localTimestamp(dayKey, profile.checkpointHour + hourCarry, wallMinute, timeZone);
};

const sameLocalDay = (a: number | undefined, b: number, timeZone?: string): boolean =>
    !!a && getCharacterLocalDayKey(a, timeZone) === getCharacterLocalDayKey(b, timeZone);

const randomGrace = (charId: string, dayKey: string): number =>
    DAILY_CHECKPOINT_GRACE_MINUTES + (stableHash(`${charId}:grace:${dayKey}`) % 16);

/** 建立一份持久化的自主计划；只在首次启用、日切或画像发生变化时调用。 */
export const createVRAutonomyPlan = (input: {
    char: Pick<CharacterProfile, 'id' | 'description' | 'systemPrompt' | 'worldview' | 'writerPersona' | 'personalityStyle' | 'customTimezoneEnabled' | 'customTimezone'>;
    now?: number;
    lastActiveAt?: number;
    planSequence?: number;
    activityState?: VRAutonomyActivityState;
    random?: () => number;
}): VRAutonomyPlan => {
    const now = input.now ?? Date.now();
    const timeZone = resolveCharTimeZone(input.char);
    const profile = deriveVRAutonomyProfile(input.char);
    const dayKey = getCharacterLocalDayKey(now, timeZone);
    const completedToday = sameLocalDay(input.lastActiveAt, now, timeZone);
    let dailyCheckpointAt = computeDailyCheckpoint(input.char.id, dayKey, profile, timeZone);
    if (completedToday || dailyCheckpointAt <= now) {
        if (completedToday) {
            const nextDay = shiftDayKey(dayKey, 1);
            dailyCheckpointAt = computeDailyCheckpoint(input.char.id, nextDay, profile, timeZone);
        } else {
            dailyCheckpointAt = now + randomGrace(input.char.id, dayKey) * 60_000;
        }
    }
    const naturalAt = now + computeNaturalDelayMinutes(profile, input.activityState || 'free', input.random || Math.random) * 60_000;
    return {
        version: 1,
        charId: input.char.id,
        dayKey,
        nextNaturalAt: naturalAt,
        dailyCheckpointAt,
        planSequence: Math.max(1, Math.floor(input.planSequence || 1)),
        profileFingerprint: profile.fingerprint,
    };
};

/** 计划跨日或今日已成功活动后，修正检查点但不重新抽自然时间。 */
export const normalizeVRAutonomyPlan = (
    plan: VRAutonomyPlan,
    input: {
        char: Pick<CharacterProfile, 'id' | 'description' | 'systemPrompt' | 'worldview' | 'writerPersona' | 'personalityStyle' | 'customTimezoneEnabled' | 'customTimezone'>;
        now?: number;
        lastActiveAt?: number;
    },
): VRAutonomyPlan => {
    const now = input.now ?? Date.now();
    const timeZone = resolveCharTimeZone(input.char);
    const profile = deriveVRAutonomyProfile(input.char);
    const dayKey = getCharacterLocalDayKey(now, timeZone);
    const needsNewDay = plan.dayKey !== dayKey;
    const completedToday = sameLocalDay(input.lastActiveAt, now, timeZone);
    const checkpointPassed = plan.dailyCheckpointAt <= now;
    if (needsNewDay) {
        return createVRAutonomyPlan({ char: input.char, now, lastActiveAt: input.lastActiveAt, planSequence: plan.planSequence + 1 });
    }
    if (completedToday && checkpointPassed) {
        return {
            ...plan,
            dailyCheckpointAt: computeDailyCheckpoint(input.char.id, shiftDayKey(dayKey, 1), profile, timeZone),
            retryNotBefore: undefined,
            claimedUntil: undefined,
            reason: undefined,
            profileFingerprint: profile.fingerprint,
        };
    }
    if (plan.profileFingerprint !== profile.fingerprint) {
        return {
            ...plan,
            profileFingerprint: profile.fingerprint,
            nextNaturalAt: Math.max(plan.nextNaturalAt, now + profile.minDelayMinutes * 60_000),
        };
    }
    return plan;
};

/** 被 busy/sleep 或暂时性错误挡住时，只安排本地重查，不消耗模型调用。 */
export const autonomousRetryDelayMinutes = (
    reason?: string,
    random: () => number = Math.random,
): number => {
    const raw = Number(random());
    const jitter = Number.isFinite(raw) ? clamp(raw, 0, 0.999999) : 0.5;
    if (reason === 'schedule-sleep') return Math.round(60 + jitter * 60);
    if (reason === 'schedule-busy') return Math.round(30 + jitter * 30);
    if (reason === 'schedule-unavailable') return Math.round(90 + jitter * 90);
    if (reason === 'no-content') return Math.round(90 + jitter * 60);
    if (reason === 'too-soon') return 15;
    return Math.round(45 + jitter * 45);
};

export const isVRAutonomyPlanDue = (plan: VRAutonomyPlan, now: number = Date.now()): boolean => {
    const dueAt = Math.min(plan.nextNaturalAt, plan.dailyCheckpointAt);
    return now >= dueAt && now >= (plan.retryNotBefore || 0) && now >= (plan.claimedUntil || 0);
};

export const autonomyPlanNextAt = (plan: VRAutonomyPlan): number =>
    Math.max(Math.min(plan.nextNaturalAt, plan.dailyCheckpointAt), plan.retryNotBefore || 0, plan.claimedUntil || 0);
