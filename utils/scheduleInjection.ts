/**
 * 日程 → prompt 文本的纯渲染层。
 *
 * 零运行时依赖（只 import type），浏览器与 Cloudflare Worker 共用同一份：
 *  - 前台聊天走 ContextBuilder.buildScheduleInjection（转发到这里）；
 *  - 主动消息到点生成走 utils/amsgFireScene.ts，由 worker 在 fire 时刻按角色时区调用。
 *
 * 放在这里而不是 utils/context.ts：那个模块拖着 DB / 记忆宫殿等一堆浏览器依赖，
 * worker 引不动。两边各写一份的话，角色在聊天里和到点生成时会说出不一样的作息。
 */

import type { DailySchedule, ScheduleSlot } from '../types';
import { getScheduleSlotInterval, isScheduleMinuteInInterval, parseScheduleClockTime } from './scheduleClock';
import { isSleepSlot, resolveScheduleSleepState } from './scheduleSleep';

/**
 * 渲染真正会读到的那部分日程。
 *
 * 单独立一个类型是给主动消息用的：fire_pack 只带这些字段上云。整份 DailySchedule 里
 * 还挂着每个时段缓存的小剧场（整段演出台词）和 coverImage（可能是 base64 看板图），
 * 那些渲染一个字都用不到，带上去就是白占几十上百 KB 的云端状态。
 */
export type RenderableSchedule = Pick<DailySchedule, 'slots' | 'flowNarrative'>;

export interface ScheduleInjectionOptions {
    /** ChatApp 主请求需要让角色看到今天的整张表；主动消息到点场景仍只看当前与下一条。 */
    includeFullDay?: boolean;
    /**
     * 教不教角色改自己的日程。前台聊天和主动消息到点生成都能落地——后者的标签由
     * worker classifier 摘成 change_schedule directive 随 push 回来，客户端落库
     * （不摘的话会被 sanitize 连 raw 一起剥掉，见 utils/scheduleChangeParse.ts）。
     * 措辞对两边都成立：主动消息里没有「完整日程表」可指，所以只让它抄上面出现过的时段。
     */
    includeChangeInstruction?: boolean;
    /**
     * 能不能报钟点（默认能）。角色关掉「时间感知」时传 false：日程照给——那是这个
     * 功能自己的开关——但 `07:00` 这种精确钟点属于时间感知的范畴，不该从日程块漏出去。
     * 跟天气块的处理对齐（那边天气照给、只抽掉 timeLine）。
     * 关掉钟点时也不教改日程：那条指令拿时段当定位符，角色看不到时刻就写不出来。
     */
    includeClock?: boolean;
    /**
     * 调用方已经用本轮时间快照算好的当前/下一条，避免同一轮再次解析出另一份状态。
     * 不传时保持原有的纯函数行为，由 `now` 现场解析。
     */
    resolvedSlots?: ResolvedScheduleSlots;
}

/** 意识流独白按一天三档取：早 / 午 / 晚。 */
export function getFlowNarrativeKey(hour: number): 'morning' | 'afternoon' | 'evening' {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}

/** 几点之前算「还在前一夜里」。凌晨 0-5 点属于昨晚的尾巴，不是今天的早晨。 */
const PRE_DAWN_END_HOUR = 5;

/** 当前时刻落在哪一条日程上，以及紧接着的下一条。都可能为 null（表还没开始 / 表是空的）。 */
export interface ResolvedScheduleSlots {
    current: ScheduleSlot | null;
    next: ScheduleSlot | null;
}

export const resolveScheduleSlots = (
    schedule: RenderableSchedule | null,
    now: Date,
): ResolvedScheduleSlots => {
    if (!schedule?.slots?.length) return { current: null, next: null };
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let next: ScheduleSlot | null = null;
    for (let i = 0; i < schedule.slots.length; i++) {
        const slot = schedule.slots[i];
        const start = parseScheduleClockTime(slot.startTime);
        if (start == null) continue;
        const nextStart = i < schedule.slots.length - 1
            ? schedule.slots[i + 1].startTime
            : undefined;
        const interval = getScheduleSlotInterval(slot, nextStart);
        if (interval && isScheduleMinuteInInterval(currentMinutes, interval)) {
            return { current: slot, next: i < schedule.slots.length - 1 ? schedule.slots[i + 1] : null };
        }
        if (!next && currentMinutes < start) next = slot;
    }
    return { current: null, next };
};

