import type { Anniversary, ScheduleSlot, Task } from '../types';

export const CALENDAR_DATA_UPDATED_EVENT = 'sully-calendar-data-updated';

export const taskDateKey = (task: Pick<Task, 'deadline' | 'createdAt'>): string => {
    if (typeof task.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.deadline)) {
        return task.deadline;
    }
    const date = new Date(task.createdAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export interface CalendarDateGroup<T> {
    date: string;
    items: T[];
}

export type CalendarTimelineItem =
    | {
        id: string;
        owner: 'user';
        kind: 'event';
        startTime?: string;
        endTime?: string;
        event: Anniversary;
    }
    | {
        id: string;
        owner: 'user';
        kind: 'task';
        startTime?: string;
        task: Task;
    }
    | {
        id: string;
        owner: 'character';
        kind: 'character';
        startTime?: string;
        endTime?: string;
        slot: ScheduleSlot;
    };

const timelineTimeValue = (value?: string): number => {
    if (!value) return -1;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return Number.POSITIVE_INFINITY;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return Number.POSITIVE_INFINITY;
    return hour * 60 + minute;
};

/**
 * Combine one selected day's user records and character slots into the same
 * chronological lane. The caller supplies already date-filtered events and
 * tasks; this helper only decides the display order and keeps source records
 * attached so the UI can retain their existing actions.
 */
export const mergeCalendarDayTimeline = (
    events: Anniversary[],
    tasks: Task[],
    slots: ScheduleSlot[] = [],
): CalendarTimelineItem[] => {
    const rows: Array<{
        item: CalendarTimelineItem;
        time: number;
        owner: number;
        kind: number;
        index: number;
    }> = [];

    events.forEach((event, index) => rows.push({
        item: {
            id: `user-event:${event.id}`,
            owner: 'user',
            kind: 'event',
            startTime: event.startTime,
            endTime: event.endTime,
            event,
        },
        time: timelineTimeValue(event.startTime),
        owner: 0,
        kind: 0,
        index,
    }));
    tasks.forEach((task, index) => rows.push({
        item: {
            id: `user-task:${task.id}`,
            owner: 'user',
            kind: 'task',
            startTime: task.dueTime,
            task,
        },
        time: timelineTimeValue(task.dueTime),
        owner: 0,
        kind: 1,
        index: events.length + index,
    }));
    slots.forEach((slot, index) => rows.push({
        item: {
            id: `character-slot:${index}:${slot.startTime}:${slot.activity}`,
            owner: 'character',
            kind: 'character',
            startTime: slot.startTime,
            endTime: slot.endTime,
            slot,
        },
        time: timelineTimeValue(slot.startTime),
        owner: 1,
        kind: 2,
        index: events.length + tasks.length + index,
    }));

    return rows
        .sort((left, right) => left.time - right.time || left.owner - right.owner || left.kind - right.kind || left.index - right.index)
        .map(row => row.item);
};

/**
 * Keep the personal calendar's linear view deterministic: the date is the
 * primary grouping key, while the existing task sorter decides the order
 * inside each day. Completed tasks intentionally remain in their deadline
 * group so checking one off does not make it jump to a separate archive.
 */
export const groupTasksByCalendarDate = (tasks: Task[]): CalendarDateGroup<Task>[] => {
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
        const date = taskDateKey(task);
        const items = groups.get(date) || [];
        items.push(task);
        groups.set(date, items);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, items]) => ({ date, items: sortTasksForCalendar(items) }));
};

/** Group saved personal schedule records by their recorded date. */
export const groupEventsByCalendarDate = (events: Anniversary[]): CalendarDateGroup<Anniversary>[] => {
    const groups = new Map<string, Anniversary[]>();
    for (const event of events) {
        const items = groups.get(event.date) || [];
        items.push(event);
        groups.set(event.date, items);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, items]) => ({
            date,
            items: [...items].sort((left, right) =>
                (left.startTime || '23:59').localeCompare(right.startTime || '23:59')
                || left.title.localeCompare(right.title)),
        }));
};

export const sortTasksForCalendar = (tasks: Task[]): Task[] => [...tasks].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    const dateOrder = taskDateKey(a).localeCompare(taskDateKey(b));
    if (dateOrder !== 0) return dateOrder;
    return (a.dueTime || '23:59').localeCompare(b.dueTime || '23:59');
});

export const tasksForDate = (tasks: Task[], date: string): Task[] =>
    sortTasksForCalendar(tasks.filter(task => taskDateKey(task) === date));

/** Returns whether an event's saved date represents the supplied occurrence date. */
export const eventOccursOnDate = (event: Anniversary, date: string): boolean => {
    if (event.date === date) return true;
    const repeat = event.repeat;
    if (!repeat || repeat.type !== 'weekly' || repeat.weekdays.length === 0 || date < event.date) return false;
    if (repeat.until && date > repeat.until) return false;
    const [year, month, day] = date.split('-').map(Number);
    return repeat.weekdays.includes(new Date(year, month - 1, day).getDay());
};

export const eventsForDate = (events: Anniversary[], date: string): Anniversary[] =>
    events
        .filter(event => eventOccursOnDate(event, date))
        .sort((a, b) => (a.startTime || '23:59').localeCompare(b.startTime || '23:59'));

export const pendingTasksForSupervisor = (
    tasks: Task[],
    supervisorId: string,
    today: string,
): Task[] => sortTasksForCalendar(tasks.filter(task =>
    !task.isCompleted
    && task.supervisorId === supervisorId
    && task.naturalReminder !== false
    && taskDateKey(task) <= today,
)).slice(0, 6);

export const buildUserCalendarContext = (params: {
    tasks: Task[];
    events: Anniversary[];
    supervisorId: string;
    userName: string;
    today: string;
}): string => {
    const tasks = pendingTasksForSupervisor(params.tasks, params.supervisorId, params.today);
    const events = params.events
        .filter(event => eventOccursOnDate(event, params.today))
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    if (tasks.length === 0 && events.length === 0) return '';

    const lines = [
        `### 【${params.userName}的日历 · 仅作自然背景】`,
        '这些是对方自己写下的现实安排。知道即可，不要逐条盘问、倒计时或把聊天变成监督；只有话题自然相关、临近截止或对方主动谈到时，才顺手关心一句。已明确要求你监督的待办可以提醒，但不要每轮重复。',
    ];
    if (events.length > 0) {
        lines.push('今天的安排：');
        for (const event of events) {
            const time = event.startTime
                ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}｜`
                : '';
            lines.push(`- ${time}${event.title}${event.location ? `（${event.location}）` : ''}`);
        }
    }
    if (tasks.length > 0) {
        lines.push('由你监督、尚未完成的待办：');
        for (const task of tasks) {
            lines.push(`- ${taskDateKey(task)}${task.dueTime ? ` ${task.dueTime}` : ''}｜${task.title}${task.note ? `｜${task.note}` : ''}`);
        }
    }
    return `\n${lines.join('\n')}\n`;
};

export const notifyCalendarDataUpdated = (): void => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CALENDAR_DATA_UPDATED_EVENT));
};
