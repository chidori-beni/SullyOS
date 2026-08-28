import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Anniversary, CalendarMoodId, CharacterProfile, DailySchedule, RoomTodo, Task, UserProfile } from '../types';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { buildChatRequestPayload } from '../utils/chatRequestPayload';
import { loadCharacterContextRange } from '../utils/chatContextRange';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { getLocalDateKey } from '../utils/localDate';
import { eventsForDate, notifyCalendarDataUpdated, sortTasksForCalendar, taskDateKey, tasksForDate } from '../utils/calendarIntegration';
import { trackEvent } from '../utils/analytics';
import { formatTaskComment, extractTaskComment, isTaskCommentUsable } from '../utils/taskComment';
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
    `待办内容：${task.title}`,
    task.note?.trim() ? `用户备注：${task.note.trim()}` : '',
    task.deadline ? `截止日期：${task.deadline}` : '',
    task.dueTime ? `时间：${task.dueTime}` : '',
].filter(Boolean).join('\n');

const buildTaskCharacterVoiceContext = (character: CharacterProfile) => character.writerPersona?.trim()
    ? `\n\n### 角色写作人格（待办台词必须遵循）\n${character.writerPersona.trim()}\n`
    : '';

const buildRecentTaskVoiceCue = (history: Array<{ role?: string; type?: string; content?: unknown }>) => {
    const lines = history
        .filter(message => message.role === 'assistant' && message.type === 'text' && typeof message.content === 'string')
        .map(message => (message.content as string)
            .replace(/\[\[[\s\S]*?\]\]/g, '')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean)
        .slice(-4)
        .map(line => line.slice(0, 240));
    return lines.length > 0
        ? `\n### 近期聊天中的说话节奏（只参考，不要复述）\n${lines.map(line => `- ${line}`).join('\n')}\n`
        : '';
};

/**
 * Reuse the same system/history payload as ChatApp for this tiny side-channel.
 * A hand-written `system + task` request looks neat but drops the chat route's
 * recency tail, worldbook depth entries, message formatting and active memory
 * window—the exact pieces that make a character sound like themselves.
 */
const buildTaskChatMessages = async (
    character: CharacterProfile,
    userProfile: UserProfile,
    task: Task,
    completed: boolean,
) => {
    // Use the same adaptive/manual context window as a real ChatApp turn. A
    // fixed "last 120" slice can skip the character's current memory-palace
    // boundary or ignore the user's configured context range, which makes this
    // side-channel drift away from the voice the user hears in chat.
    const history = (await loadCharacterContextRange(character).catch(() => ({ messages: [] }))).messages;
    const [groups, emojis, categories, recentMessagesHint] = await Promise.all([
        DB.getGroups().catch(() => []),
        DB.getEmojis().catch(() => []),
        DB.getEmojiCategories().catch(() => []),
        // ChatApp deliberately keeps a separate recent-200 hint even when the
        // prompt history is narrowed by the adaptive memory-palace boundary.
        // The hint is where the latest relationship turns and speech habits
        // are found; using only `history` here made auto-archived characters
        // sound like an older, generic version of themselves.
        DB.getRecentMessagesByCharId(character.id, 200).catch(() => []),
    ]);
    const recentHint = recentMessagesHint.length > 0 ? recentMessagesHint : history.slice(-200);
    const payload = await buildChatRequestPayload({
        char: character,
        userProfile,
        groups,
        emojis,
        categories,
        historyMsgs: history,
        // ChatApp keeps a recent 200-message hint for worldbook / memory / live
        // context. Keep the same window here instead of reducing the character's
        // available relationship evidence to the last few turns.
        recentMsgsHint: recentHint,
        contextLimit: Math.max(1, history.length),
        recallQueryHint: [task.title, task.note?.trim()].filter(Boolean).join('；'),
        recallEntryPoint: 'direct',
        stripImages: true,
    });
    const voiceContext = buildTaskCharacterVoiceContext(character);
    const recentVoiceCue = buildRecentTaskVoiceCue(recentHint);
    const modeInstruction = completed
        ? '这是用户刚完成待办后的第一反应：先回应这件具体的事，再自然流露出你们关系里的态度、称呼或玩笑。'
        : '这是用户刚记下一项待办时你顺手留下的一句陪伴话：把这件事自然融进你们平时的互动，不要写成应用提醒或客服通知。';
    const taskInstruction = `${voiceContext}${recentVoiceCue}

[当前调用：日历待办角色台词]
${modeInstruction}
角色卡、世界书、用户画像、记忆摘要、记忆宫殿、写作人格和聊天历史优先于任何通用模板；请先读懂这些内容，再用这个角色平时的口吻说话。优先使用角色卡和历史里已经出现过的称呼、口头禅、互动方式或共同细节；如果没有合适细节，就自然、具体地回应这件事，不要为了显得像角色硬塞设定。不要套用固定的提醒、完成确认或客服模板。本调用只留下卡片台词，不执行工具、动作或表情命令，也不要输出任何 [[...]] 命令。开口前回到你自己：这句要像 ${character.name} 平时发给 ${userProfile.name} 的那一句，遮住名字也应该认得出是你。只输出一句自然台词正文，不要解释、分析、字段名、模式名、JSON、标题、角色名前缀或引号。`;
    return [...payload.fullMessages, { role: 'system', content: taskInstruction }];
};

