/**
 * 「彼方」自主登入调度器。
 *
 * 复用 proactiveChat.ts 经过验证的稳态定时模式：
 *   - 前台：单个精确 setTimeout 命中下一个到期时刻（前台计时器准）
 *   - visibilitychange / focus：回到前台时立刻补火 + 重排（后台节流会延迟）
 *   - 主线程 20s 轮询：最后兜底，防止精确计时器被后台节流卡死
 *
 * 但用**独立的存储键**（vr_schedules / vr_last_fire），和主动发消息
 * (proactive_schedules) 各自独立、互不挤占触发。
 *
 * 说明：v1 不接 Service Worker / Cloudflare 云端唤醒（那套 channel 与
 * proactive 强绑定）。前台精确计时 + 可见性补火已能覆盖"用户打开 App 时
 * 角色按时登入"的核心诉求；云端加速可后续叠加。
 */

import type { CharacterProfile, VRSARActivity } from '../../types';
import {
    autonomyPlanNextAt,
    autonomousRetryDelayMinutes,
    createVRAutonomyPlan,
    isVRAutonomyPlanDue,
    normalizeVRAutonomyPlan,
    type VRAutonomyActivityState,
    type VRAutonomyPlan,
} from './autonomy';

export interface VRSchedule {
    charId: string;
    intervalMs: number;
}

type ScheduleMap = Record<string, VRSchedule>;
type LastFireMap = Record<string, number>;
type FailStreakMap = Record<string, number>;
type AutonomyPlanMap = Record<string, VRAutonomyPlan>;

/** 一轮活动的结局。`skipped` = 压根没调模型（没书没歌、房间被占、角色没接入），不算账。 */
export type VRSessionOutcome = 'ok' | 'failed' | 'skipped';

const STORAGE_KEY = 'vr_schedules';
const LAST_FIRE_KEY = 'vr_last_fire';
const FAIL_STREAK_KEY = 'vr_fail_streak';
const AUTONOMY_PLANS_KEY = 'vr_autonomy_plans_v1';
const AUTONOMY_CLAIM_MS = 15 * 60_000;

/**
 * 连着失败这么多次，就掐掉这个角色的自主登入。
 *
 * 彼方整个跑在后台：令牌被停用、余额耗尽这类「再试也不会好」的故障，用户在界面上
 * 一点都看不见，只会在几小时后翻调用记录时发现全是红的。攒够这个数就停调度、把角色
 * 落回未接入，让它自己收手，而不是通宵一轮轮撞下去。
 */
export const VR_FAIL_LIMIT = 3;

function load<T>(key: string): T {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
    } catch {
        return {} as T;
    }
}

