import type { CharacterProfile, DailySchedule, Message, ScheduleSlot } from '../types';
import { resolveScheduleSlots } from './scheduleInjection';
import { createScheduleContextSnapshot, type ScheduleContextSnapshot } from './scheduleContext';

export type ScheduleBusyLevel = 'free' | 'light' | 'busy' | 'sleep';

export type BusyReplyDecision =
    | { mode: 'off' | 'free'; level: 'free'; slot: ScheduleSlot | null }
    | { mode: 'multitask'; level: 'light'; slot: ScheduleSlot }
    | { mode: 'brief-reply'; level: 'busy' | 'sleep'; slot: ScheduleSlot; chance: number }
    | { mode: 'auto-reply'; level: 'busy' | 'sleep'; slot: ScheduleSlot; chance: number; text: string };

export interface PendingUserMessageState {
    /** 上一条真正角色内容之后，用户连续发来的、还没有被正常内容覆盖的消息数。 */
    count: number;
    /** 这段积压内容中间是否有过忙碌自动回复；自动回复只是占位通知，不算回答。 */
    afterBusyAutoReply: boolean;
}

const isRealPendingUserMessage = (message: Message): boolean =>
    message.role === 'user' && !message.metadata?.proactiveHint;

const isBusyAutoReplyMessage = (message: Message): boolean =>
    message.role === 'assistant' && !!message.metadata?.busyAutoReply;

/**
 * 找出最后一条真正角色内容之后的用户积压消息。
 *
 * 忙碌自动回复不是回答边界：它只告诉用户「稍后回」，所以它后面新来的消息要和
 * 自动回复前的消息一起交给下一轮自然主动处理。自然主动产生的隐藏 hint 用户消息
 * 也不算用户真正发言，避免把内部提示当成积压内容。
 */
export const getPendingUserMessageState = (
    messages: readonly Message[],
): PendingUserMessageState => {
    let count = 0;
    let afterBusyAutoReply = false;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (!message || message.role === 'system') continue;
        if (message.role === 'user') {
            if (isRealPendingUserMessage(message)) count += 1;
            continue;
        }
        if (isBusyAutoReplyMessage(message)) {
            afterBusyAutoReply = true;
            continue;
        }
        // 普通角色消息是真正的回答，积压窗口到此为止。
        break;
    }

    return {
        count,
        afterBusyAutoReply: afterBusyAutoReply && count > 0,
    };
};

const URGENT_RE = /(在吗|在嗎|急|紧急|緊急|快|sos|救命|出事|危险|危險|醒醒|起床|wake up|emergency|urgent|help|hello\?|hey\?\?+|！！+|!!+|？？+|\?\?+)/i;
const CALL_RE = /(打电话|打電話|来电|來電|通话|通話|连麦|連麥|call me|phone me|video call)/i;

export const normalizeBusyLevel = (slot: ScheduleSlot | null | undefined): ScheduleBusyLevel => {
    const level = slot?.busyLevel;
    return level === 'light' || level === 'busy' || level === 'sleep' ? level : 'free';
};

const lastConversationMessage = (messages: readonly Message[]): Message | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== 'system') return message;
    }
    return null;
};

export interface BusyReplySignals {
    unreadUserMsgCount: number;
    lastUserText: string;
    isCallRequest: boolean;
}

export const collectBusyReplySignals = (messages: readonly Message[]): BusyReplySignals => {
    let unreadUserMsgCount = 0;
    let lastUserText = '';
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message || message.role === 'system') continue;
        if (message.role !== 'user') break;
        unreadUserMsgCount += 1;
        if (!lastUserText) lastUserText = String(message.content || '');
    }
    return {
        unreadUserMsgCount,
        lastUserText,
        isCallRequest: CALL_RE.test(lastUserText),
    };
};

/**
 * 糯叽机 4.5 的“忙里偷看 / 被叫醒”概率：忙碌基础 12%，睡眠基础 2%；
 * 连续消息、紧急语气和来电请求会提高概率，但忙碌最多 85%，睡眠最多 60%。
 */
export const busyReplyChance = (
    level: 'busy' | 'sleep',
    signals: BusyReplySignals,
): number => {
    let chance = level === 'sleep' ? 2 : 12;
    if (level === 'sleep') {
        chance += 7 * Math.max(0, Math.min(signals.unreadUserMsgCount - 1, 4));
    } else {
        chance += 9 * Math.min(signals.unreadUserMsgCount, 5);
    }
    if (URGENT_RE.test(signals.lastUserText)) chance += level === 'sleep' ? 15 : 20;
    if (signals.isCallRequest) chance += level === 'sleep' ? 30 : 40;
    return Math.min(chance, level === 'sleep' ? 60 : 85);
};

