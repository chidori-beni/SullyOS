import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Anniversary, DailySchedule, RoomTodo, Task } from '../types';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { getLocalDateKey } from '../utils/localDate';
import { eventsForDate, notifyCalendarDataUpdated, sortTasksForCalendar, taskDateKey, tasksForDate } from '../utils/calendarIntegration';
import { trackEvent } from '../utils/analytics';

type CalendarTab = 'month' | 'mine' | 'theirs';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const INPUT = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-violet-300 focus:bg-white';
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDateKey = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
};

const ScheduleApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile } = useOS();
    const today = getLocalDateKey();
    const initialCharId = activeCharacterId || characters[0]?.id || '';
    const [tab, setTab] = useState<CalendarTab>('month');
    const [cursor, setCursor] = useState(() => parseDateKey(today));
    const [selectedDate, setSelectedDate] = useState(today);
    const [selectedCharId, setSelectedCharId] = useState(initialCharId);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [events, setEvents] = useState<Anniversary[]>([]);
    const [charSchedule, setCharSchedule] = useState<DailySchedule | null>(null);
    const [charTodo, setCharTodo] = useState<RoomTodo | null>(null);
    const [processing, setProcessing] = useState<Set<string>>(new Set());
    const [commenting, setCommenting] = useState<Set<string>>(new Set());
    const [showTask, setShowTask] = useState(false);
    const [showEvent, setShowEvent] = useState(false);

    const [taskTitle, setTaskTitle] = useState('');
    const [taskNote, setTaskNote] = useState('');
    const [taskDate, setTaskDate] = useState(today);
    const [taskTime, setTaskTime] = useState('');
    const [taskSupervisor, setTaskSupervisor] = useState(initialCharId);
    const [taskReminder, setTaskReminder] = useState(true);
    const [eventTitle, setEventTitle] = useState('');
    const [eventDate, setEventDate] = useState(today);
    const [eventKind, setEventKind] = useState<'event' | 'anniversary'>('event');
    const [eventStart, setEventStart] = useState('');
    const [eventEnd, setEventEnd] = useState('');
    const [eventLocation, setEventLocation] = useState('');
    const [eventNote, setEventNote] = useState('');
    const [eventChar, setEventChar] = useState('');
    const [eventRepeats, setEventRepeats] = useState(false);
    const [eventRepeatDays, setEventRepeatDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [eventRepeatUntil, setEventRepeatUntil] = useState('');

    const loadUserData = useCallback(async () => {
        const [storedTasks, storedEvents] = await Promise.all([DB.getAllTasks(), DB.getAllAnniversaries()]);
        setTasks(sortTasksForCalendar(storedTasks));
        setEvents([...storedEvents].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '')));
    }, []);
    useEffect(() => { loadUserData().catch(error => console.error('Calendar load failed', error)); }, [loadUserData]);
    useEffect(() => {
        if (!selectedCharId) { setCharSchedule(null); setCharTodo(null); return; }
        Promise.all([DB.getDailySchedule(selectedCharId, selectedDate), DB.getRoomTodo(selectedCharId, selectedDate)])
            .then(([schedule, todo]) => { setCharSchedule(schedule); setCharTodo(todo); })
            .catch(error => console.error('Character calendar load failed', error));
    }, [selectedCharId, selectedDate]);

    const selectedTasks = useMemo(() => tasksForDate(tasks, selectedDate), [tasks, selectedDate]);
    const selectedEvents = useMemo(() => eventsForDate(events, selectedDate), [events, selectedDate]);
    const activeTasks = useMemo(() => sortTasksForCalendar(tasks.filter(task => !task.isCompleted)), [tasks]);
    const completedTasks = useMemo(() => tasks.filter(task => task.isCompleted).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)), [tasks]);
    const selectedChar = characters.find(char => char.id === selectedCharId);
    const calendarCells = useMemo(() => {
        const year = cursor.getFullYear(), month = cursor.getMonth();
        return [
            ...Array.from({ length: new Date(year, month, 1).getDay() }, () => null),
            ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => dateKey(new Date(year, month, index + 1))),
        ];
    }, [cursor]);

    const openTaskComposer = (date = selectedDate) => {
        setTaskDate(date); setTaskSupervisor(selectedCharId || characters[0]?.id || ''); setShowTask(true);
        trackEvent('打开日历新建待办');
    };
    const openEventComposer = (date = selectedDate) => {
        setEventDate(date); setEventChar(''); setEventRepeats(false); setEventRepeatDays([1, 2, 3, 4, 5]); setEventRepeatUntil(''); setShowEvent(true);
        trackEvent('打开日历新建事件');
    };
    const generateTaskReward = async (task: Task) => {
        const supervisor = characters.find(char => char.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey) { addToast('待办已完成', 'success'); return; }
        addToast(`${supervisor.name} 正在确认你的成果...`, 'info');
        try {
            await injectMemoryPalace(supervisor, undefined, task.title);
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model, temperature: 0.9, max_tokens: 8000,
                    messages: [
                        { role: 'system', content: ContextBuilder.buildCoreContext(supervisor, userProfile) },
                        { role: 'user', content: `用户 ${userProfile.name} 刚完成待办「${task.title}」。请完全按照你的人设，用用户常用语言给一句自然、简短的评价。不要解释，不要加引号。` },
                    ],
                }),
            });
            if (!response.ok) throw new Error(`API Error ${response.status}`);
            const data = await safeResponseJson(response);
            const text = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
            if (!text) { addToast('待办已完成（角色没有留下评价）', 'success'); return; }
            addToast(`${supervisor.name}: ${text}`, 'success');
            await DB.saveMessage({ charId: supervisor.id, role: 'system', type: 'text', content: `[系统: ${userProfile.name} 完成了待办「${task.title}」。${supervisor.name} 评价道：「${text}」]` });
        } catch (error: any) {
            console.error('Task reward failed', error);
            addToast(`待办已完成，评价生成失败：${error.message}`, 'error');
        }
    };
    const generateTaskComment = async (task: Task) => {
        const supervisor = characters.find(char => char.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey || task.supervisorComment) return;
        setCommenting(current => new Set(current).add(task.id));
        try {
            await injectMemoryPalace(supervisor, undefined, task.title);
            const response = await fetch(apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
                body: JSON.stringify({
                    model: apiConfig.model, temperature: 0.8, max_tokens: 80,
                    messages: [
                        { role: 'system', content: ContextBuilder.buildCoreContext(supervisor, userProfile) },
                        { role: 'user', content: '用户刚添加了一个待办：「' + task.title + '」。请以你的角色口吻写一句放在待办下方的小字，像一句轻声的陪伴或期待。使用用户常用语言，5-20字，只输出这一句，不要引号，不要命令或催促。' },
                    ],
                }),
            });
            if (!response.ok) throw new Error('API Error ' + response.status);
            const data = await safeResponseJson(response);
            const text = data.choices?.[0]?.message?.content?.trim()
                .replace(/^["']|["']$/g, '')
                .replace(/\s+/g, ' ')
                .slice(0, 40);
            if (!text) return;
            // The user can complete the task while this request is in flight; merge into the
            // latest IndexedDB row instead of resurrecting an old isCompleted value.
            const latest = (await DB.getAllTasks()).find(item => item.id === task.id);
            // If the user deleted the task while the request was in flight, do not
            // resurrect it just because the character finished writing a comment.
            if (!latest) return;
            const updated = { ...latest, supervisorComment: text, supervisorCommentGeneratedAt: Date.now() };
            await DB.saveTask(updated);
            setTasks(current => current.map(item => item.id === task.id ? updated : item));
            notifyCalendarDataUpdated();
        } catch (error) {
            console.error('Task comment failed', error);
        } finally {
            setCommenting(current => { const next = new Set(current); next.delete(task.id); return next; });
        }
    };
    const addTask = async () => {
        if (!taskTitle.trim() || !taskDate) return;
        const task: Task = {
            id: `task-${Date.now()}`, title: taskTitle.trim(), note: taskNote.trim() || undefined,
            deadline: taskDate, dueTime: taskTime || undefined, supervisorId: taskSupervisor || characters[0]?.id || '',
            naturalReminder: taskReminder, tone: 'gentle', isCompleted: false, createdAt: Date.now(),
        };
        await DB.saveTask(task);
        setTasks(current => sortTasksForCalendar([...current, task]));
        notifyCalendarDataUpdated();
        void generateTaskComment(task);
        setSelectedDate(taskDate); setCursor(parseDateKey(taskDate));
        setTaskTitle(''); setTaskNote(''); setTaskTime(''); setShowTask(false);
        addToast('待办已加入日历', 'success');
    };
    const toggleTask = async (task: Task) => {
        const updated = { ...task, isCompleted: !task.isCompleted, completedAt: task.isCompleted ? undefined : Date.now() };
        await DB.saveTask(updated);
        setTasks(current => current.map(item => item.id === task.id ? updated : item));
        notifyCalendarDataUpdated();
        if (updated.isCompleted) {
            setProcessing(current => new Set(current).add(task.id));
            try { await generateTaskReward(updated); }
            finally { setProcessing(current => { const next = new Set(current); next.delete(task.id); return next; }); }
        }
    };
    const deleteTask = async (id: string) => {
        await DB.deleteTask(id); setTasks(current => current.filter(task => task.id !== id)); notifyCalendarDataUpdated();
    };
    const addEvent = async () => {
        if (!eventTitle.trim() || !eventDate) return;
        if (eventRepeats && eventRepeatDays.length === 0) {
            addToast('重复日程至少选择一天', 'error');
            return;
        }
        const repeatUntil = eventRepeatUntil && eventRepeatUntil >= eventDate ? eventRepeatUntil : undefined;
        const event: Anniversary = {
            id: `calendar-${Date.now()}`, title: eventTitle.trim(), date: eventDate, kind: eventKind,
            startTime: eventStart || undefined, endTime: eventEnd || undefined, location: eventLocation.trim() || undefined,
            note: eventNote.trim() || undefined, charId: eventChar,
            repeat: eventRepeats && eventRepeatDays.length > 0 ? { type: 'weekly', weekdays: eventRepeatDays, until: repeatUntil } : undefined,
        };
        await DB.saveAnniversary(event);
        setEvents(current => [...current, event].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '')));
        notifyCalendarDataUpdated();
        setSelectedDate(eventDate); setCursor(parseDateKey(eventDate));
        setEventTitle(''); setEventStart(''); setEventEnd(''); setEventLocation(''); setEventNote(''); setEventRepeats(false); setEventRepeatDays([1, 2, 3, 4, 5]); setEventRepeatUntil(''); setShowEvent(false);
        addToast(eventKind === 'anniversary' ? '纪念日已保存' : '日程已保存', 'success');
    };
    const deleteEvent = async (id: string) => {
        await DB.deleteAnniversary(id); setEvents(current => current.filter(event => event.id !== id)); notifyCalendarDataUpdated();
    };
    const toggleCharTodo = async (index: number) => {
        if (!charTodo) return;
        const updated = { ...charTodo, items: charTodo.items.map((item, itemIndex) => itemIndex === index ? { ...item, done: !item.done } : item) };
        await DB.saveRoomTodo(updated); setCharTodo(updated);
        addToast(`已同步到${selectedChar?.name || '角色'}的房间待办`, 'success');
    };

    const renderTask = (task: Task, compact = false) => {
        const supervisor = characters.find(char => char.id === task.supervisorId);
        return <div key={task.id} className="group flex items-start gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
            <button onClick={() => toggleTask(task)} disabled={processing.has(task.id)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${task.isCompleted ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-violet-300 bg-white'}`} aria-label={task.isCompleted ? '恢复待办' : '完成待办'}>{processing.has(task.id) ? '…' : task.isCompleted ? '✓' : ''}</button>
            <div className="min-w-0 flex-1"><div className={`text-sm font-semibold text-slate-700 ${task.isCompleted ? 'line-through opacity-45' : ''}`}>{task.title}</div>
                {(task.supervisorComment || commenting.has(task.id)) && <div className="mt-1 truncate text-[11px] italic text-violet-400">{task.supervisorComment || 'TA 正在想一句话…'}</div>}
                {!compact && task.note && <div className="mt-1 text-xs leading-relaxed text-slate-400">{task.note}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400"><span>{taskDateKey(task)}{task.dueTime ? ` · ${task.dueTime}` : ''}</span>{supervisor && <span>由 {supervisor.name} 陪你</span>}{task.naturalReminder !== false && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-500">可自然提醒</span>}</div>
            </div><button onClick={() => deleteTask(task.id)} className="px-1 text-slate-300 opacity-0 transition hover:text-rose-400 group-hover:opacity-100">×</button>
        </div>;
    };

    return <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f4f1fb] text-slate-700">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.22),transparent_42%),radial-gradient(circle_at_90%_25%,rgba(125,211,252,0.16),transparent_35%)]" />
        <header className="relative z-20 shrink-0 border-b border-white/70 bg-white/65 px-5 pb-3 backdrop-blur-xl" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
            <div className="flex items-center justify-between"><button onClick={closeApp} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-2xl text-slate-500 shadow-sm" aria-label="返回">‹</button><div className="text-center"><div className="text-[10px] font-bold tracking-[0.28em] text-violet-400">SULLY CALENDAR</div><h1 className="text-lg font-bold">日历</h1></div><button onClick={() => openTaskComposer()} className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500 text-xl text-white shadow-lg shadow-violet-200" aria-label="新建待办">＋</button></div>
            <nav className="mt-3 grid grid-cols-3 rounded-2xl bg-slate-100/80 p-1 text-xs font-bold">{([['month', '月历'], ['mine', '我的'], ['theirs', 'TA 的']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-xl py-2 transition ${tab === id ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-400'}`}>{label}</button>)}</nav>
        </header>
        <main className="relative z-10 flex-1 overflow-y-auto px-5 pb-28 pt-5 no-scrollbar">
            {tab === 'month' && <div className="space-y-5">
                <section className="rounded-[2rem] border border-white bg-white/75 p-5 shadow-[0_18px_50px_rgba(85,73,125,0.09)] backdrop-blur-xl">
                    <div className="mb-5 flex items-center justify-between"><button onClick={() => setCursor(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="h-8 w-8 rounded-full bg-slate-100">‹</button><button onClick={() => { setCursor(parseDateKey(today)); setSelectedDate(today); }} className="font-bold">{cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月</button><button onClick={() => setCursor(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="h-8 w-8 rounded-full bg-slate-100">›</button></div>
                    <div className="grid grid-cols-7 text-center text-[10px] font-bold text-slate-300">{WEEKDAYS.map(day => <div key={day} className="pb-2">{day}</div>)}</div>
                    <div className="grid grid-cols-7 gap-y-2 text-center">{calendarCells.map((cell, index) => {
                        if (!cell) return <div key={`empty-${index}`} className="h-11" />;
                        const hasTasks = tasksForDate(tasks, cell).length > 0, hasEvents = eventsForDate(events, cell).length > 0;
                        return <button key={cell} onClick={() => setSelectedDate(cell)} className="relative flex h-11 flex-col items-center justify-center"><span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${cell === selectedDate ? 'bg-violet-500 text-white shadow-md shadow-violet-200' : cell === today ? 'bg-violet-100 text-violet-600' : ''}`}>{Number(cell.slice(-2))}</span><span className="absolute bottom-0 flex gap-0.5">{hasTasks && <i className="h-1 w-1 rounded-full bg-sky-400" />}{hasEvents && <i className="h-1 w-1 rounded-full bg-rose-400" />}</span></button>;
                    })}</div>
                    <div className="mt-4 flex justify-center gap-4 text-[10px] text-slate-400"><span className="text-sky-400">● 待办</span><span className="text-rose-400">● 日程 / 纪念日</span></div>
                </section>
                <section className="space-y-3">
                    <div className="flex items-center justify-between px-1"><div><h2 className="font-bold">{selectedDate === today ? '今天' : selectedDate}</h2><p className="text-[11px] text-slate-400">你的安排与 {selectedChar?.name || '角色'} 的生活放在一起看</p></div><div className="flex gap-2"><button onClick={() => openEventComposer()} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-rose-500 shadow-sm">＋日程</button><button onClick={() => openTaskComposer()} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-sky-500 shadow-sm">＋待办</button></div></div>
                    {selectedEvents.map(event => <div key={event.id} className="group rounded-2xl border border-rose-100 bg-white/85 p-4 shadow-sm"><div className="flex gap-3"><span className="h-9 w-1 rounded-full bg-rose-300" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="text-sm">{event.title}</b><span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] text-rose-500">{event.kind === 'event' ? '日程' : '纪念日'}</span>{event.repeat && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] text-sky-500">每周重复</span>}</div><div className="mt-1 text-[11px] text-slate-400">{event.startTime || '全天'}{event.endTime ? `–${event.endTime}` : ''}{event.location ? ` · ${event.location}` : ''}</div>{event.note && <p className="mt-2 text-xs text-slate-500">{event.note}</p>}</div><button onClick={() => deleteEvent(event.id)} className="text-slate-300 opacity-0 group-hover:opacity-100">×</button></div></div>)}
                    {selectedTasks.map(task => renderTask(task))}
                    {charSchedule?.slots.map((slot, index) => <div key={`${slot.startTime}-${index}`} className="rounded-2xl border border-violet-100 bg-violet-50/80 p-4"><div className="flex gap-3"><span className="text-xl">{slot.emoji || '◌'}</span><div><div className="text-xs font-bold text-violet-500">{selectedChar?.name} · {slot.startTime}{slot.endTime ? `–${slot.endTime}` : ''}</div><div className="mt-1 text-sm font-semibold">{slot.activity}</div>{(slot.description || slot.location) && <div className="mt-1 text-xs text-slate-400">{slot.description}{slot.location ? ` · ${slot.location}` : ''}</div>}</div></div></div>)}
                    {selectedEvents.length + selectedTasks.length + (charSchedule?.slots.length || 0) === 0 && <div className="rounded-3xl border-2 border-dashed border-white bg-white/35 py-10 text-center text-xs text-slate-400">这一天还很空，留一点期待给它。</div>}
                </section>
            </div>}
            {tab === 'mine' && <div className="space-y-6">
                <div className="rounded-[2rem] bg-gradient-to-br from-sky-400 to-violet-500 p-5 text-white shadow-xl shadow-violet-200/60"><div className="text-[10px] font-bold tracking-[0.24em] opacity-70">MY PLAN</div><div className="mt-2 text-2xl font-bold">{activeTasks.length} 件待完成</div><p className="mt-1 text-xs opacity-75">监督角色只会在语境合适时自然提起，不会机械催促。</p></div>
                <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">我的待办</h2><button onClick={() => openTaskComposer(today)} className="text-xs font-bold text-violet-500">＋添加</button></div>{activeTasks.map(task => renderTask(task))}{activeTasks.length === 0 && <div className="py-8 text-center text-xs text-slate-400">没有未完成待办</div>}</section>
                <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">日程与纪念日</h2><button onClick={() => openEventComposer(today)} className="text-xs font-bold text-rose-500">＋添加</button></div>{events.map(event => <button key={event.id} onClick={() => { setSelectedDate(event.date); setCursor(parseDateKey(event.date)); setTab('month'); }} className="flex w-full items-center gap-3 rounded-2xl bg-white/75 p-3 text-left shadow-sm"><div className="rounded-xl bg-rose-50 px-3 py-2 text-center"><div className="text-[9px] text-rose-400">{event.date.slice(5, 7)}月</div><b className="text-sm text-rose-500">{event.date.slice(8)}</b></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{event.title}</div><div className="text-[10px] text-slate-400">{event.kind === 'event' ? '日程' : '纪念日'}{event.startTime ? ` · ${event.startTime}` : ''}</div></div></button>)}</section>
                {completedTasks.length > 0 && <section className="space-y-2 opacity-60"><h2 className="text-sm font-bold">已经完成</h2>{completedTasks.map(task => renderTask(task, true))}</section>}
            </div>}
            {tab === 'theirs' && <div className="space-y-5">
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">{characters.map(char => <button key={char.id} onClick={() => setSelectedCharId(char.id)} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${selectedCharId === char.id ? 'border-violet-300 bg-violet-500 text-white' : 'border-white bg-white/70 text-slate-500'}`}><img src={char.avatar} className="h-7 w-7 rounded-full object-cover" />{char.name}</button>)}</div>
                <div className="rounded-[2rem] bg-white/75 p-5 shadow-sm"><div className="flex items-center justify-between"><div><div className="text-[10px] font-bold tracking-[0.2em] text-violet-400">CHARACTER DAY</div><h2 className="mt-1 text-lg font-bold">{selectedDate}</h2></div><input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500" /></div></div>
                <section className="space-y-3"><h3 className="px-1 text-sm font-bold">日程</h3>{charSchedule?.slots.map((slot, index) => <div key={`${slot.startTime}-${index}`} className="rounded-2xl border border-violet-100 bg-white/80 p-4"><div className="flex gap-3"><span className="text-xl">{slot.emoji || '◌'}</span><div><div className="text-xs font-bold text-violet-500">{slot.startTime}{slot.endTime ? `–${slot.endTime}` : ''} · {slot.busyLevel === 'sleep' ? '休息中' : slot.busyLevel === 'busy' ? '比较忙' : slot.busyLevel === 'light' ? '稍忙' : '较空闲'}</div><div className="mt-1 font-semibold">{slot.activity}</div>{slot.description && <p className="mt-1 text-xs text-slate-400">{slot.description}</p>}</div></div></div>)}{!charSchedule && <div className="rounded-2xl border-2 border-dashed border-white py-8 text-center text-xs text-slate-400">这一天还没有生成角色日程</div>}</section>
                <section className="space-y-3"><div className="flex items-center justify-between px-1"><h3 className="text-sm font-bold">TA 的待办</h3><span className="text-[10px] text-slate-400">与房间同步</span></div>{charTodo?.items.map((item, index) => <button key={`${item.text}-${index}`} onClick={() => toggleCharTodo(index)} className="flex w-full items-center gap-3 rounded-2xl bg-white/80 p-3 text-left shadow-sm"><span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${item.done ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-violet-200'}`}>{item.done ? '✓' : ''}</span><span className={`text-sm ${item.done ? 'line-through opacity-40' : ''}`}>{item.text}</span></button>)}{!charTodo?.items.length && <div className="py-6 text-center text-xs text-slate-400">TA 今天还没有写待办</div>}</section>
            </div>}
        </main>
        <Modal isOpen={showTask} title="添加我的待办" onClose={() => setShowTask(false)} footer={<button onClick={addTask} className="w-full rounded-2xl bg-violet-500 py-3 font-bold text-white shadow-lg shadow-violet-200">加入日历</button>}>
            <div className="space-y-4"><input autoFocus value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="要完成什么？" className={INPUT} /><textarea value={taskNote} onChange={event => setTaskNote(event.target.value)} placeholder="备注（可选）" rows={2} className={INPUT} /><div className="grid grid-cols-2 gap-3"><input type="date" value={taskDate} onChange={event => setTaskDate(event.target.value)} className={INPUT} /><input type="time" value={taskTime} onChange={event => setTaskTime(event.target.value)} className={INPUT} /></div><label className="block text-[10px] font-bold tracking-widest text-slate-400">监督 / 陪伴角色</label><div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">{characters.map(char => <button key={char.id} onClick={() => setTaskSupervisor(char.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${taskSupervisor === char.id ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{char.name}</button>)}</div><label className="flex items-center justify-between rounded-2xl bg-violet-50 p-3 text-xs text-slate-600"><span><b className="block">允许自然提醒</b><span className="text-[10px] text-slate-400">角色只在聊天语境合适时提起</span></span><input type="checkbox" checked={taskReminder} onChange={event => setTaskReminder(event.target.checked)} className="h-5 w-5 accent-violet-500" /></label></div>
        </Modal>
        <Modal isOpen={showEvent} title="添加日程 / 纪念日" onClose={() => setShowEvent(false)} footer={<button onClick={addEvent} className="w-full rounded-2xl bg-rose-400 py-3 font-bold text-white shadow-lg shadow-rose-200">保存</button>}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-xs font-bold">
                    <button onClick={() => setEventKind('event')} className={`rounded-xl py-2 ${eventKind === 'event' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-400'}`}>日程</button>
                    <button onClick={() => setEventKind('anniversary')} className={`rounded-xl py-2 ${eventKind === 'anniversary' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-400'}`}>纪念日</button>
                </div>
                <input autoFocus value={eventTitle} onChange={event => setEventTitle(event.target.value)} placeholder={eventKind === 'event' ? '日程名称' : '纪念日名称'} className={INPUT} />
                <input type="date" value={eventDate} onChange={event => { const nextDate = event.target.value; setEventDate(nextDate); if (eventRepeatUntil && eventRepeatUntil < nextDate) setEventRepeatUntil(''); }} className={INPUT} />
                {eventKind === 'event' && <><div className="grid grid-cols-2 gap-3"><input type="time" value={eventStart} onChange={event => setEventStart(event.target.value)} className={INPUT} /><input type="time" value={eventEnd} onChange={event => setEventEnd(event.target.value)} className={INPUT} /></div><input value={eventLocation} onChange={event => setEventLocation(event.target.value)} placeholder="地点（可选）" className={INPUT} /></>}
                <textarea value={eventNote} onChange={event => setEventNote(event.target.value)} placeholder="备注（可选）" rows={2} className={INPUT} />
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center justify-between"><div><b className="block text-xs text-slate-600">重复日程</b><span className="text-[10px] text-slate-400">按每周选择重复的星期</span></div><input type="checkbox" checked={eventRepeats} onChange={event => setEventRepeats(event.target.checked)} className="h-5 w-5 accent-rose-400" /></div>
                    {eventRepeats && <div className="mt-3 space-y-3"><div className="grid grid-cols-7 gap-1">{WEEKDAYS.map((day, index) => <button key={day + index} onClick={() => setEventRepeatDays(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index].sort())} className={`rounded-xl py-2 text-[10px] font-bold ${eventRepeatDays.includes(index) ? 'bg-rose-400 text-white' : 'bg-white text-slate-400'}`}>{day}</button>)}</div><label className="block text-[10px] text-slate-400">重复至（可选）<input type="date" value={eventRepeatUntil} min={eventDate} onChange={event => setEventRepeatUntil(event.target.value)} className={`mt-1 ${INPUT}`} /></label>{eventRepeatDays.length === 0 && <p className="text-[10px] text-rose-400">至少选择一天</p>}</div>}
                </div>
                <div><label className="mb-2 block text-[10px] font-bold tracking-widest text-slate-400">关联角色（可选）</label><div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar"><button onClick={() => setEventChar('')} className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${!eventChar ? 'bg-rose-400 text-white' : 'bg-slate-100 text-slate-500'}`}>仅自己</button>{characters.map(char => <button key={char.id} onClick={() => setEventChar(char.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${eventChar === char.id ? 'bg-rose-400 text-white' : 'bg-slate-100 text-slate-500'}`}>{char.name}</button>)}</div><p className="mt-2 text-[10px] text-slate-400">不关联角色也可以保存为自己的独立安排。</p></div>
            </div>
        </Modal>
    </div>;
};

export default ScheduleApp;
