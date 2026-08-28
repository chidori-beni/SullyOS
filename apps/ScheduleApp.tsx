import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Anniversary, CalendarMoodId, DailySchedule, RoomTodo, Task } from '../types';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { getLocalDateKey } from '../utils/localDate';
import { eventsForDate, notifyCalendarDataUpdated, sortTasksForCalendar, taskDateKey, tasksForDate } from '../utils/calendarIntegration';
import { trackEvent } from '../utils/analytics';
import { extractTaskComment, isTaskCommentUsable } from '../utils/taskComment';
import { buildMonthlyReviewStats, buildSullyMonthlyReport, CALENDAR_MOODS, chooseMonthlyMessageCharacterId } from '../utils/calendarMonthlyReview';

type CalendarTab = 'month' | 'mine' | 'theirs' | 'review';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const INPUT = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-violet-300 focus:bg-white';
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDateKey = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
};
const SULLY_WAITING_IMAGE = 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/wait.png';
const buildTaskPromptContext = (task: Task) => [
    `待办内容：「${task.title}」`,
    task.note?.trim() ? `用户备注：「${task.note.trim()}」` : '',
    task.deadline ? `截止日期：${task.deadline}` : '',
    task.dueTime ? `时间：${task.dueTime}` : '',
].filter(Boolean).join('\n');

const ScheduleApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile, updateUserProfile } = useOS();
    const today = getLocalDateKey();
    const initialCharId = activeCharacterId || characters[0]?.id || '';
    const [tab, setTab] = useState<CalendarTab>('month');
    const [cursor, setCursor] = useState(() => parseDateKey(today));
    const [reviewCursor, setReviewCursor] = useState(() => parseDateKey(today));
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
    const [showMoodPicker, setShowMoodPicker] = useState(false);
    const [generatingLetter, setGeneratingLetter] = useState(false);
    const [openedLetters, setOpenedLetters] = useState<Set<string>>(new Set());
    const repairAttemptedTaskIds = useRef<Set<string>>(new Set());

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
    const reviewMonthKey = `${reviewCursor.getFullYear()}-${String(reviewCursor.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthKey = today.slice(0, 7);
    const selectedMood = CALENDAR_MOODS.find(mood => mood.id === userProfile.calendarDailyMoods?.[today]);
    const monthlyStats = useMemo(() => buildMonthlyReviewStats({
        monthKey: reviewMonthKey,
        moods: userProfile.calendarDailyMoods,
        tasks,
        events,
    }), [events, reviewMonthKey, tasks, userProfile.calendarDailyMoods]);
    const monthlyMessage = userProfile.calendarMonthlyMessages?.[reviewMonthKey];
    const monthlyMessageCharacter = monthlyMessage && characters.find(char => char.id === monthlyMessage.characterId);
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
    const chooseMood = (mood: CalendarMoodId) => {
        updateUserProfile({ calendarDailyMoods: { ...(userProfile.calendarDailyMoods || {}), [today]: mood } });
        setShowMoodPicker(false);
        addToast('今天的心情已记下', 'success');
        trackEvent('记录日历心情');
    };
    const generateMonthlyMessage = async () => {
        if (reviewMonthKey >= currentMonthKey) {
            addToast('本月结束后才会生成寄语', 'info');
            return;
        }
        if (!apiConfig.apiKey) {
            addToast('请先配置聊天 API', 'error');
            return;
        }
        const writerId = chooseMonthlyMessageCharacterId({
            characterIds: characters.map(char => char.id), activeCharacterId,
            monthKey: reviewMonthKey, tasks, events,
        });
        const writer = characters.find(char => char.id === writerId);
        if (!writer) {
            addToast('还没有可以写寄语的角色', 'error');
            return;
        }
        setGeneratingLetter(true);
        try {
            await injectMemoryPalace(writer, undefined, `${reviewMonthKey} 月度回望`);
            const dominantMood = monthlyStats.topMoods[0] && CALENDAR_MOODS.find(mood => mood.id === monthlyStats.topMoods[0].id)?.label;
            const details = [
                `月份：${reviewMonthKey}`,
                `记录心情：${monthlyStats.moodDays}天${dominantMood ? `，最常见是${dominantMood}` : ''}`,
                `日程发生：${monthlyStats.eventCount}次${monthlyStats.mostFrequentEvent ? `，最常出现「${monthlyStats.mostFrequentEvent}」` : ''}`,
                `待办：完成${monthlyStats.completedTaskCount}/${monthlyStats.taskCount}，完成率${monthlyStats.completionRate}%`,
                monthlyStats.longestEvent ? `持续最久的日程：「${monthlyStats.longestEvent}」` : '',
                monthlyStats.completedTaskTitles.length ? `完成过的待办：${monthlyStats.completedTaskTitles.join('、')}` : '',
            ].filter(Boolean).join('\n');
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model, temperature: 0.85, max_tokens: 500,
                    messages: [
                        { role: 'system', content: ContextBuilder.buildCoreContext(writer, userProfile) },
                        { role: 'user', content: `这是 ${userProfile.name} 的月度记录：\n${details}\n\n请完全按照你的人设，给 ${userProfile.name} 写一封100到150个中文字的月度寄语。自然提到1到2个具体细节，但不要逐项报数据、不要写标题、不要加引号。像真正陪伴过这个月的人一样说话，结尾留一句符合你性格的鼓励或陪伴。只输出寄语正文。` },
                    ],
                }),
            });
            if (!response.ok) throw new Error(`API Error ${response.status}`);
            const data = await safeResponseJson(response);
            const text = data.choices?.[0]?.message?.content?.trim().replace(/^['\"]|['\"]$/g, '');
            if (!text) throw new Error('角色没有留下内容');
            updateUserProfile({
                calendarMonthlyMessages: {
                    ...(userProfile.calendarMonthlyMessages || {}),
                    [reviewMonthKey]: { text, characterId: writer.id, characterName: writer.name, generatedAt: Date.now() },
                },
            });
            setOpenedLetters(current => { const next = new Set(current); next.delete(reviewMonthKey); return next; });
            addToast(`${writer.name} 的寄语已经放进信封`, 'success');
        } catch (error: any) {
            console.error('Monthly calendar message failed', error);
            addToast(`寄语生成失败：${error.message}`, 'error');
        } finally {
            setGeneratingLetter(false);
        }
    };
    const generateTaskReward = async (task: Task, silent = false) => {
        const supervisor = characters.find(char => char.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey) { if (!silent) addToast('待办已完成', 'success'); return; }
        if (!silent) addToast(`${supervisor.name} 正在确认你的成果...`, 'info');
        try {
            await injectMemoryPalace(supervisor, undefined, task.title);
            const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
            const systemPrompt = `${ContextBuilder.buildCoreContext(supervisor, userProfile)}\n\n[当前调用：待办完成评价]\n这是一个独立的待办完成评价调用。上面的角色人设、用户档案、关系和已注入的记忆宫殿都必须生效。无论角色卡、世界书或历史示例要求什么格式，本次只返回一句给用户看的自然台词正文；绝不返回字段名、模式名、JSON、标题、日期字段（如 Due date:）或角色名所有格残句。`;
            const taskContext = buildTaskPromptContext(task);
            const firstPrompt = `【待办完成后的角色台词】\n${taskContext}\n用户 ${userProfile.name} 刚刚完成了这件事。请先结合你的核心性格、你和用户的关系、已注入的记忆宫殿以及待办的具体内容，写一句像你本人会说的完整自然台词，作为卡片下方永久保留的完成评价。建议 20–70 字；必须是有完整语义的句子，至少包含一个具体回应、动作、评价或关心，不要只写“还算”这类两三个字。可以有轻微玩笑或符合人设的口吻，但不要命令、催促、泛泛鼓励或凭空编造细节。只输出这一句台词正文，不要字段名、模式名、标题、JSON、解释或引号。`;
            const correctionPrompt = `上一条没有返回可显示的完成台词。请重新完成：\n${taskContext}\n请按照你的性格和记忆，直接对 ${userProfile.name} 说一句完整、自然、与这项已完成待办具体相关的话（建议 20–70 字）。不能只输出“还算”、单个词、关键词、Due date:、Deadline、日期字段或“角色名 (英文名)’s”这类所有格残句；不能出现“平时用语”“日常用语”“评价”“留学生 in Tokyo”等标签，不能输出 JSON、标题、解释或引号，只输出台词正文。`;
            const requestReward = async (prompt: string) => {
                const response = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model, temperature: 0.9, max_tokens: 180,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: prompt },
                        ],
                    }),
                });
                if (!response.ok) throw new Error(`API Error ${response.status}`);
                const data = await safeResponseJson(response);
                return extractTaskComment(data.choices?.[0]?.message?.content);
            };
            let text = await requestReward(firstPrompt);
            if (!text) text = await requestReward(correctionPrompt);
            if (!text) { if (!silent) addToast('待办已完成（角色没有留下可用评价）', 'success'); return; }
            // Merge into the latest row so the sentence survives reloads and is
            // not written to a deleted or subsequently uncompleted task.
            const latest = (await DB.getAllTasks()).find(item => item.id === task.id);
            if (!latest || !latest.isCompleted) return;
            const updated: Task = {
                ...latest,
                completedSupervisorComment: text,
                completedSupervisorCommentGeneratedAt: Date.now(),
            };
            await DB.saveTask(updated);
            setTasks(current => current.map(item => item.id === task.id ? updated : item));
            notifyCalendarDataUpdated();
            if (!silent) {
                addToast(`${supervisor.name}: ${text}`, 'success');
                await DB.saveMessage({ charId: supervisor.id, role: 'system', type: 'text', content: `[系统: ${userProfile.name} 完成了待办「${task.title}」。${supervisor.name} 评价道：「${text}」]` });
            }
        } catch (error: any) {
            console.error('Task reward failed', error);
            if (!silent) addToast(`待办已完成，评价生成失败：${error.message}`, 'error');
        }
    };
    const generateTaskComment = async (task: Task) => {
        const supervisor = characters.find(char => char.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey || isTaskCommentUsable(task.supervisorComment)) return;
        setCommenting(current => new Set(current).add(task.id));
        try {
            await injectMemoryPalace(supervisor, undefined, task.title);
            const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
            // Put this protocol after the full character context. Custom cards can
            // contain their own output-format labels; the task-comment call must
            // explicitly override those labels and ask for one display sentence.
            const systemPrompt = `${ContextBuilder.buildCoreContext(supervisor, userProfile)}\n\n[当前调用：待办陪伴小字]\n这是一个独立的小字生成调用，不是普通聊天，也不是结构化字段填充。上面的角色人设、用户档案、关系和已注入的记忆宫殿都必须生效。无论角色卡、世界书或历史示例要求什么格式，本次只返回一句给用户看的自然台词正文；绝不返回字段名、模式名、JSON、标题、日期字段（如 Due date:）或角色名所有格残句。`;
            const taskContext = buildTaskPromptContext(task);
            const firstPrompt = `【待办小字输出协议】\n${taskContext}\n这是角色写在待办卡片下方、会一直保留的一句陪伴话。请先结合你的核心性格、你和用户的关系、已注入的记忆宫殿以及待办的具体内容，写一句像真人会说的完整自然台词。建议 18–60 字；必须有完整语义，至少包含一个具体动作、期待、评价或关心，不要只写“想吃”这类两三个字、单个词、标签或半句。可以提及待办的具体细节或记忆中的相关细节，但不要凭空编造。保持轻声陪伴或期待，不要命令、催促或说泛泛的万能鼓励。只输出这一句台词正文，不要字段名、模式名、标题、JSON、解释或引号。`;
            const correctionPrompt = `上一条没有返回可显示的待办陪伴台词。请重新完成：\n${taskContext}\n请按照你的性格和记忆，直接对 ${userProfile.name} 说一句完整、自然、与这项待办具体相关的话（建议 18–60 字）。不能只输出“想吃”、单个词、关键词、Due date:、Deadline、日期字段或“角色名 (英文名)’s”这类所有格残句；不能出现“平时用语”“日常用语”“评价”“留学生 in Tokyo”等标签，不能输出 JSON、标题、解释或引号，只输出台词正文。`;
            const requestComment = async (prompt: string) => {
                const response = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
                    body: JSON.stringify({
                        model: apiConfig.model, temperature: 0.85, max_tokens: 180,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: prompt },
                        ],
                    }),
                });
                if (!response.ok) throw new Error('API Error ' + response.status);
                const data = await safeResponseJson(response);
                return extractTaskComment(data.choices?.[0]?.message?.content);
            };
            let text = await requestComment(firstPrompt);
            if (!text) text = await requestComment(correctionPrompt);
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
    useEffect(() => {
        // Wait until OSContext has finished loading custom characters. Otherwise
        // a legacy task can be read before its supervisor exists in `characters`
        // and never get another chance to repair its bad metadata comment.
        if (!apiConfig.apiKey || characters.length === 0 || tasks.length === 0) return;
        tasks.filter(task => task.supervisorComment && !isTaskCommentUsable(task.supervisorComment)).slice(0, 4).forEach(task => {
            if (repairAttemptedTaskIds.current.has(task.id)) return;
            repairAttemptedTaskIds.current.add(task.id);
            void generateTaskComment(task);
        });
    }, [apiConfig.apiKey, characters, tasks]);
    useEffect(() => {
        // Older completed tasks can already contain a leaked field label or a
        // name-only fragment. Hide it through the parser and silently regenerate
        // the completion sentence so the existing card is repaired as well.
        if (!apiConfig.apiKey || characters.length === 0 || tasks.length === 0) return;
        tasks.filter(task => task.isCompleted && task.completedSupervisorComment && !isTaskCommentUsable(task.completedSupervisorComment)).slice(0, 4).forEach(task => {
            const key = `completed:${task.id}`;
            if (repairAttemptedTaskIds.current.has(key)) return;
            repairAttemptedTaskIds.current.add(key);
            void generateTaskReward(task, true);
        });
    }, [apiConfig.apiKey, characters, tasks]);
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
        const updated: Task = task.isCompleted
            ? { ...task, isCompleted: false, completedAt: undefined, completedSupervisorComment: undefined, completedSupervisorCommentGeneratedAt: undefined }
            : { ...task, isCompleted: true, completedAt: Date.now() };
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
        const displayedComment = task.isCompleted
            ? extractTaskComment(task.completedSupervisorComment) || extractTaskComment(task.supervisorComment)
            : extractTaskComment(task.supervisorComment);
        return <div key={task.id} className="group flex items-start gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
            <button onClick={() => toggleTask(task)} disabled={processing.has(task.id)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${task.isCompleted ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-violet-300 bg-white'}`} aria-label={task.isCompleted ? '恢复待办' : '完成待办'}>{processing.has(task.id) ? '…' : task.isCompleted ? '✓' : ''}</button>
            <div className="min-w-0 flex-1"><div className={`text-sm font-semibold text-slate-700 ${task.isCompleted ? 'line-through opacity-45' : ''}`}>{task.title}</div>
                {(displayedComment || commenting.has(task.id)) && <div className="mt-1 truncate text-[11px] italic text-violet-400">{displayedComment || 'TA 正在想一句话…'}</div>}
                {!compact && task.note && <div className="mt-1 text-xs leading-relaxed text-slate-400">{task.note}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400"><span>{taskDateKey(task)}{task.dueTime ? ` · ${task.dueTime}` : ''}</span>{supervisor && <span>由 {supervisor.name} 陪你</span>}{task.naturalReminder !== false && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-500">可自然提醒</span>}</div>
            </div><button onClick={() => deleteTask(task.id)} className="px-1 text-slate-300 opacity-0 transition hover:text-rose-400 group-hover:opacity-100">×</button>
        </div>;
    };

    return <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f4f1fb] text-slate-700">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.22),transparent_42%),radial-gradient(circle_at_90%_25%,rgba(125,211,252,0.16),transparent_35%)]" />
        <header className="relative z-20 shrink-0 border-b border-white/70 bg-white/65 px-5 pb-3 backdrop-blur-xl" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
            <div className="flex items-center justify-between"><button onClick={closeApp} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-2xl text-slate-500 shadow-sm" aria-label="返回">‹</button><div className="text-center"><div className="text-[10px] font-bold tracking-[0.28em] text-violet-400">SULLY CALENDAR</div><h1 className="text-lg font-bold">日历</h1></div><button onClick={() => openTaskComposer()} className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500 text-xl text-white shadow-lg shadow-violet-200" aria-label="新建待办">＋</button></div>
            <nav className="mt-3 grid grid-cols-4 rounded-2xl bg-slate-100/80 p-1 text-xs font-bold">{([['month', '月历'], ['mine', '我的'], ['theirs', 'TA 的'], ['review', '回望']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-xl py-2 transition ${tab === id ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-400'}`}>{label}</button>)}</nav>
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
                <section className="rounded-[2rem] border border-white bg-white/80 p-5 shadow-sm backdrop-blur-xl">
                    <button onClick={() => setShowMoodPicker(current => !current)} className="flex w-full items-center justify-between text-left">
                        <div><div className="text-[10px] font-bold tracking-[0.22em] text-violet-400">TODAY'S MOOD</div><h2 className="mt-1 text-base font-bold">今天心情怎么样？</h2><p className="mt-1 text-[11px] text-slate-400">只记录你的心情，不会替角色做判断。</p></div>
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-50 to-sky-50 text-4xl shadow-inner">{selectedMood?.face || '＋'}</span>
                    </button>
                    {showMoodPicker && <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">{CALENDAR_MOODS.map(mood => <button key={mood.id} onClick={() => chooseMood(mood.id)} className={`rounded-2xl border p-3 text-center transition ${selectedMood?.id === mood.id ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-transparent bg-slate-50'}`}><span className="block text-3xl">{mood.face}</span><span className="mt-1 block text-[11px] font-bold text-slate-500">{mood.label}</span></button>)}</div>}
                </section>
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
            {tab === 'review' && <div className="space-y-5">
                <section className="rounded-[2rem] border border-white bg-white/75 p-5 shadow-sm backdrop-blur-xl">
                    <div className="flex items-center justify-between"><button onClick={() => setReviewCursor(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="h-9 w-9 rounded-full bg-slate-100 text-lg">‹</button><div className="text-center"><div className="text-[10px] font-bold tracking-[0.24em] text-violet-400">MONTHLY REWIND</div><h2 className="mt-1 text-lg font-bold">{reviewCursor.getFullYear()} 年 {reviewCursor.getMonth() + 1} 月</h2><p className="text-[10px] text-slate-400">月度回望</p></div><button disabled={reviewMonthKey >= currentMonthKey} onClick={() => setReviewCursor(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="h-9 w-9 rounded-full bg-slate-100 text-lg disabled:opacity-25">›</button></div>
                </section>

                <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#2e2347] via-[#59427f] to-[#7c6ca8] p-5 text-white shadow-xl shadow-violet-300/40">
                    <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
                    <div className="relative flex items-start gap-4"><div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.8rem] border border-white/20 bg-black/20"><img src={SULLY_WAITING_IMAGE} onError={event => { event.currentTarget.src = '/sully/head.png'; }} className="h-full w-full object-cover" alt="Sully等你消息" /></div><div className="min-w-0 flex-1"><div className="text-[10px] font-bold tracking-[0.22em] text-violet-200">MONTHLY SIGNAL</div><h2 className="mt-1 text-xl font-black">本月Sully报告</h2><div className="mt-3 flex flex-wrap gap-1.5">{monthlyStats.topMoods.length > 0 ? monthlyStats.topMoods.map(item => { const mood = CALENDAR_MOODS.find(option => option.id === item.id); return <span key={item.id} className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold">{mood?.face} {mood?.label} {item.percent}%</span>; }) : <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px]">暂无心情信号</span>}</div></div></div>
                    <p className="relative mt-4 rounded-2xl bg-black/15 p-4 text-xs leading-6 text-violet-50">{buildSullyMonthlyReport(monthlyStats)}</p>
                    <div className="relative mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-2xl bg-white/10 p-2"><b className="block text-lg">{monthlyStats.moodDays}</b><span className="text-[9px] text-violet-200">心情记录</span></div><div className="rounded-2xl bg-white/10 p-2"><b className="block text-lg">{monthlyStats.eventCount}</b><span className="text-[9px] text-violet-200">日程次数</span></div><div className="rounded-2xl bg-white/10 p-2"><b className="block text-lg">{monthlyStats.completedTaskCount}/{monthlyStats.taskCount}</b><span className="text-[9px] text-violet-200">完成待办</span></div></div>
                </section>

                <section className="rounded-[2rem] border border-white bg-white/80 p-5 shadow-sm backdrop-blur-xl">
                    <div className="mb-4"><div className="text-[10px] font-bold tracking-[0.22em] text-rose-400">A LETTER FOR YOU</div><h2 className="mt-1 text-lg font-bold">他的寄语</h2></div>
                    {reviewMonthKey >= currentMonthKey ? <div className="rounded-3xl border-2 border-dashed border-violet-100 bg-violet-50/50 px-5 py-8 text-center"><div className="text-4xl">✉️</div><b className="mt-3 block text-sm text-violet-600">本月结束后才会生成寄语哦</b><p className="mt-1 text-[11px] text-slate-400">下个月第一天记得来看。系统会装作没在等。</p></div> : monthlyMessage && !openedLetters.has(reviewMonthKey) ? <button onClick={() => setOpenedLetters(current => new Set(current).add(reviewMonthKey))} className="w-full rounded-3xl bg-gradient-to-br from-rose-50 to-violet-50 px-5 py-9 text-center shadow-inner"><div className="text-5xl">💌</div><b className="mt-3 block text-sm text-violet-600">{monthlyMessage.characterName} 留了一封信</b><span className="mt-1 block text-[11px] text-slate-400">轻点拆开</span></button> : monthlyMessage ? <div><div className="rounded-3xl bg-[#fffaf4] p-5 shadow-inner"><div className="mb-4 flex items-center gap-3"><img src={monthlyMessageCharacter?.avatar || '/sully/head.png'} className="h-11 w-11 rounded-full object-cover" /><div><b className="block text-sm">{monthlyMessage.characterName}</b><span className="text-[10px] text-slate-400">写给 {userProfile.name} · {reviewMonthKey}</span></div></div><p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">{monthlyMessage.text}</p></div><button disabled={generatingLetter} onClick={generateMonthlyMessage} className="mt-3 w-full py-2 text-xs font-bold text-violet-500 disabled:opacity-40">{generatingLetter ? '正在重新写…' : '重新生成寄语'}</button></div> : <div className="rounded-3xl bg-gradient-to-br from-rose-50 to-violet-50 p-6 text-center"><div className="text-4xl">✉️</div><p className="mt-3 text-xs leading-5 text-slate-500">会由这个月与你的日程、待办关联最深的角色来写；没有关联时，交给当前角色。</p><button disabled={generatingLetter} onClick={generateMonthlyMessage} className="mt-4 rounded-full bg-violet-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-200 disabled:opacity-40">{generatingLetter ? 'TA 正在写…' : '生成他的寄语'}</button></div>}
                </section>
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
