import { CharacterProfile, DailySchedule, Message, ScheduleSlot } from '../types';
import { DB } from './db';
import { resolveCharTimeZone, wallClockToTimestamp } from './timezone';

/** 与糯叽机保持同语义：开关关闭时日程仍生成，但不往聊天发送邀约。 */
export const SCHEDULE_INVITE_ENABLED_KEY = 'calendar_schedule_invite_enabled';

export type ScheduleInviteKind = 'voice' | 'video' | 'watch' | 'other';

export interface ScheduleInviteEvent {
    id: string;
    date: string;
    startTime: string;
    endTime?: string;
    activity: string;
    description?: string;
    emoji?: string;
    location?: string;
    kind: ScheduleInviteKind;
    slotIndex: number;
}

export interface ScheduleInviteData {
    kind: 'schedule_invite';
    batchId: string;
    charId: string;
    charName: string;
    date: string;
    status: 'pending' | 'responded';
    acceptedIds: string[];
    declinedIds?: string[];
    events: ScheduleInviteEvent[];
    responseAt?: number;
}

export interface ScheduleInviteReplyData {
    kind: 'schedule_invite_reply';
    charName: string;
    items: Array<Pick<ScheduleInviteEvent, 'id' | 'activity' | 'emoji' | 'date' | 'startTime' | 'endTime'>>;
}

export const isScheduleInviteEnabled = (): boolean => {
    try {
        return localStorage.getItem(SCHEDULE_INVITE_ENABLED_KEY) !== 'false';
    } catch {
        return true;
    }
};

