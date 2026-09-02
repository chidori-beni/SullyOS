/**
 * 主动消息「对方此刻的安排」的到点渲染（AMSG_SLOT_USER_CALENDAR）。
 *
 * 为什么要有这一层：前台聊天每轮都会现读 IndexedDB，把共享日历注入 system prompt
 * （见 chatPrompts 的 userCalendarPromise）。主动消息不走那条路——fire_pack 是最后
 * 一次聊天时打好的模板，worker 到点渲染时够不着手机的 IndexedDB，所以那一段被
 * `forFirePack` 整块跳过了。结果就是：角色在聊天里知道对方 12:00-14:00 在语言学校，
 * 到点主动发消息时却让人「赶紧回公寓瘫着」。
 *
 * 解法跟角色自己的日程（amsgFireScene）一模一样：随包带**原始事件表**而不是渲染好的
 * 文字，worker 到点按用户时区现算当前时段。渲染直接复用前台那一份
 * buildUserCalendarContext —— 各写一份的话，角色在聊天里和到点生成时会读到两套措辞。
 *
 * 只带日程（Anniversary），**不带待办**：待办是会被勾掉的状态，拿几小时前的快照到点
 * 催「你今天那件事做了吗」正是原先跳过整段的理由。日程是计划，用户改动频率低得多，
 * 而且每次聊天都会重打一次包。
 *
 * 零浏览器依赖：只 import type 和两个纯叶子（calendarIntegration / localDate），
 * 与 amsgFireScene 同一条线，esbuild 打进 worker bundle 没有副作用。
 */

import type { Anniversary } from '../types';
import { buildUserCalendarContext, eventOccursOnDate } from './calendarIntegration';
import { addLocalDays, getLocalDateKey } from './localDate';
import { nowInTimeZone } from './timezone';

/** 随包带几天的窗口。今天 + 未来 7 天，正好盖住 buildUserCalendarContext 的「未来 7 天内最近一项」。 */
export const AMSG_USER_CALENDAR_LOOKAHEAD_DAYS = 7;

/**
 * 事件条数上限。前台渲染自己还会按 MAX_USER_CALENDAR_EVENTS 收敛，这里管的是**上云体积**：
 * fire_pack 本来就有几万字，一份排满每周重复的日历能轻松堆出上百行。
 */
export const AMSG_USER_CALENDAR_MAX_EVENTS = 40;

/**
 * 上云的事件行。只留渲染真的会读的字段：
 *  - date / repeat  → eventOccursOnDate 判这天有没有这一条；
 *  - startTime / endTime → classifyUserCalendarEvent 分「正在进行 / 接下来 / 已结束」；
 *  - title / location → calendarEventLine 写出来的那一行。
 *
 * note 一概不带：事件行根本不渲染它（只有待办行会），带上去纯属把用户的私人备注
 * 白送上云。charId / kind 同理，渲染这一路一个都不看。
 */
export type AmsgUserCalendarEvent = Pick<
    Anniversary,
    'id' | 'title' | 'date' | 'startTime' | 'endTime' | 'location' | 'repeat'
>;

/** 随 fire_pack 带给 worker 的原始素材。到点渲染成 AMSG_SLOT_USER_CALENDAR 那一段。 */
export interface AmsgUserCalendar {
    /** 用户设备的 IANA 时区 id。日历里的 "12:00" 说的是用户那边的十二点，不是角色那边的。 */
    userTzId: string;
    /** 用户称呼，只用来写区块标题（同前台的 userName）。 */
    userName: string;
    /** 打包时用户当地的日期；渲染时只用来判断这份窗口还盖不盖得住今天。 */
    packedDateKey: string;
    /** 打包时刻起 today..+AMSG_USER_CALENDAR_LOOKAHEAD_DAYS 内会发生的事件。 */
    events: AmsgUserCalendarEvent[];
}