function save(key: string, value: object) {
    if (Object.keys(value).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
}

const loadSchedules = () => load<ScheduleMap>(STORAGE_KEY);
const saveSchedules = (s: ScheduleMap) => save(STORAGE_KEY, s);
const loadLastFire = () => load<LastFireMap>(LAST_FIRE_KEY);
const saveLastFire = (m: LastFireMap) => save(LAST_FIRE_KEY, m);
const loadFailStreak = () => load<FailStreakMap>(FAIL_STREAK_KEY);
const saveFailStreak = (m: FailStreakMap) => save(FAIL_STREAK_KEY, m);
const loadAutonomyPlans = () => load<AutonomyPlanMap>(AUTONOMY_PLANS_KEY);
const saveAutonomyPlans = (m: AutonomyPlanMap) => save(AUTONOMY_PLANS_KEY, m);

function removeFailStreak(charId: string) {
    const m = loadFailStreak();
    if (m[charId] === undefined) return;
    delete m[charId];
    saveFailStreak(m);
}

function getLastFire(charId: string): number {
    return loadLastFire()[charId] || 0;
}
function setLastFire(charId: string, ts: number) {
    const m = loadLastFire();
    m[charId] = ts;
    saveLastFire(m);
}
function removeLastFire(charId: string) {
    const m = loadLastFire();
    delete m[charId];
    saveLastFire(m);
}

function removeAutonomyPlan(charId: string) {
    const plans = loadAutonomyPlans();
    if (!plans[charId]) return;
    delete plans[charId];
    saveAutonomyPlans(plans);
}

let triggerCallback: ((charId: string, room?: string, letterId?: string, manual?: boolean, sarActivity?: VRSARActivity) => void | Promise<void>) | null = null;
let visibilityListener: (() => void) | null = null;
let focusListener: (() => void) | null = null;
let mainThreadTimer: ReturnType<typeof setInterval> | null = null;
let preciseTimer: ReturnType<typeof setTimeout> | null = null;

const MAIN_THREAD_CHECK_INTERVAL = 20_000;

function checkOverdue() {
    if (!triggerCallback) return;
    const schedules = Object.values(loadSchedules());
    const now = Date.now();
    for (const s of schedules) {
        const lastFire = getLastFire(s.charId);
        if (lastFire > 0 && now - lastFire >= s.intervalMs) {
            setLastFire(s.charId, now);
            void triggerCallback(s.charId);
        }
    }
    const plans = loadAutonomyPlans();
    let plansChanged = false;
    for (const plan of Object.values(plans)) {
        if (!isVRAutonomyPlanDue(plan, now)) continue;
        plan.claimedUntil = now + AUTONOMY_CLAIM_MS;
        plan.reason = 'triggered';
        plansChanged = true;
        void triggerCallback(plan.charId);
    }
    if (plansChanged) saveAutonomyPlans(plans);
    schedulePreciseTimer();
}

function schedulePreciseTimer() {
    if (preciseTimer) {
        clearTimeout(preciseTimer);
        preciseTimer = null;
    }
    if (!triggerCallback) return;
    const schedules = Object.values(loadSchedules());
    const plans = Object.values(loadAutonomyPlans());
    if (schedules.length === 0 && plans.length === 0) return;

    const now = Date.now();
    let nextDue = Infinity;
    for (const s of schedules) {
        const lastFire = getLastFire(s.charId);
        const base = lastFire > 0 ? lastFire : now;
        const due = base + s.intervalMs;
        if (due < nextDue) nextDue = due;
    }
    for (const plan of plans) {
        const due = autonomyPlanNextAt(plan);
        if (due < nextDue) nextDue = due;
    }
    if (!Number.isFinite(nextDue)) return;

    const delay = Math.min(Math.max(nextDue - now, 500), 2_147_000_000);
    preciseTimer = setTimeout(() => {
        preciseTimer = null;
        checkOverdue();
    }, delay);
}

/** 撤掉一个角色的自主登入，连带清掉它的首火时刻和失败计数。 */
function stopSchedule(charId: string) {
    const schedules = loadSchedules();
    delete schedules[charId];
    saveSchedules(schedules);
    removeLastFire(charId);
    removeAutonomyPlan(charId);
    removeFailStreak(charId);
    if (Object.keys(schedules).length === 0 && Object.keys(loadAutonomyPlans()).length === 0) detachListeners();
    else schedulePreciseTimer();
}

function handleVisibility() {
    if (document.visibilityState !== 'visible') return;
    checkOverdue();
}

function attachListeners() {
    detachListeners();
    visibilityListener = handleVisibility;
    document.addEventListener('visibilitychange', visibilityListener);
    focusListener = checkOverdue;
    window.addEventListener('focus', focusListener);
    if (!mainThreadTimer) mainThreadTimer = setInterval(checkOverdue, MAIN_THREAD_CHECK_INTERVAL);
    schedulePreciseTimer();
}

function detachListeners() {
    if (visibilityListener) {
        document.removeEventListener('visibilitychange', visibilityListener);
        visibilityListener = null;
    }
    if (focusListener) {
        window.removeEventListener('focus', focusListener);
        focusListener = null;
    }
    if (mainThreadTimer) {
        clearInterval(mainThreadTimer);
        mainThreadTimer = null;
    }
    if (preciseTimer) {
        clearTimeout(preciseTimer);
        preciseTimer = null;
    }
}

export const VRScheduler = {
    /** 注册触发回调（应用启动时调一次）。 */
    onTrigger(callback: (charId: string, room?: string, letterId?: string, manual?: boolean, sarActivity?: VRSARActivity) => void | Promise<void>) {
        triggerCallback = callback;
        attachListeners();
        checkOverdue();
    },

    /** 启动/更新某角色的自主登入（intervalMinutes 会按 30min 对齐，最小 30）。 */
    start(charId: string, intervalMinutes: number) {
        removeAutonomyPlan(charId);
        const clamped = Math.max(30, Math.round(intervalMinutes / 30) * 30);
        const intervalMs = clamped * 60 * 1000;
        const schedules = loadSchedules();
        schedules[charId] = { charId, intervalMs };
        saveSchedules(schedules);
        setLastFire(charId, Date.now());
        // 重新启用 = 用户已经去处理过（换了 API / 充了值），旧的失败账一笔勾销，
        // 否则熔断过一次的角色刚开回来就会被上一轮的余额一脚踢停。
        removeFailStreak(charId);
        attachListeners();
        console.log(`[VRScheduler] Started: ${charId}, every ${clamped}min`);
    },

    /** 启动/恢复按人设随机安排的自主活动；计划本身落 localStorage，刷新不会重新抽签。 */
    startAutonomous(char: CharacterProfile) {
        const schedules = loadSchedules();
        if (schedules[char.id]) {
            delete schedules[char.id];
            saveSchedules(schedules);
            removeLastFire(char.id);
        }
        const plans = loadAutonomyPlans();
        const current = plans[char.id];
        const normalized = current
            ? normalizeVRAutonomyPlan(current, { char, lastActiveAt: char.vrState?.lastActiveAt })
            : createVRAutonomyPlan({ char, lastActiveAt: char.vrState?.lastActiveAt });
        plans[char.id] = { ...normalized, claimedUntil: undefined, reason: undefined };
        saveAutonomyPlans(plans);
        removeFailStreak(char.id);
        attachListeners();
        console.log(`[VRScheduler] Started: ${char.id}, autonomous plan`);
    },

    /** 停止某角色。 */
    stop(charId: string) {
        stopSchedule(charId);
        console.log(`[VRScheduler] Stopped: ${charId}`);
    },

    /**
     * 回报一轮活动的结局，用来判断要不要熔断。
     *
     * `failed` 累计到 {@link VR_FAIL_LIMIT} 就把调度掐掉并返回 `tripped: true`；
     * 中间只要成功一次，计数就归零。调用方拿到 `tripped` 后负责把角色落回未接入、
     * 并告诉用户——调度器只管自己这张表，不碰角色数据。
     */
    report(charId: string, outcome: VRSessionOutcome): { tripped: boolean; streak: number } {
        if (outcome === 'skipped') return { tripped: false, streak: loadFailStreak()[charId] || 0 };
        if (outcome === 'ok') {
            removeFailStreak(charId);
            return { tripped: false, streak: 0 };
        }
        const m = loadFailStreak();
        const streak = (m[charId] || 0) + 1;
        m[charId] = streak;
        saveFailStreak(m);
        if (streak < VR_FAIL_LIMIT) return { tripped: false, streak };
        stopSchedule(charId);
        console.warn(`[VRScheduler] 连续 ${streak} 次失败，已停掉自主登入: ${charId}`);
        return { tripped: true, streak };
    },

    /** 当前累计的连续失败次数（面板展示用）。 */
    getFailStreak(charId: string): number {
        return loadFailStreak()[charId] || 0;
    },

    /** 面板只读的自主计划状态；不把 localStorage 解析逻辑散到 React 组件里。 */
    getAutonomyStatus(charId: string): {
        active: boolean;
        nextAt?: number;
        dailyCheckpointAt?: number;
        retryNotBefore?: number;
        reason?: string;
    } {
        const plan = loadAutonomyPlans()[charId];
        if (!plan) return { active: false };
        return {
            active: true,
            nextAt: autonomyPlanNextAt(plan),
            dailyCheckpointAt: plan.dailyCheckpointAt,
            retryNotBefore: plan.retryNotBefore,
            reason: plan.reason,
        };
    },

    /** 一次自主触发结束后，按成功/阻止/失败分别安排下一次本地计划。 */
    completeAutonomous(
        charId: string,
        outcome: VRSessionOutcome,
        context: {
            char?: CharacterProfile;
            reason?: string;
            activityState?: VRAutonomyActivityState;
        } = {},
    ) {
        const plans = loadAutonomyPlans();
        const current = plans[charId];
        if (!current) return;
        const now = Date.now();
        if (outcome === 'ok' && context.char) {
            plans[charId] = createVRAutonomyPlan({
                char: context.char,
                now,
                lastActiveAt: now,
                planSequence: current.planSequence + 1,
                activityState: context.activityState || 'free',
            });
        } else {
            current.claimedUntil = undefined;
            current.reason = context.reason || (outcome === 'failed' ? 'temporary-error' : 'waiting');
            current.retryNotBefore = now + autonomousRetryDelayMinutes(context.reason) * 60_000;
            // 跨日后不要继续拿昨天的检查点反复补火。
            if (context.char) {
                const normalized = normalizeVRAutonomyPlan(current, {
                    char: context.char,
                    now,
                    lastActiveAt: context.char.vrState?.lastActiveAt,
                });
                plans[charId] = { ...normalized, retryNotBefore: current.retryNotBefore, reason: current.reason };
            }
        }
        saveAutonomyPlans(plans);
        schedulePreciseTimer();
    },

    /** 重载后恢复所有计划。 */
    resume() {
        const schedules = Object.values(loadSchedules());
        const plans = Object.values(loadAutonomyPlans());
        if (schedules.length === 0 && plans.length === 0) return;
        attachListeners();
        handleVisibility();
    },

    /**
     * 以角色 vrState 为准重建调度。
     *
     * 调度表（vr_schedules / vr_last_fire）存 localStorage，**不随备份导出/导入迁移**，
     * 而启用状态（vrState.enabled / intervalMinutes）存在角色对象里随 IndexedDB 备份走。
     * 导入到新设备 / 新浏览器档案后，角色明明是 enabled 但调度表为空，resume() 直接
     * 早退 → 角色永远不会自主登入。数据加载完成后调用本方法对账即可修复。
     *
     * - 启用但缺调度 → 补建（首火从现在起算，避免导入瞬间爆触发一堆 LLM 调用）
     * - 间隔被改过 → 跟随最新设定
     * - 已删除 / 已关闭的角色 → 清掉残留调度
     */
    reconcile(active: Array<{
        charId: string;
        intervalMinutes: number;
        autoStrategy?: 'fixed' | 'autonomous';
        character?: CharacterProfile;
    }>) {
        const schedules = loadSchedules();
        const plans = loadAutonomyPlans();
        const activeIds = new Set(active.map(a => a.charId));
        let changed = false;

        for (const a of active) {
            if (a.autoStrategy === 'autonomous' && a.character) {
                if (schedules[a.charId]) {
                    delete schedules[a.charId];
                    removeLastFire(a.charId);
                    changed = true;
                }
                const current = plans[a.charId];
                const normalized = current
                    ? normalizeVRAutonomyPlan(current, { char: a.character, lastActiveAt: a.character.vrState?.lastActiveAt })
                    : createVRAutonomyPlan({ char: a.character, lastActiveAt: a.character.vrState?.lastActiveAt });
                if (!current || JSON.stringify(current) !== JSON.stringify(normalized)) {
                    plans[a.charId] = normalized;
                    changed = true;
                }
                continue;
            }
            const clamped = Math.max(30, Math.round(a.intervalMinutes / 30) * 30);
            const intervalMs = clamped * 60 * 1000;
            const existing = schedules[a.charId];
            if (!existing) {
                schedules[a.charId] = { charId: a.charId, intervalMs };
                if (getLastFire(a.charId) === 0) setLastFire(a.charId, Date.now());
                changed = true;
            } else if (existing.intervalMs !== intervalMs) {
                existing.intervalMs = intervalMs;
                changed = true;
            }
            if (plans[a.charId]) {
                delete plans[a.charId];
                changed = true;
            }
        }

        for (const id of Object.keys(schedules)) {
            if (!activeIds.has(id)) {
                delete schedules[id];
                removeLastFire(id);
                removeFailStreak(id);
                changed = true;
            }
        }
        for (const id of Object.keys(plans)) {
            if (!activeIds.has(id)) {
                delete plans[id];
                removeFailStreak(id);
                changed = true;
            }
        }

        if (changed) saveSchedules(schedules);
        if (changed) saveAutonomyPlans(plans);
        if (Object.keys(schedules).length > 0 || Object.keys(plans).length > 0) attachListeners();
        else detachListeners();
    },

    isActiveFor(charId: string): boolean {
        return !!loadSchedules()[charId] || !!loadAutonomyPlans()[charId];
    },

    getIntervalMinutes(charId: string): number | null {
        const s = loadSchedules()[charId];
        return s ? s.intervalMs / 60000 : null;
    },

    /** 立刻触发一次（UI 上"现在去逛逛"按钮用），不影响计划。room 可指定房间，省略则随机；letterId 可指定要回复的来信。 */
    triggerNow(charId: string, room?: string, letterId?: string, sarActivity?: VRSARActivity) {
        setLastFire(charId, Date.now());
        schedulePreciseTimer();
        if (triggerCallback) {
            if (sarActivity) void triggerCallback(charId, room, letterId, true, sarActivity);
            else void triggerCallback(charId, room, letterId, true);
        }
    },
};
