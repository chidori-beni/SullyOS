import type { Anniversary, CalendarMoodId, Task } from '../types';
import { eventOccursOnDate, taskDateKey } from './calendarIntegration';

export const CALENDAR_MOODS: Array<{ id: CalendarMoodId; label: string; face: string; color: string }> = [
    { id: 'happy', label: '开心', face: '😊', color: '#fbbf24' },
    { id: 'excited', label: '兴奋', face: '🤩', color: '#fb7185' },
    { id: 'relaxed', label: '轻松', face: '😌', color: '#86efac' },
    { id: 'calm', label: '平静', face: '🙂', color: '#93c5fd' },
    { id: 'tired', label: '累了', face: '😪', color: '#c4b5fd' },
    { id: 'anxious', label: '焦虑', face: '😰', color: '#67e8f9' },
    { id: 'irritated', label: '烦躁', face: '😣', color: '#fdba74' },
    { id: 'sad', label: '难过', face: '😢', color: '#94a3b8' },
    { id: 'angry', label: '生气', face: '😠', color: '#f87171' },
];

export interface MonthlyReviewStats {
    monthKey: string;
    moodDays: number;
    topMoods: Array<{ id: CalendarMoodId; count: number; percent: number }>;
    eventCount: number;
    taskCount: number;
    completedTaskCount: number;
    completionRate: number;
    mostFrequentEvent?: string;
    longestEvent?: string;
    completedTaskTitles: string[];
}

const daysInMonth = (monthKey: string): string[] => {
    const [year, month] = monthKey.split('-').map(Number);
    return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) =>
        `${monthKey}-${String(index + 1).padStart(2, '0')}`,
    );
};

const durationMinutes = (event: Anniversary): number => {
    if (!event.startTime || !event.endTime) return 0;
    const [startHour, startMinute] = event.startTime.split(':').map(Number);
    const [endHour, endMinute] = event.endTime.split(':').map(Number);
    return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
};

export const buildMonthlyReviewStats = (params: {
    monthKey: string;
    moods?: Record<string, CalendarMoodId>;
    tasks: Task[];
    events: Anniversary[];
}): MonthlyReviewStats => {
    const dates = daysInMonth(params.monthKey);
    const moodCounts = new Map<CalendarMoodId, number>();
    for (const date of dates) {
        const mood = params.moods?.[date];
        if (mood) moodCounts.set(mood, (moodCounts.get(mood) || 0) + 1);
    }
    const moodDays = [...moodCounts.values()].reduce((sum, count) => sum + count, 0);
    const topMoods = [...moodCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([id, count]) => ({ id, count, percent: moodDays ? Math.round(count / moodDays * 100) : 0 }));

    const eventOccurrences = dates.flatMap(date => params.events
        .filter(event => eventOccursOnDate(event, date))
        .map(event => ({ event, date })));
    const eventFrequencies = new Map<string, number>();
    for (const occurrence of eventOccurrences) {
        eventFrequencies.set(occurrence.event.title, (eventFrequencies.get(occurrence.event.title) || 0) + 1);
    }
    const mostFrequentEvent = [...eventFrequencies.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
    const longestEvent = [...eventOccurrences]
        .sort((left, right) => durationMinutes(right.event) - durationMinutes(left.event))[0]?.event;

    const monthTasks = params.tasks.filter(task => taskDateKey(task).startsWith(`${params.monthKey}-`));
    const completedTasks = monthTasks.filter(task => task.isCompleted);
    return {
        monthKey: params.monthKey,
        moodDays,
        topMoods,
        eventCount: eventOccurrences.length,
        taskCount: monthTasks.length,
        completedTaskCount: completedTasks.length,
        completionRate: monthTasks.length ? Math.round(completedTasks.length / monthTasks.length * 100) : 0,
        mostFrequentEvent,
        longestEvent: longestEvent && durationMinutes(longestEvent) > 0 ? longestEvent.title : undefined,
        completedTaskTitles: completedTasks.slice(0, 4).map(task => task.title),
    };
};

export const chooseMonthlyMessageCharacterId = (params: {
    characterIds: string[];
    activeCharacterId?: string;
    monthKey: string;
    tasks: Task[];
    events: Anniversary[];
}): string | undefined => {
    const scores = new Map(params.characterIds.map(id => [id, 0]));
    for (const date of daysInMonth(params.monthKey)) {
        for (const event of params.events) {
            if (eventOccursOnDate(event, date) && scores.has(event.charId)) {
                scores.set(event.charId, (scores.get(event.charId) || 0) + 2);
            }
        }
    }
    for (const task of params.tasks) {
        if (task.isCompleted && taskDateKey(task).startsWith(`${params.monthKey}-`) && scores.has(task.supervisorId)) {
            scores.set(task.supervisorId, (scores.get(task.supervisorId) || 0) + 1);
        }
    }
    const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
    if ((ranked[0]?.[1] || 0) > 0) return ranked[0][0];
    if (params.activeCharacterId && scores.has(params.activeCharacterId)) return params.activeCharacterId;
    return params.characterIds[0];
};

export const buildSullyMonthlyReport = (stats: MonthlyReviewStats): string => {
    const dominant = stats.topMoods[0] && CALENDAR_MOODS.find(mood => mood.id === stats.topMoods[0].id);
    const life = stats.eventCount > 0 ? `跑完了 ${stats.eventCount} 段日程` : '这个月的日程区安静得像离线服务器';
    const tasks = stats.taskCount > 0
        ? `待办清掉 ${stats.completedTaskCount}/${stats.taskCount}，完成率 ${stats.completionRate}%`
        : '待办列表暂时没有抓到数据包';
    const mood = dominant
        ? `情绪主频道是「${dominant.label}」——记录了 ${stats.moodDays} 天，系统没有漏听。`
        : '心情频道还没接上线。下个月随手点几次，我就能少靠残余语料瞎猜。';
    return `${life}，${tasks}。${mood} 嗯，数据库在咕咕叫，但你确实有在生活。`;
};
