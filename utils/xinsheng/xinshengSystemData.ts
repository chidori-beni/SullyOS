// 心声的「内建系统变量」：无需 AI 输出、由本地数据填充的字段。
//
// 变量名必须和糯叽机一致（currentDate / todoProgress / bondDays / messageCount …），
// 论坛美化的布局里直接写着这些名字。数据来源换成 Sully 自己的表，语义对齐即可。
//
// 优先级：AI 输出 > 系统变量。合并在 XinshengLayoutRenderer 里做（systemData 在前，data 在后）。

import { DB } from '../db';
import { taskOccursOnDate } from '../calendarIntegration';

export interface XinshengSystemData {
    currentDate: string;
    currentTime: string;
    dayOfWeek: string;
    todayTodos: string;
    todoProgress: string;
    todoCount: string;
    todoDoneCount: string;
    bondDays?: string;
    anniversary?: string;
    messageCount?: string;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const dateKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 日期/时间用**用户本地**时钟，不是角色时区 —— 这张卡是给用户看的。 */
export const buildXinshengClockData = (now = new Date()): Pick<XinshengSystemData, 'currentDate' | 'currentTime' | 'dayOfWeek'> => ({
    currentDate: dateKey(now),
    currentTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    dayOfWeek: `星期${WEEKDAYS[now.getDay()]}`,
});

/**
 * 今日待办。
 *
 * 「没有截止日的待办也算今天」是照抄糯叽机的判定 —— 用户随手记的待办多半不填日期，
 * 排除掉的话 todoCount 常年是 0，@bar todoProgress 永远空着。
 */
export const buildXinshengTodoData = async (now = new Date()): Promise<Pick<XinshengSystemData, 'todayTodos' | 'todoProgress' | 'todoCount' | 'todoDoneCount'>> => {
    try {
        const today = dateKey(now);
        const all = await DB.getAllTasks();
        const todays = (all || []).filter(t => !!t && (!t.deadline || taskOccursOnDate(t, today)));
        const done = todays.filter(t => !!t.isCompleted);
        const lines = todays.map(t => `${t.isCompleted ? '✓' : '○'} ${t.title || ''}`).join('\n');
        return {
            todayTodos: lines || '今日无待办',
            todoProgress: String(todays.length > 0 ? Math.round((done.length / todays.length) * 100) : 0),
            todoCount: String(todays.length),
            todoDoneCount: String(done.length),
        };
    } catch (e) {
        console.warn('[xinsheng] 读待办失败:', e);
        return { todayTodos: '今日无待办', todoProgress: '0', todoCount: '0', todoDoneCount: '0' };
    }
};

/**
 * 情侣天数与纪念日。
 *
 * Sully 没有「情侣空间开始日期」这个字段，取该角色**最早的一条纪念日**
 * （kind='anniversary'，不含普通日程）当作在一起的起点 —— 这是现有数据里
 * 语义最近的东西。没有纪念日就不给这两个变量，布局里对应位置留空。
 */
export const buildXinshengBondData = async (charId: string, now = new Date()): Promise<Pick<XinshengSystemData, 'bondDays' | 'anniversary'>> => {
    if (!charId) return {};
    try {
        const all = await DB.getAllAnniversaries();
        const mine = (all || [])
            .filter(a => a && a.charId === charId && (a.kind ?? 'anniversary') === 'anniversary' && !!a.date)
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const first = mine[0];
        if (!first) return {};
        const start = new Date(first.date);
        if (Number.isNaN(start.getTime())) return {};
        const days = Math.max(1, Math.ceil(Math.abs(now.getTime() - start.getTime()) / 86400000));
        return { bondDays: String(days), anniversary: first.date.split('T')[0] || '' };
    } catch (e) {
        console.warn('[xinsheng] 读纪念日失败:', e);
        return {};
    }
};

/** 组装全部系统变量。打开心声卡时调一次，不进聊天热路径。 */
export const buildXinshengSystemData = async (charId: string, now = new Date()): Promise<XinshengSystemData> => {
    const clock = buildXinshengClockData(now);
    const [todos, bond, messageCount] = await Promise.all([
        buildXinshengTodoData(now),
        buildXinshengBondData(charId, now),
        (async () => {
            if (!charId) return undefined;
            try { return String(await DB.countMessagesByCharId(charId)); } catch { return undefined; }
        })(),
    ]);
    return {
        ...clock,
        ...todos,
        ...bond,
        ...(messageCount != null ? { messageCount } : {}),
    };
};