/** 把一条 Anniversary 削成上云的最小形状。 */
const compactEvent = (event: Anniversary): AmsgUserCalendarEvent => ({
    id: event.id,
    title: event.title,
    date: event.date,
    ...(event.startTime ? { startTime: event.startTime } : {}),
    ...(event.endTime ? { endTime: event.endTime } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.repeat ? { repeat: event.repeat } : {}),
});

/**
 * 打包用户日历。窗口内一条都没有时返回 null —— 槽位被抹平，模板跟没这回事一样。
 *
 * `todayKey` 是用户当地的今天；调用方从设备本地时间取（fire_pack 的 userTzId 就是这台设备）。
 */
export const buildAmsgUserCalendar = (params: {
    events: Anniversary[];
    userTzId: string;
    userName: string;
    todayKey: string;
}): AmsgUserCalendar | null => {
    const dates: string[] = [];
    for (let offset = 0; offset <= AMSG_USER_CALENDAR_LOOKAHEAD_DAYS; offset += 1) {
        const key = addLocalDays(params.todayKey, offset);
        if (!key) break;
        dates.push(key);
    }
    if (dates.length === 0) return null;

    const kept: AmsgUserCalendarEvent[] = [];
    for (const event of params.events) {
        if (kept.length >= AMSG_USER_CALENDAR_MAX_EVENTS) break;
        // 每周重复的条目一条顶多份，所以按「窗口内任意一天命中」收，而不是展开成多行。
        if (dates.some(date => eventOccursOnDate(event, date))) kept.push(compactEvent(event));
    }
    if (kept.length === 0) return null;

    return {
        userTzId: params.userTzId,
        userName: params.userName,
        packedDateKey: params.todayKey,
        events: kept,
    };
};

/**
 * 时区 id 认不认得。必须自己判一次：nowInTimeZone 认不出来时**静默退回传入的时刻**，
 * 而 worker 那边传的是 UTC —— 于是一份东京的日程会被照着 UTC 读，凭空错开九小时，
 * 而且一点报错都没有。宁可整段消失（同「实时世界拉不到就不写」那条线）。
 */
const isUsableTimeZone = (tzId: string | undefined): tzId is string => {
    if (!tzId) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tzId });
        return true;
    } catch {
        return false;
    }
};

/**
 * 渲染 fire 时刻「对方此刻的安排」。
 *
 * 不做跨天作废（跟 renderFireSceneBlock 那道日期门槛不同）：那边随包带的是「某一天的
 * 作息表」，条目本身没有日期，隔天照念就是在说昨天的事；这边每条事件自带日期和每周
 * 重复规则，第二天触发时 eventOccursOnDate 自己会算对。窗口走完（packedDateKey 之后
 * 超过 LOOKAHEAD 天还没有新包）时事件都过期了，buildUserCalendarContext 自然返回空串。
 */
export const renderUserCalendarBlock = (
    calendar: AmsgUserCalendar | null | undefined,
    nowMs: number,
): string => {
    if (!calendar?.events?.length || !isUsableTimeZone(calendar.userTzId)) return '';
    const wallNow = nowInTimeZone(calendar.userTzId, new Date(nowMs));
    if (!Number.isFinite(wallNow.getTime())) return '';

    // 待办和角色房间待办都不带（见文件头）：这里只有日程这一种事实。
    const text = buildUserCalendarContext({
        tasks: [],
        events: calendar.events as Anniversary[],
        supervisorId: '',
        userName: calendar.userName,
        today: getLocalDateKey(wallNow),
        now: wallNow,
        characterTodo: null,
    }).trim();
    if (!text) return '';

    // 前导空行：槽位紧跟在上一行后面填，自带空行才不会跟「此刻在做什么」粘成一段。
    return `\n\n${text}\n（这份日历是你们上次聊天时的快照，之后 ${calendar.userName} 可能又改过；`
        + '把它当成判断对方此刻方不方便的背景，别当成必须提醒的清单，也别照着复述。）';
};