/**
 * 构建日程注入文本
 *
 * 两段式，独立叠加：
 * 1) 当前时段硬事实——每轮都注入，不受 evolvedNarrative 影响
 * 2) 意识流独白——evolvedNarrative > flowNarrative > 当前 slot innerThought
 */
export const buildScheduleInjection = (
    schedule: RenderableSchedule | null,
    evolvedNarrative?: string,
    now: Date = new Date(),
    options: ScheduleInjectionOptions = {},
): string => {
    if (!schedule || !schedule.slots || schedule.slots.length === 0) return '';
    const { current: currentSlot, next: nextSlot } = options.resolvedSlots
        ?? resolveScheduleSlots(schedule, now);
    const withClock = options.includeClock !== false;
    /** 报钟点时写「活动（07:00）」，不报时只留活动本身。 */
    const withTime = (text: string, startTime: string) => (withClock ? `${text}（${startTime}）` : text);

    // 凌晨还没轮到今天第一条日程时，人其实还在昨晚里没睡。主动消息经常在这个点触发，
    // 按「今天刚要开始」写，半夜一点的角色就会顶着清晨的心境说话。
    const isPreDawnCarryOver = now.getHours() < PRE_DAWN_END_HOUR
        && (!currentSlot || currentSlot.busyLevel === 'sleep');

    // 1. 当前时段硬事实（每轮独立注入）
    let slotHeader = '';
    if (currentSlot) {
        const currentIndex = schedule.slots.indexOf(currentSlot);
        const nextStart = currentIndex >= 0 && currentIndex < schedule.slots.length - 1
            ? schedule.slots[currentIndex + 1].startTime
            : undefined;
        const interval = getScheduleSlotInterval(currentSlot, nextStart);
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        let progress = '';
        if (interval && isScheduleMinuteInInterval(currentMinutes, interval)) {
            const elapsed = interval.end > 24 * 60 && currentMinutes < interval.end - 24 * 60
                ? currentMinutes + 24 * 60 - interval.start
                : currentMinutes - interval.start;
            const remaining = Math.max(0, interval.end - interval.start - elapsed);
            if (withClock) {
                progress = currentSlot.busyLevel === 'sleep'
                    ? `（正在睡眠，已持续约${elapsed}分钟）`
                    : `（进行中，已开始约${elapsed}分钟，预计还需约${remaining}分钟；尚未完成整段活动）`;
            } else {
                progress = currentSlot.busyLevel === 'sleep'
                    ? '（正在睡眠）'
                    : '（进行中，尚未完成整段活动）';
            }
        }
        const activityLabel = currentSlot.location
            ? `${currentSlot.activity}（${currentSlot.location}）`
            : currentSlot.activity;
        slotHeader = withClock
            ? `当前时段：${currentSlot.startTime} 你正在${activityLabel}${progress}`
            : `当前时段：你正在${activityLabel}${progress}`;
        if (nextSlot) {
            slotHeader += withClock
                ? `\n之后安排：${nextSlot.startTime} ${nextSlot.activity}`
                : `\n之后安排：${nextSlot.activity}`;
        }
        slotHeader += '\n';
    } else if (nextSlot) {
        slotHeader = isPreDawnCarryOver
            ? `夜深了，今天的安排还没开始，最早的一件是${withTime(nextSlot.activity, nextSlot.startTime)}\n`
            : `今天还没开始活动，稍后先${withTime(nextSlot.activity, nextSlot.startTime)}\n`;
    }

    // 2. 意识流独白
    let narrative = '';
    if (evolvedNarrative) {
        narrative = evolvedNarrative;
    } else if (schedule.flowNarrative && Object.keys(schedule.flowNarrative).length > 0) {
        // 前一夜的延续取「晚」档；其余照一天三档走。
        const key = isPreDawnCarryOver ? 'evening' : getFlowNarrativeKey(now.getHours());
        narrative = schedule.flowNarrative[key]
            || schedule.flowNarrative['evening']
            || schedule.flowNarrative['afternoon']
            || schedule.flowNarrative['morning']
            || '';
    } else if (currentSlot?.innerThought) {
        narrative = currentSlot.innerThought;
    }

    // 3. 拼接：硬事实 → 意识流（可选）
    const preamble = `此刻你的心中盘旋着这些想法……\n`;
    const footnote = `\n（不是台词，不用说出口——让它影响你的语气和情绪就好。）`;

    let out = '';
    if (options.includeFullDay) {
        const rows = schedule.slots.map((slot) => {
            let line = withClock
                ? `- ${slot.startTime}${slot.endTime ? `-${slot.endTime}` : ''} ${slot.activity}`
                : `- ${slot.activity}`;
            if (slot.location) line += `（${slot.location}）`;
            if (slot.description) line += `：${slot.description}`;
            if (slot.busyLevel) line += ` [忙碌程度=${slot.busyLevel}]`;
            return line;
        });
        out += `你今天的完整日程：\n${rows.join('\n')}\n`;
    }
    out += slotHeader;
    const asleep = isSleepSlot(currentSlot);
    if (asleep) {
        // 睡着时最容易穿帮的不是「说错在做什么」，而是**凭空醒来**：主动消息到点触发，
        // 角色顺着下面「日程可以改」那句话把补觉改成醒着，睡两个小时就爬起来发消息。
        // 所以睡眠时段单独给一句硬事实：醒要有醒的理由，而且要说得出是被什么弄醒的。
        const sleepState = resolveScheduleSleepState(schedule.slots, now);
        out += '你现在确实睡着了。除非有把人弄醒的具体原因（对方刚发来消息或来电、闹钟、噩梦、'
            + '身体不适、外面的动静等），不要凭空写成自己已经醒了，也不要把这一觉说成已经睡饱。\n';
        if (withClock && sleepState) {
            out += `这一觉到现在只睡了约 ${Math.round(sleepState.sleptMinutes)} 分钟，`
                + `按计划还要睡约 ${Math.round(sleepState.remainingMinutes)} 分钟；`
                + '成年人补觉一次通常要几个小时，睡一两个小时就自己爬起来不是正常作息。\n';
        }
        out += '真被吵醒了就照实写清是被什么吵醒的，带着刚醒的迷糊和困意说话，'
            + '并且多半很快又睡回去。\n';
    }
    if (currentSlot) {
        out += '本轮现实状态以当前时段为准：历史聊天里的活动只代表当时；如果历史叙事与当前时段冲突，'
            + '不要把旧活动继续说成正在发生或刚刚结束。实际安排发生变化时，先按真实情况改日程再继续承接。\n';
        out += '当前时段的描述是计划与目标，不是已经完成的结果；活动处于“进行中”时，除非聊天中有明确事实证明提前结束，'
            + '不要声称整段活动已经做完，也不要把刚开始几分钟写成完成了长距离训练。\n';
    }
    if (narrative) {
        out += preamble + narrative + footnote;
    }
    // 能改的是「当前这一条和它之后的」，所以两者有一个在就有落点。落点优先取下一条；
    // 一天最后一条日程开始之后没有下一条了，这时用当前这条——那条通常是睡觉，正好是
    // 最需要「我今晚不睡了」这个出口的时候。
    const changeTarget = nextSlot ?? currentSlot;
    if (options.includeChangeInstruction && withClock && changeTarget) {
        // 例句要跟当前状态错开：正睡着的时候拿「表上写着睡觉、你却醒着」当例子，
        // 等于直接教角色把这一觉改掉——那正是要防的事。
        const changeExample = asleep
            ? '（比如临时被叫去处理别的事、计划里的活动取消了）'
            : '（比如这会儿表上写着睡觉、你却醒着在跟对方说话）';
        out += '\n日程是你早上给自己排的计划，不是必须履行的命令。真实发生的事跟它对不上时'
            + `${changeExample}，把它改成你实际在做的事就好。\n`
            + '需要时在回复末尾单独输出：'
            + `[[ACTION:CHANGE_SCHEDULE | ${changeTarget.startTime} | 去超市]]`
            + '（时段要原样抄上面出现过的那几个；正在进行的这一条和它之后的都能改，已经过去的不能）。';
    }
    out += '\n';
    return out;
};