const shortTaskTitle = (task: Task) => {
    const title = task.title.trim().replace(/[“”"']/g, '').replace(/\s+/g, ' ');
    const characters = [...title];
    return characters.length > 18 ? `${characters.slice(0, 18).join('')}…` : title;
};

const buildTaskCommentFallback = (task: Task, completed: boolean) => {
    const title = shortTaskTitle(task) || '这件事';
    if (completed) return `${title}，搞定。先喘口气，别急着把下一件也扛上来。`;
    return `${title}先记在这儿。等你做完了，回来跟我说一声。`;
};

// A response can satisfy the parser and still be the exact generic copy that
// made the card feel robotic ("我替你记着", "辛苦你", "回来告诉我"). Treat
// those as a failed style pass and spend the existing correction request on a
// fresh, role-specific line. This is intentionally narrower than the parser:
// a genuinely in-character sentence is allowed to use one ordinary phrase as
// long as it also has a concrete, character-specific detail.
const isTaskCommentTooGeneric = (value: unknown, task: Task): boolean => {
    const text = extractTaskComment(value);
    if (!text) return true;
    const compact = text.replace(/[\s，。！？；：,.!?;:、]/g, '');
    const title = shortTaskTitle(task).replace(/[\s，。！？；：,.!?;:、]/g, '');
    const templateMarkers = [
        '我替你记着', '先记在这儿', '准备好了就去做', '等你做完了',
        '回来告诉我', '回来跟我说', '辛苦你', '辛苦了', '先歇一会儿',
        '先喘口气', '慢慢来', '任务完成', '完成确认', '应用提醒',
    ];
    const markerHits = templateMarkers.filter(marker => compact.includes(marker)).length;
    const titleEcho = !!title && compact.includes(title);
    // One marker is fine in a longer sentence with no title echo; a short line
    // made mostly from template language is not. Two markers are always a
    // strong signal that the model answered the protocol instead of the task.
    return markerHits >= 2 || (markerHits >= 1 && (titleEcho || compact.length < 34));
};

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
            const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
            const taskMessages = await buildTaskChatMessages(supervisor, userProfile, task, true);
            const taskContext = buildTaskPromptContext(task);
            const firstPrompt = `${taskContext}\n用户 ${userProfile.name} 刚刚完成了这件事。像你在平时聊天里看到这件事后的第一反应一样说话：先回应具体成果，再自然露出你们关系里的态度、称呼、玩笑或关心。台词要短而有画面感，像熟人随口说的一句，不要写成评价报告、应用通知或任务状态确认。建议 20–80 字，必须是完整句子并以终止标点收尾。只输出台词正文，不要任务标题引号、角色名前缀、字段名、JSON、解释。`;
            const correctionPrompt = `上一句虽然可能格式完整，但像通用客服/任务模板，或没有说完；请整句重写，不要只续两个字。${taskContext}\n请再次阅读角色卡、写作人格、你们的关系、记忆和聊天历史，直接说一句只有这个角色才会说的自然反应：像熟人看到这件具体成果后的第一反应，带一个真实的态度、称呼、玩笑或关心，不要空泛地说“辛苦了”“慢慢来”。不要复述待办标题，不要写报告或系统提示。只输出 20–80 字的一句完整台词正文，以终止标点收尾，不要前缀、字段名、JSON、解释或引号。`;
            const requestReward = async (prompt: string) => {
                const response = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model, temperature: 0.85, max_tokens: 320,
                        messages: [...taskMessages, { role: 'user', content: prompt }],
                    }),
                });
                if (!response.ok) throw new Error(`API Error ${response.status}`);
                const data = await safeResponseJson(response);
                return extractTaskComment(data.choices?.[0]?.message?.content);
            };
            let text = await requestReward(firstPrompt);
            if (!isTaskCommentUsable(text) || isTaskCommentTooGeneric(text, task)) text = await requestReward(correctionPrompt);
            if (!isTaskCommentUsable(text)) text = buildTaskCommentFallback(task, true);
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
            // A network/provider failure must not make the permanent line vanish.
            // Keep a complete contextual sentence on the card; a later successful
            // generation can still replace it.
            const latest = (await DB.getAllTasks()).find(item => item.id === task.id);
            if (latest?.isCompleted) {
                const text = buildTaskCommentFallback(task, true);
                const updated: Task = {
                    ...latest,
                    completedSupervisorComment: text,
                    completedSupervisorCommentGeneratedAt: Date.now(),
                };
                await DB.saveTask(updated);
                setTasks(current => current.map(item => item.id === task.id ? updated : item));
                notifyCalendarDataUpdated();
            }
            if (!silent) addToast('待办已完成，角色台词暂时使用了本地完整版本', 'success');
        }
    };
    const generateTaskComment = async (task: Task) => {
        const supervisor = characters.find(char => char.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey || isTaskCommentUsable(task.supervisorComment)) return;
        setCommenting(current => new Set(current).add(task.id));
        try {
            const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
            const taskMessages = await buildTaskChatMessages(supervisor, userProfile, task, false);
            const taskContext = buildTaskPromptContext(task);
            const firstPrompt = `${taskContext}\n这是角色写在待办卡片下方、会一直保留的一句陪伴话。像你在平时聊天里看到用户记下这件事时顺手说的一句，不要写成应用提醒、任务说明或评价报告。把待办自然融进你们的关系和语气里：可以调侃、撒娇、嘴硬、关心或轻微催促，但必须由角色卡和聊天历史决定。建议 20–80 字，完整收尾。只输出台词正文，不要任务标题引号、角色名前缀、字段名、JSON、解释。`;
            const correctionPrompt = `上一句虽然可能格式完整，但像通用客服/提醒模板，或没有说完；请整句重写，不要只续两个字。${taskContext}\n请再次阅读角色卡、写作人格、你们的关系、记忆和聊天历史，直接说一句只有这个角色才会说的自然反应：像熟人看到这项待办时顺手说的一句，带一个真实的态度、称呼、玩笑或关心，不要空泛地说“我替你记着”“回来告诉我”。不要复述待办标题，不要写报告或系统提示，不要套用固定的提醒话术。只输出 20–80 字的一句完整台词正文，以终止标点收尾，不要前缀、字段名、JSON、解释或引号。`;
            const requestComment = async (prompt: string) => {
                const response = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiConfig.apiKey },
                    body: JSON.stringify({
                        model: apiConfig.model, temperature: 0.85, max_tokens: 280,
                        messages: [...taskMessages, { role: 'user', content: prompt }],
                    }),
                });
                if (!response.ok) throw new Error('API Error ' + response.status);
                const data = await safeResponseJson(response);
                return extractTaskComment(data.choices?.[0]?.message?.content);
            };
            let text = await requestComment(firstPrompt);
            if (!isTaskCommentUsable(text) || isTaskCommentTooGeneric(text, task)) text = await requestComment(correctionPrompt);
            if (!isTaskCommentUsable(text)) text = buildTaskCommentFallback(task, false);
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
            const latest = (await DB.getAllTasks()).find(item => item.id === task.id);
            if (latest) {
                const updated = {
                    ...latest,
                    supervisorComment: buildTaskCommentFallback(task, false),
                    supervisorCommentGeneratedAt: Date.now(),
                };
                await DB.saveTask(updated);
                setTasks(current => current.map(item => item.id === task.id ? updated : item));
                notifyCalendarDataUpdated();
            }
        } finally {
            setCommenting(current => { const next = new Set(current); next.delete(task.id); return next; });
        }
    };
    useEffect(() => {
        // Wait until OSContext has finished loading custom characters. Otherwise
        // a legacy task can be read before its supervisor exists in `characters`
        // and never get another chance to repair its bad metadata comment.
        if (!apiConfig.apiKey || characters.length === 0 || tasks.length === 0) return;
        tasks.filter(task => task.supervisorComment
            && (!isTaskCommentUsable(task.supervisorComment) || isTaskCommentTooGeneric(task.supervisorComment, task))).slice(0, 4).forEach(task => {
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
        tasks.filter(task => task.isCompleted && task.completedSupervisorComment
            && (!isTaskCommentUsable(task.completedSupervisorComment) || isTaskCommentTooGeneric(task.completedSupervisorComment, task))).slice(0, 4).forEach(task => {
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
        const displayedCommentBody = task.isCompleted
            ? extractTaskComment(task.completedSupervisorComment) || extractTaskComment(task.supervisorComment)
            : extractTaskComment(task.supervisorComment);
        const displayedComment = formatTaskComment(supervisor?.name, displayedCommentBody);
        return <div key={task.id} className="group flex items-start gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
            <button onClick={() => toggleTask(task)} disabled={processing.has(task.id)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${task.isCompleted ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-violet-300 bg-white'}`} aria-label={task.isCompleted ? '恢复待办' : '完成待办'}>{processing.has(task.id) ? '…' : task.isCompleted ? '✓' : ''}</button>
            <div className="min-w-0 flex-1"><div className={`text-sm font-semibold text-slate-700 ${task.isCompleted ? 'line-through opacity-45' : ''}`}>{task.title}</div>
                {(displayedComment || commenting.has(task.id)) && <div className="mt-1 break-words text-[11px] leading-relaxed italic text-violet-400">{displayedComment || `${supervisor?.name || '角色'}：TA 正在想一句话…`}</div>}
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