/** 同一分钟内保持稳定，避免用户反复点生成时概率结果来回跳。 */
export const stableChanceRoll = (
    now: Date,
    charId: string,
    signals: BusyReplySignals,
): number => {
    const seed = `${Math.floor(now.getTime() / 60_000)}_${charId}_${signals.unreadUserMsgCount}_${signals.isCallRequest ? 1 : 0}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    return Math.abs(hash) % 100;
};

const cleanActivity = (activity: string): string =>
    String(activity || '')
        .replace(/[，。！？,.!?]+$/g, '')
        .replace(/^(正在|去|进行|進行)\s*/u, '')
        .trim();

export const buildAutoReplyText = (
    char: Pick<CharacterProfile, 'busyAutoReplyUseScheduleText' | 'busyAutoReplyBusyText' | 'busyAutoReplySleepText'>,
    level: 'busy' | 'sleep',
    slot: ScheduleSlot,
): string => {
    const custom = level === 'sleep' ? char.busyAutoReplySleepText : char.busyAutoReplyBusyText;
    if (char.busyAutoReplyUseScheduleText !== true) {
        if (custom?.trim()) return custom.trim();
        return level === 'sleep'
            ? '[自动回复]睡了，醒来再回'
            : '[自动回复]现在在忙稍后回复';
    }
    if (level === 'sleep') return '[自动回复]睡了，醒来再回';
    const activity = cleanActivity(slot.activity);
    return activity
        ? `[自动回复] ${activity}中，稍后回复`
        : '[自动回复]现在在忙稍后回复';
};

export const decideBusyReply = (params: {
    char: CharacterProfile;
    schedule?: DailySchedule | null;
    messages: readonly Message[];
    now?: Date;
    /** 同一轮已经解析好的角色时间/日程；传入后不再二次取时间或解析日程。 */
    scheduleContext?: ScheduleContextSnapshot;
    roll?: number;
}): BusyReplyDecision => {
    const { char, messages } = params;
    const scheduleContext = params.scheduleContext
        || (params.schedule
            ? createScheduleContextSnapshot(char, params.schedule, params.now ?? new Date())
            : undefined);
    const schedule = scheduleContext?.schedule ?? params.schedule ?? null;
    if (char.busyAutoReplyEnabled !== true || !schedule) {
        return { mode: 'off', level: 'free', slot: null };
    }
    const current = scheduleContext?.current
        ?? resolveScheduleSlots(schedule, params.now ?? new Date()).current;
    const level = normalizeBusyLevel(current);
    if (!current || level === 'free') return { mode: 'free', level: 'free', slot: current };
    if (level === 'light') return { mode: 'multitask', level, slot: current };

    // 没有一条等待回复的用户消息时，不凭空冒自动回复。
    if (lastConversationMessage(messages)?.role !== 'user') {
        return { mode: 'free', level: 'free', slot: current };
    }

    const signals = collectBusyReplySignals(messages);
    const chance = busyReplyChance(level, signals);
    const roll = params.roll ?? stableChanceRoll(
        scheduleContext?.instant ?? params.now ?? new Date(),
        char.id,
        signals,
    );
    if (roll < chance) return { mode: 'brief-reply', level, slot: current, chance };
    return {
        mode: 'auto-reply',
        level,
        slot: current,
        chance,
        text: buildAutoReplyText(char, level, current),
    };
};

export const buildBusyReplyPrompt = (decision: BusyReplyDecision): string => {
    if (decision.mode === 'multitask') {
        return `\n[忙碌程度：可分心回复]\n本轮当前日程事实是：你正在“${decision.slot.activity}”。此前聊天里提到的起床、冲凉、健身或其他活动只代表当时；如果和这条当前日程冲突，不要把旧活动继续说成正在发生或刚刚结束。你能看到手机并正常回应，但注意力并不完全在聊天上：继续回应对方刚才的话，不要另开需要长时间投入的新话题；可以自然带出身边的一点动静，但不要刻意缩短本来需要认真回应的内容。\n`;
    }
    if (decision.mode === 'brief-reply') {
        const sleeping = decision.level === 'sleep';
        return sleeping
            ? `\n[被消息叫醒]\n本轮当前日程事实是：你正在“${decision.slot.activity}”（睡眠）。历史里出现的“起床了、冲完凉了、刚健身完”等话只代表当时，不能覆盖当前时段；除非你在本轮明确改了日程，否则不要声称自己刚从与当前日程冲突的活动回来。你本来正在休息，但这次还是迷迷糊糊看了手机。只回几个字到一句话，带着半梦半醒的断续感；只回应眼前这句话，不展开新话题，之后仍会继续休息。\n`
            : `\n[忙里偷看一眼]\n本轮当前日程事实是：你正在“${decision.slot.activity}”。历史中的活动只代表当时，不能覆盖当前时段；不要把已经结束的健身、冲凉或其他旧活动说成此刻仍在进行，也不要凭空声称刚从与当前日程冲突的活动回来。你本来没法看手机，但这次抽空扫了一眼。只发一条很短的回复（不超过一两句），像还得立刻回去继续手头的事；回应对方最要紧的内容，不展开新话题。\n`;
    }
    return '';
};

export const buildAutoReplyCatchUpPrompt = (messages: readonly Message[]): string => {
    // 新一轮生成时队尾已经是用户刚发的消息；要检查的是这些连续用户消息之前，
    // 角色上一次真正发出的内容是不是自动回复。
    let previousAssistant: Message | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message || message.role === 'system' || message.role === 'user') continue;
        if (message.role === 'assistant') previousAssistant = message;
        break;
    }
    if (!previousAssistant?.metadata?.busyAutoReply) return '';
    return `\n[自动回复后的补回]\n你上一条发出的是系统自动回复，并没有真正回答对方。现在已经能看手机了：自然接回自动回复之前对方最后说的那件事，真正回应其问题、情绪或邀请；可以按人设轻描淡写地带一句刚忙完，但不要把责任倒过来说成对方刚出现，也不要只顾着解释迟到。\n`;
};