export const setScheduleInviteEnabled = (enabled: boolean): void => {
    try {
        localStorage.setItem(SCHEDULE_INVITE_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch { /* storage unavailable: the in-memory UI still works for this render */ }
};

const normalizeKind = (slot: ScheduleSlot): ScheduleInviteKind => {
    if (slot.inviteKind) return slot.inviteKind;
    const text = `${slot.activity} ${slot.description || ''}`.toLowerCase();
    if (/视频|视讯|video/.test(text)) return 'video';
    if (/语音|通话|连麦|voice/.test(text)) return 'voice';
    if (/追剧|看电影|看番|watch/.test(text)) return 'watch';
    return 'other';
};

const safeActivityKey = (activity: string): string =>
    activity.trim().replace(/\s+/g, '').slice(0, 24) || 'event';

/**
 * 为共同活动补稳定 id。id 不依赖 generatedAt，这样重新打开同一天的日程时，
 * 邀约响应仍能准确落回对应时段。
 */
export const normalizeScheduleInviteIds = (schedule: DailySchedule): DailySchedule => {
    let changed = false;
    const slots = schedule.slots.map((slot) => {
        if (!slot.withUser || slot.inviteStatus === 'declined' || slot.inviteStatus === 'accepted') return slot;
        const inviteId = slot.inviteId || `sinv_${schedule.charId}_${schedule.date}_${slot.startTime.replace(':', '')}_${safeActivityKey(slot.activity)}`;
        if (slot.inviteId === inviteId) return slot;
        changed = true;
        return { ...slot, inviteId };
    });
    return changed ? { ...schedule, slots } : schedule;
};

const parseClockMinutes = (value?: string): number | null => {
    const match = typeof value === 'string' && value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
};

const isRemoteFriendly = (slot: ScheduleSlot): boolean => {
    const text = `${slot.activity} ${slot.description || ''} ${slot.location || ''}`;
    // 保护层：即使模型把线下见面错误地打上 withUser，也不要把它伪装成异地邀约。
    if (/见面|见你|吃饭|餐厅|逛街|散步|一起做饭|约会地点/.test(text)
        && !/线上|远程|视频|视讯|语音|连麦|在线|virtual|remote/i.test(text)) return false;
    return true;
};

/** 取当天还没有处理结果、且活动时间尚未过去的用户共同活动。 */
export const getScheduleInviteEvents = (
    schedule: DailySchedule,
    char?: Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone'>,
    nowMs: number = Date.now(),
): ScheduleInviteEvent[] => {
    const mapped: Array<ScheduleInviteEvent | null> = schedule.slots.map((slot, slotIndex) => {
        if (!slot.withUser || slot.inviteStatus === 'declined' || slot.inviteStatus === 'accepted' || !isRemoteFriendly(slot)) return null;
        const startMinutes = parseClockMinutes(slot.startTime);
        if (startMinutes == null) return null;
        const startMs = wallClockToTimestamp(`${schedule.date} ${slot.startTime}:00`, resolveCharTimeZone(char));
        if (Number.isFinite(startMs) && startMs < nowMs - 5 * 60_000) return null;
        return {
            id: slot.inviteId || `sinv_${schedule.charId}_${schedule.date}_${slot.startTime.replace(':', '')}_${safeActivityKey(slot.activity)}`,
            date: schedule.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            activity: slot.activity,
            description: slot.description,
            emoji: slot.emoji,
            location: slot.location,
            kind: normalizeKind(slot),
            slotIndex,
        };
    });
    return mapped.filter((event): event is ScheduleInviteEvent => event !== null);
};

export const getScheduleInviteBatchId = (charId: string, date: string): string => `sinv_${charId}_${date}`;

export const getScheduleInviteData = (message: Message | null | undefined): ScheduleInviteData | null => {
    const data = message?.metadata?.scheduleInviteData;
    if (!data || data.kind !== 'schedule_invite' || !Array.isArray(data.events)) return null;
    return data as ScheduleInviteData;
};

/**
 * 当日程首次生成、或旧日程升级到支持邀约的版本时，最多写入一张聊天卡。
 * 通过 metadata.source 的索引查重，不扫描整段聊天，也不依赖记忆宫殿水位线。
 */
export async function ensureScheduleInviteMessage(params: {
    char: Pick<CharacterProfile, 'id' | 'name' | 'customTimezoneEnabled' | 'customTimezone'>;
    schedule: DailySchedule;
}): Promise<{ schedule: DailySchedule; created: boolean; messageId?: number }> {
    const { char } = params;
    if (!isScheduleInviteEnabled()) return { schedule: params.schedule, created: false };

    const normalized = normalizeScheduleInviteIds(params.schedule);
    if (normalized !== params.schedule) await DB.saveDailySchedule(normalized);
    const events = getScheduleInviteEvents(normalized, char);
    if (events.length === 0) return { schedule: normalized, created: false };

    const batchId = getScheduleInviteBatchId(char.id, normalized.date);
    const previous = await DB.getRecentMessagesByCharIdAndSource(char.id, 'schedule_invite', 30).catch(() => [] as Message[]);
    const alreadySent = previous.some((message) => getScheduleInviteData(message)?.batchId === batchId);
    if (alreadySent) return { schedule: normalized, created: false };

    const data: ScheduleInviteData = {
        kind: 'schedule_invite',
        batchId,
        charId: char.id,
        charName: char.name,
        date: normalized.date,
        status: 'pending',
        acceptedIds: [],
        events,
    };
    const messageId = await DB.saveMessage({
        charId: char.id,
        role: 'assistant',
        type: 'schedule_invite',
        content: '[行程邀约]',
        metadata: { source: 'schedule_invite', scheduleInviteData: data },
    });
    return { schedule: normalized, created: true, messageId };
}

export const buildScheduleInviteReplyData = (
    charName: string,
    events: ScheduleInviteEvent[],
): ScheduleInviteReplyData => ({
    kind: 'schedule_invite_reply',
    charName,
    items: events.map(({ id, activity, emoji, date, startTime, endTime }) => ({
        id, activity, emoji, date, startTime, endTime,
    })),
});

/** 用邀约事件回写日程；优先按稳定 id，兼容 force reroll 后旧消息的时间变化。 */
export const applyScheduleInviteToSchedule = (
    schedule: DailySchedule,
    events: ScheduleInviteEvent[],
    acceptedIds: string[],
): DailySchedule => {
    const accepted = new Set(acceptedIds);
    const used = new Set<number>();
    const slots = schedule.slots.map((slot, index) => {
        const matched = events.find((event) => {
            if (used.has(event.slotIndex)) return false;
            if (slot.inviteId && event.id === slot.inviteId) return true;
            if (event.slotIndex === index) return true;
            return event.startTime === slot.startTime && event.activity === slot.activity;
        });
        if (!matched) return slot;
        used.add(index);
        return {
            ...slot,
            inviteId: matched.id,
            inviteStatus: (accepted.has(matched.id) ? 'accepted' : 'declined') as ScheduleSlot['inviteStatus'],
        } as ScheduleSlot;
    });
    return { ...schedule, slots };
};
