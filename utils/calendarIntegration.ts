import type { Anniversary, Task } from '../types';

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
