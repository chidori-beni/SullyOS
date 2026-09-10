/**
 * 「彼方」活动资格：日程状态是所有登入入口共用的一道门。
 *
 * 这里故意不依赖 React、OSContext 或 scheduler：调度、手动触发、房间在场投影
 * 都可以复用同一套时区与 busyLevel 语义，而真正的安全边界仍由 runSession
 * 在每次调用前现场检查。
 */

import type { CharacterProfile, DailySchedule, ScheduleSlot } from '../../types';
import { getDailyScheduleForChar } from '../dailySchedule';
import { getScheduleWallClock } from '../scheduleTime';
import { resolveScheduleSlots } from '../scheduleInjection';
import { isScheduleFeatureOn } from '../scheduleFeature';

type ScheduleCharacter = Pick<
    CharacterProfile,
    'scheduleFeatureEnabled' | 'scheduleStyle' | 'customTimezoneEnabled' | 'customTimezone'
>;

export type VRActivityBlockReason =
    | 'schedule-busy'
    | 'schedule-sleep'
    | 'schedule-unavailable';

export interface VRActivityEligibility {
    allowed: boolean;
    reason?: VRActivityBlockReason;
    busyLevel?: Extract<ScheduleSlot['busyLevel'], 'busy' | 'sleep'>;
}

const allowed = (): VRActivityEligibility => ({ allowed: true });

const blocked = (
    reason: VRActivityBlockReason,
    busyLevel?: Extract<ScheduleSlot['busyLevel'], 'busy' | 'sleep'>,
): VRActivityEligibility => ({ allowed: false, reason, busyLevel });

/**
 * 用已经取到的日程快照判定当前时刻。
 * `at` 是绝对时间；日程解析前先折成角色自己的墙上时钟，不能直接用设备时钟。
 */
export function evaluateVRActivityEligibility(
    char: ScheduleCharacter,
    schedule: Pick<DailySchedule, 'slots'> | null | undefined,
    at: Date = new Date(),
): VRActivityEligibility {
    // 旧角色没有开启日程时保持原有彼方行为，且不触碰日程存储。
    if (!isScheduleFeatureOn(char)) return allowed();

    // 没有生成当天日程不是读取错误；没有可知的 busy/sleep 状态时保持兼容。
    if (schedule == null) return allowed();
    if (!Array.isArray(schedule.slots) || !Number.isFinite(at.getTime())) {
        return blocked('schedule-unavailable');
    }

    try {
        const wallClock = getScheduleWallClock(char, at);
        const current = resolveScheduleSlots(schedule, wallClock).current;
        if (current?.busyLevel === 'busy') return blocked('schedule-busy', 'busy');
        if (current?.busyLevel === 'sleep') return blocked('schedule-sleep', 'sleep');
        return allowed();
    } catch {
        // 日程数据损坏时宁可暂停这一轮，也不要冒险让角色在未知状态下活动。
        return blocked('schedule-unavailable');
    }
}

/** 读取当天角色本地日程并判定资格；单角色读取异常按不可活动处理。 */
export async function resolveVRActivityEligibility(
    char: ScheduleCharacter & Pick<CharacterProfile, 'id'>,
    at: Date = new Date(),
): Promise<VRActivityEligibility> {
    if (!isScheduleFeatureOn(char)) return allowed();

    try {
        const schedule = await getDailyScheduleForChar(char, at);
        const current = evaluateVRActivityEligibility(char, schedule, at);
        if (!current.allowed) return current;

        // 当天日程还没生成、或当天表在清晨没有命中当前时段时，补看前一个角色本地日，
        // 覆盖 23:00–07:00 这种跨午夜睡眠/忙碌；否则午夜后的旧表会被误当成“没有状态”。
        const wallClock = getScheduleWallClock(char, at);
        const currentSlot = schedule && Array.isArray(schedule.slots)
            ? resolveScheduleSlots(schedule, wallClock).current
            : null;
        if (wallClock.getHours() >= 12 || currentSlot) return current;

        const previousSchedule = await getDailyScheduleForChar(
            char,
            new Date(at.getTime() - 12 * 60 * 60 * 1000),
        );
        const previous = evaluateVRActivityEligibility(char, previousSchedule, at);
        return previous.allowed ? current : previous;
    } catch {
        return blocked('schedule-unavailable');
    }
}

/** 批量读取角色资格；一个角色的日程异常不能让整批房间角色查询失败。 */
export async function resolveVRActivityEligibilityMap(
    chars: Array<ScheduleCharacter & Pick<CharacterProfile, 'id'>>,
    at: Date = new Date(),
): Promise<Map<string, VRActivityEligibility>> {
    const entries = await Promise.all(chars.map(async char => [
        char.id,
        await resolveVRActivityEligibility(char, at),
    ] as const));
    return new Map(entries);
}
