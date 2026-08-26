import { describe, expect, it } from 'vitest';
import type { Anniversary, Task } from '../types';
import {
    buildUserCalendarContext,
    eventsForDate,
    pendingTasksForSupervisor,
    taskDateKey,
    tasksForDate,
} from './calendarIntegration';

const task = (overrides: Partial<Task> = {}): Task => ({
    id: 't1',
    title: '交报告',
    supervisorId: 'char-a',
    tone: 'gentle',
    deadline: '2026-08-27',
    isCompleted: false,
    createdAt: new Date(2026, 7, 20).getTime(),
    ...overrides,
});

describe('calendarIntegration', () => {
    it('keeps old tasks usable by falling back to their local creation date', () => {
        expect(taskDateKey(task({ deadline: undefined }))).toBe('2026-08-20');
    });

    it('groups and sorts tasks on the selected day', () => {
        const rows = tasksForDate([
            task({ id: 'late', dueTime: '18:00' }),
            task({ id: 'done', dueTime: '08:00', isCompleted: true }),
            task({ id: 'early', dueTime: '09:00' }),
        ], '2026-08-27');
        expect(rows.map(row => row.id)).toEqual(['early', 'late', 'done']);
    });

    it('only exposes overdue or today pending tasks to their selected supervisor', () => {
        const rows = pendingTasksForSupervisor([
            task({ id: 'overdue', deadline: '2026-08-26' }),
            task({ id: 'future', deadline: '2026-08-28' }),
            task({ id: 'other', supervisorId: 'char-b' }),
            task({ id: 'muted', naturalReminder: false }),
        ], 'char-a', '2026-08-27');
        expect(rows.map(row => row.id)).toEqual(['overdue']);
    });

    it('sorts events by start time and builds a restrained chat context', () => {
        const events: Anniversary[] = [
            { id: 'b', title: '晚饭', date: '2026-08-27', charId: 'char-a', startTime: '19:00' },
            { id: 'a', title: '会议', date: '2026-08-27', charId: 'char-a', startTime: '09:00' },
        ];
        expect(eventsForDate(events, '2026-08-27').map(row => row.id)).toEqual(['a', 'b']);
        const text = buildUserCalendarContext({
            tasks: [task({ dueTime: '17:30' })],
            events,
            supervisorId: 'char-a',
            userName: '千夜',
            today: '2026-08-27',
        });
        expect(text).toContain('仅作自然背景');
        expect(text).toContain('不要每轮重复');
        expect(text).toContain('09:00｜会议');
        expect(text).toContain('17:30｜交报告');
    });
});
