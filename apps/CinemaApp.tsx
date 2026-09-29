/**
 * 影院 —— 电脑上放视频，手机里的角色同步看画面、陪你聊。
 *
 * 三个页面：首页（开一场 / 最近看过）· 配对电脑 · 放映室。
 * 每句话照通话的做法存进私聊消息库（说一句进一句，私聊界面不显示）；点「散场」落一张卡片。
 * 电脑那边是 public/watch.html（观影端），两边经用户自己的 amsg Worker 中转
 * （worker/amsg/src/watchRoom.ts）。逻辑见 utils/cinema/，方案见工作区「交接说明-一起看.md」。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowsClockwise, Copy, Eye, FilmSlate, Microphone, Monitor, PaperPlaneRight, SpeakerHigh, SpeakerSlash, Trash } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { CharacterProfile } from '../types';
import { DB } from '../utils/db';
import { endAmsgChatPresence, markAmsgStateDirty, startAmsgChatPresence, stopAmsgChatPresence } from '../utils/amsgStateSync';
import { runCallMemoryPalacePostFlow } from '../utils/memoryPalace/callPostFlow';
import { endCinemaPresence, getActiveCinemaPresence, touchCinemaPresence } from '../utils/cinema/cinemaPresence';
import { getActiveDatePresence } from '../utils/datePresence';
import {
    appendCinemaNote, appendSubtitleLines, buildCinemaEndCardText, estimateVideoTime, pickSubtitleWindow, sanitizeExternalSubtitles, CINEMA_END_SOURCE, cinemaLineText, cinemaMessageMetadata, decideProactive,
    NOTE_GAP_MS, PROACTIVE_LEVELS, toCinemaLines,
    type CinemaNote, type CinemaProactiveLevel, type CinemaSubtitleLine, type ExternalSubtitles, type ProactiveReason,
    describeStatus, describeWork, formatVideoTime, isFrameFresh, mergeCinemaStatus, newCinemaSession, sessionRemembers, workerHostForDisplay,
    type CinemaChatLine, type CinemaFrame, type CinemaMeetMode, type CinemaPairing, type CinemaSession, type CinemaSpoilerMode, type CinemaStatus,
} from '../utils/cinema/cinema';
import { backfillSessionToChat, removeSessionFromChat } from '../utils/cinema/cinemaDb';
import { clearCinemaPairing, deleteCinemaSession, getCinemaPairing, listCinemaSessions, saveCinemaPairing, saveCinemaSession } from '../utils/cinema/cinemaDb';
import { createWatchRoom, WatchRoomSocket, type WatchConnState, type WatchMessage } from '../utils/cinema/watchRoomClient';
import { askCharacterInCinema, warmCinemaContext } from '../utils/cinema/askCinema';
import { buildVoiceActingGuide } from '../utils/chatPrompts';
import { stripTtsMarkupForDisplay } from '../utils/ttsRouter';
import { canCinemaSpeak, createCinemaSpeaker, spokenTextOf, type CinemaSpeaker } from '../utils/cinema/cinemaVoice';
import { isSttSupported, prepareSiliconFlowAudioCapture, startStt, type SttSession } from '../utils/speechToText';
import { describeFrame, nextNoteModel, NOTE_MODEL_LABEL, noteModelCandidates, NoteVisionUnsupportedError, type NoteModel } from '../utils/cinema/sceneNotes';
import './cinema/cinema.css';

type View = 'home' | 'pair' | 'room';

/** 主动开口的频率记在本机（每个人习惯不同，不跟着备份走也无所谓）。 */
const PROACTIVE_LEVEL_KEY = 'cinema_proactive_level';
/** 角色的话要不要念出来，也记在本机。 */
const VOICE_ON_KEY = 'cinema_voice_on';

/** 这么近收到的画面算「就是现在」，发消息时不用再向电脑要一帧。 */
const RECENT_FRAME_MS = 6000;

/** 电脑上要打开的观影端地址：跟 Sully 同一个站点下的 watch.html。 */
const watchPageUrl = () => {
    try { return new URL('watch.html', document.baseURI).href; } catch { return 'watch.html'; }
};

const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
};

const CinemaApp: React.FC = () => {
    const { closeApp, characters, apiConfig, userProfile, groups, realtimeConfig, memoryPalaceConfig, updateCharacter, addToast, registerBackHandler } = useOS();
    const [view, setView] = useState<View>('home');
    const [pairing, setPairing] = useState<CinemaPairing | null>(null);
    const [sessions, setSessions] = useState<CinemaSession[]>([]);
    const [loaded, setLoaded] = useState(false);

    // 开一场
    const [charId, setCharId] = useState<string>('');
    const [title, setTitle] = useState('');
    const [episode, setEpisode] = useState('');
    const [spoiler, setSpoiler] = useState<CinemaSpoilerMode>('first');
    // 线上 / 线下：用户手动选过就听用户的，没选过就看这个角色此刻在不在见面里
    const [meetChoice, setMeetChoice] = useState<CinemaMeetMode | null>(null);
    // 这一场记不记：记住 = 说一句进一句、散场整理记忆；不留痕 = 只留在影院里
    const [remember, setRemember] = useState(true);

    // 放映室
    const [session, setSession] = useState<CinemaSession | null>(null);
    const [conn, setConn] = useState<WatchConnState>('closed');
    const [screenOnline, setScreenOnline] = useState(false);
    const [frame, setFrame] = useState<CinemaFrame | null>(null);
    const [status, setStatus] = useState<CinemaStatus | null>(null);
    const [draft, setDraft] = useState('');
    const [withFrame, setWithFrame] = useState(true);
    const [thinking, setThinking] = useState(false);
    const [pairBusy, setPairBusy] = useState(false);
    const [ending, setEnding] = useState(false);

    const socketRef = useRef<WatchRoomSocket | null>(null);
    const frameWaiters = useRef(new Map<string, (f: CinemaFrame) => void>());
    const frameRef = useRef<CinemaFrame | null>(null);
    const statusRef = useRef<CinemaStatus | null>(null);
    // 观影端（画面）和油猴小插件（进度 / 暂停）各报各的，合成后才是 status
    const screenStatusRef = useRef<CinemaStatus | null>(null);
    const playerStatusRef = useRef<CinemaStatus | null>(null);
    const sessionRef = useRef<CinemaSession | null>(null);
    const progressSavedAt = useRef(0);
    /** 最近几次换场景帧的时间：画面在动就不信旧的「暂停」（mergeCinemaStatus） */
    const sceneTimesRef = useRef<number[]>([]);
    /** 小插件读到的 B站 字幕（最近 20 句），萧逸开口时带上最近几句 */
    const subtitleLinesRef = useRef<CinemaSubtitleLine[]>([]);
    /** 观影端第 5 块选的外挂字幕（电脑那边存着，手机进放映室时会再发一份） */
    const externalSubsRef = useRef<ExternalSubtitles | null>(null);
    const [externalSubsName, setExternalSubsName] = useState('');
    const listRef = useRef<HTMLDivElement>(null);

    const reload = useCallback(async () => {
        const [p, s] = await Promise.all([getCinemaPairing().catch(() => undefined), listCinemaSessions().catch(() => [])]);
        setPairing(p || null);
        setSessions(s);
        setLoaded(true);
    }, []);
    useEffect(() => { void reload(); }, [reload]);
    useEffect(() => {
        if (!charId && characters.length) setCharId(characters[0].id);
    }, [characters, charId]);

    // ---- 放映室连接：配对页和放映室都要连（配对页靠它知道电脑连上没有）----
    const handleMessage = useCallback((msg: WatchMessage) => {
        if (msg.type === 'presence') {
            setScreenOnline(Number(msg.screen) > 0);
        } else if (msg.type === 'frame' && typeof msg.dataUrl === 'string') {
            const f: CinemaFrame = {
                dataUrl: msg.dataUrl, at: Date.now(), reason: String(msg.reason || ''),
                videoTime: typeof msg.videoTime === 'number' ? msg.videoTime : undefined,
                requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
            };
            frameRef.current = f;
            setFrame(f);
            setScreenOnline(true);
            // 自己换镜头发来的帧（不是手机要的）：记一次换场景，顺便让助理写笔记
            if (!f.requestId) onFrameRef.current(f);
            if (f.requestId) {
                const waiter = frameWaiters.current.get(f.requestId);
                if (waiter) { frameWaiters.current.delete(f.requestId); waiter(f); }
            }
        } else if (msg.type === 'subtitle-file') {
            externalSubsRef.current = sanitizeExternalSubtitles(msg as any);
            setExternalSubsName(externalSubsRef.current?.name || '');
        } else if (msg.type === 'subtitle-offset') {
            if (externalSubsRef.current && typeof msg.offsetMs === 'number') {
                externalSubsRef.current = { ...externalSubsRef.current, offsetMs: msg.offsetMs };
            }
        } else if (msg.type === 'status' || msg.type === 'player') {
            const isPlayer = msg.type === 'player';
            const s: CinemaStatus = {
                mode: isPlayer ? 'site' : msg.mode === 'local' || msg.mode === 'share' ? msg.mode : undefined,
                site: typeof msg.site === 'string' ? msg.site : undefined,
                title: typeof msg.title === 'string' ? msg.title : undefined,
                time: typeof msg.time === 'number' ? msg.time : undefined,
                duration: typeof msg.duration === 'number' ? msg.duration : undefined,
                paused: typeof msg.paused === 'boolean' ? msg.paused : undefined,
                subtitle: typeof msg.subtitle === 'string' ? msg.subtitle : undefined,
                sharing: typeof msg.sharing === 'boolean' ? msg.sharing : undefined,
                // 小插件的状态以 Worker 收到的时刻为准：刚连上时补发的可能是几小时前的
                at: isPlayer && typeof msg.at === 'number' ? msg.at : Date.now(),
            };
            if (isPlayer) playerStatusRef.current = s; else screenStatusRef.current = s;
            refreshStatus();
            if (!isPlayer) setScreenOnline(true);
            if (isPlayer) rememberProgress(s);
            if (isPlayer) subtitleLinesRef.current = appendSubtitleLines(subtitleLinesRef.current, msg.subtitles);
        }
    }, []);

    const refreshStatus = () => {
        const merged = mergeCinemaStatus(screenStatusRef.current, playerStatusRef.current, Date.now(), sceneTimesRef.current);
        statusRef.current = merged;
        setStatus(merged);
    };

    /**
     * 记住看到哪：小插件报来的进度，暂停 / 看完时马上存，平时一分钟最多存一次。
     * 以后打开这一场，「最近看过」里就写着看到几分几秒。
     */
    const rememberProgress = (s: CinemaStatus) => {
        const current = sessionRef.current;
        if (!current || typeof s.time !== 'number' || Date.now() - s.at > 60_000) return;
        const urgent = s.paused === true;
        if (!urgent && Date.now() - progressSavedAt.current < 60_000) return;
        progressSavedAt.current = Date.now();
        const next = { ...current, lastVideoTime: s.time };
        sessionRef.current = next;
        setSession(next);
        void saveCinemaSession(next).catch(error => console.warn('[cinema] 存进度失败', error));
    };

    // 同一场里 sessionRef 永远比 state 新（updateSession 先改它），这里只在换了一场时跟上，
    // 免得晚到的渲染把刚写进去的笔记 / 对话用旧快照盖回去
    useEffect(() => {
        if (sessionRef.current?.id !== session?.id) sessionRef.current = session;
    }, [session]);
    // 小插件停了（关了标签页）要能看出来：定时按新鲜度重算一次
    useEffect(() => {
        if (view !== 'room') return;
        const timer = setInterval(refreshStatus, 10_000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    const needSocket = (view === 'pair' || view === 'room') && !!pairing;
    useEffect(() => {
        if (!needSocket || !pairing) return;
        const socket = new WatchRoomSocket(pairing, {
            onMessage: handleMessage,
            onState: (state) => { setConn(state); if (state !== 'open') setScreenOnline(false); },
        });
        socketRef.current = socket;
        socket.start();
        return () => { socket.stop(); socketRef.current = null; setConn('closed'); setScreenOnline(false); };
    }, [needSocket, pairing, handleMessage]);

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }, [session?.lines.length, thinking]);

    useEffect(() => registerBackHandler(() => {
        if (view !== 'home') { setView('home'); void reload(); return true; }
        return false;
    }), [registerBackHandler, view, reload]);

    // ---- 配对 ----
    const startPairing = async () => {
        setPairBusy(true);
        try {
            const next = await createWatchRoom();
            await saveCinemaPairing(next);
            setPairing(next);
            setView('pair');
        } catch (error: any) {
            addToast(error?.message || String(error), 'error');
        } finally {
            setPairBusy(false);
        }
    };

    const forgetPairing = async () => {
        if (!window.confirm('解除配对？电脑那边要重新输入配对码才能再连上。')) return;
        await clearCinemaPairing();
        setPairing(null);
    };

    // ---- 开场 ----
    const char: CharacterProfile | undefined = useMemo(
        () => characters.find(c => c.id === (session?.charId || charId)),
        [characters, session?.charId, charId],
    );

    // 进放映室就开始准备角色的上下文（人设、记忆、最近聊天），第一句话不用等
    const sessionId = session?.id;
    useEffect(() => {
        if (view === 'room' && char && sessionId) warmCinemaContext({ char, userProfile, groups, realtimeConfig, sessionId });
    }, [view, char, sessionId, userProfile, groups, realtimeConfig]);

    // 在放映室里 = 正在一起看：本地主动消息据此静默（cinemaPresence），云端主动消息
    // 靠跟通话同一份「用户在前台」租约知道你正在跟 ta 在一起。离开放映室只停租约、不散场。
    const charIdInRoom = view === 'room' ? char?.id : undefined;
    useEffect(() => {
        if (!charIdInRoom || !session) return;
        touchCinemaPresence(charIdInRoom, session);
        void startAmsgChatPresence(charIdInRoom, null);
        return () => stopAmsgChatPresence(charIdInRoom);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [charIdInRoom, sessionId]);

    const openSession = (s: CinemaSession) => {
        // 散过场的再点进来就是接着看
        if (s.endedAt) { s = { ...s, endedAt: undefined }; void saveCinemaSession(s); }
        sessionRef.current = s;
        setSession(s);
        setFrame(null); frameRef.current = null;
        setStatus(null); statusRef.current = null;
        screenStatusRef.current = null; playerStatusRef.current = null;
        progressSavedAt.current = 0;
        // 主动开口的计时从进场这一刻算，免得一进来就开口
        lastUserAtRef.current = Date.now();
        lastCharAtRef.current = Date.now();
        scenesSinceCharRef.current = 0;
        pauseRef.current = { since: undefined, handled: false };
        noteBusyRef.current = false;
        lastNoteAtRef.current = 0;
        noteModelRef.current = undefined;
        noteFailRef.current = 0;
        sceneTimesRef.current = [];
        subtitleLinesRef.current = [];
        setLastNote(null);
        getSpeaker().unlock();
        setView('room');
    };

    /** 这个角色此刻正在见面里的那次见面（见面暂停中不算）。 */
    const activeEncounterFor = (id: string) => {
        const c = characters.find(x => x.id === id);
        const presence = getActiveDatePresence(id) || c?.activeDateEncounter;
        return presence?.status === 'active' ? presence : null;
    };
    const meetingNow = charId ? activeEncounterFor(charId) : null;
    const meet: CinemaMeetMode = meetChoice || (meetingNow ? 'offline' : 'online');

    const startSession = async () => {
        if (!pairing) { addToast('先配对电脑', 'info'); return; }
        if (!charId) { addToast('选一个一起看的人', 'info'); return; }
        if (!title.trim()) { addToast('填一下看什么', 'info'); return; }
        const encounter = meet === 'offline' ? activeEncounterFor(charId) : null;
        const s = newCinemaSession({ charId, title, episode, spoiler, meet, dateEncounterId: encounter?.encounterId, remember });
        await saveCinemaSession(s);
        openSession(s);
    };

    const removeSession = async (s: CinemaSession) => {
        if (!window.confirm(`删掉这一场的记录？\n${describeWork(s)}`)) return;
        await deleteCinemaSession(s.id);
        void reload();
    };

    // ---- 放映室里说话 ----
    const requestFrame = (timeoutMs = 2500): Promise<CinemaFrame | null> => {
        const socket = socketRef.current;
        const requestId = Math.random().toString(36).slice(2, 10);
        if (!socket || !socket.send({ type: 'capture-request', requestId })) return Promise.resolve(null);
        return new Promise(resolve => {
            const timer = setTimeout(() => { frameWaiters.current.delete(requestId); resolve(null); }, timeoutMs);
            frameWaiters.current.set(requestId, (f) => { clearTimeout(timer); resolve(f); });
        });
    };

    /**
     * 改这一场的记录：永远从最新的那份（sessionRef）改起再存。
     * 助理笔记、进度、对话都会在后台各自往里写，从旧快照改会把别人刚写的覆盖掉。
     */
    const updateSession = async (fn: (s: CinemaSession) => CinemaSession): Promise<CinemaSession | null> => {
        const cur = sessionRef.current;
        if (!cur) return null;
        const next = fn(cur);
        sessionRef.current = next;
        setSession(next);
        try { await saveCinemaSession(next); } catch (error) { console.warn('[cinema] 保存失败', error); }
        return next;
    };

    const busyRef = useRef(false);
    const lastUserAtRef = useRef(0);
    const lastCharAtRef = useRef(0);
    const scenesSinceCharRef = useRef(0);

    /**
     * 请角色说一句。两种来路：用户发了消息（userText），或者到了主动开口的时机（proactive）。
     * 主动开口时角色可以选择「[安静]」，那就什么都不显示。
     */
    const speak = async (opts: { userText?: string; proactive?: ProactiveReason }) => {
        if (!sessionRef.current || !char || busyRef.current) return;
        busyRef.current = true;
        const videoTime = statusRef.current?.time;
        let userLines: CinemaChatLine[] = [];
        if (opts.userText) {
            const sentAt = Date.now();
            // 「（靠在你肩上）好困」→ 一行旁白 + 一个气泡
            userLines = toCinemaLines('user', [opts.userText], sentAt, videoTime);
            const saved = await updateSession(s => ({
                ...s, lines: [...s.lines, ...userLines], updatedAt: sentAt,
                lastVideoTime: videoTime ?? s.lastVideoTime,
            }));
            lastUserAtRef.current = sentAt;
            // 说一句进一句：存进私聊消息库（界面不显示），角色在私聊里也知道你们正在一起看
            if (saved) for (const line of userLines) await saveLineToChat(char.id, saved, 'user', cinemaLineText(line), videoTime);
            if (saved) touchCinemaPresence(char.id, saved);
            void startAmsgChatPresence(char.id, sentAt);
        }
        setThinking(true);
        try {
            let frameUrl = '';
            // 用户发消息时看「带不带画面」开关；主动开口永远看一眼（用户 09-30 选的）
            if (opts.proactive || withFrame) {
                // 几秒内刚收到过画面就直接用，不再等电脑截新的
                const recent = frameRef.current && Date.now() - frameRef.current.at < RECENT_FRAME_MS ? frameRef.current : null;
                const fresh = recent || await requestFrame(1500);
                const use = fresh || (isFrameFresh(frameRef.current) ? frameRef.current : null);
                frameUrl = use?.dataUrl || '';
            }
            // 有外挂字幕、又读得到进度：用它挑「这一句 + 最近几句」，比 B站 AI 字幕准；否则用 B站 读到的
            const external = externalSubsRef.current;
            const videoNow = estimateVideoTime(statusRef.current);
            const picked = external && videoNow !== undefined ? pickSubtitleWindow(external, videoNow) : null;
            const statusForPrompt = picked && statusRef.current ? { ...statusRef.current, subtitle: picked.current || '' } : statusRef.current;
            const result = await askCharacterInCinema({
                char, userProfile, groups, apiConfig, realtimeConfig,
                session: sessionRef.current!, status: statusForPrompt, frameDataUrl: frameUrl,
                proactive: opts.proactive,
                recentSubtitles: picked ? picked.recent : subtitleLinesRef.current,
                // 开着出声才教他写停顿和语气声；只打字的时候别让这些标记混进来
                voiceGuide: voiceOnRef.current && canCinemaSpeak(char, apiConfig) ? buildVoiceActingGuide(char) : undefined,
            });
            if (frameUrl && !result.sawFrame && !opts.proactive) addToast('当前模型不支持看图，这一轮只发了文字', 'info');
            // 不管说没说话，这次机会都算用掉了，免得下一秒又叫一次
            lastCharAtRef.current = Date.now();
            scenesSinceCharRef.current = 0;
            if (!result.lines.length) return; // 主动开口时选择了安静
            const marked = userLines[userLines.length - 1];
            const now = Date.now();
            // 原话（带 <#0.3#>、(laughs) 这些配音标记）拿去念；屏幕上、聊天记录里只放干净的字
            const spokenReplies: CinemaChatLine[] = toCinemaLines('char', result.lines, now);
            const replies: CinemaChatLine[] = spokenReplies
                .map(r => (r.kind === 'action' ? r : { ...r, text: stripTtsMarkupForDisplay(r.text, apiConfig) }))
                .filter(r => r.text.trim());
            const saved = await updateSession(s => ({
                ...s,
                // 「附画面」标在这一轮用户最后一句上
                lines: [...s.lines.map(l => (frameUrl && result.sawFrame && l === marked ? { ...l, withFrame: true } : l)), ...replies],
                updatedAt: now,
            }));
            if (saved) for (const reply of replies) await saveLineToChat(char.id, saved, 'assistant', cinemaLineText(reply), videoTime);
            sayAloud(spokenReplies);
            if (saved && opts.proactive) touchCinemaPresence(char.id, saved);
            // 跟通话一样每轮打脏：云端主动消息那份上下文也跟着知道你们在一起看
            markAmsgStateDirty({ char, userProfile, groups, realtimeConfig });
        } catch (error: any) {
            // 主动开口失败不打扰用户（下一次时机再试），用户发的消息失败要说
            if (opts.proactive) console.warn('[cinema] 主动开口失败', error);
            else addToast(`${char.name} 没回上：${error?.message || error}`, 'error');
        } finally {
            busyRef.current = false;
            setThinking(false);
        }
    };

    const send = () => {
        const text = draft.trim();
        // busyRef 比 thinking 早一拍：角色刚开始主动开口、界面还没刷新时，别把这句清掉又丢了
        if (!text || !session || !char || thinking || busyRef.current) return;
        setDraft('');
        getSpeaker().unlock();
        void speak({ userText: text });
    };

    // ---- 助理笔记 + 主动开口（交接说明-一起看.md 第九节）----
    const [level, setLevel] = useState<CinemaProactiveLevel>(() => {
        try {
            const saved = localStorage.getItem(PROACTIVE_LEVEL_KEY) as CinemaProactiveLevel | null;
            return saved && PROACTIVE_LEVELS.some(l => l.id === saved) ? saved : 'normal';
        } catch { return 'normal'; }
    });
    const changeLevel = (next: CinemaProactiveLevel) => {
        setLevel(next);
        try { localStorage.setItem(PROACTIVE_LEVEL_KEY, next); } catch { /* ignore */ }
    };
    const [lastNote, setLastNote] = useState<CinemaNote | null>(null);
    const levelRef = useRef(level); levelRef.current = level;
    const draftRef = useRef(draft); draftRef.current = draft;
    const viewRef = useRef(view); viewRef.current = view;
    const onlineRef = useRef(false); onlineRef.current = conn === 'open' && screenOnline;
    const speakRef = useRef(speak); speakRef.current = speak;
    const pauseRef = useRef<{ since?: number; handled: boolean }>({ since: undefined, handled: false });
    const noteBusyRef = useRef(false);
    const lastNoteAtRef = useRef(0);
    /** undefined = 还没挑；null = 没有能用的 */
    const noteModelRef = useRef<NoteModel | null | undefined>(undefined);

    const writeNote = async (f: CinemaFrame) => {
        if (viewRef.current !== 'room' || !sessionRef.current || noteBusyRef.current) return;
        if (statusRef.current?.paused) return;
        if (Date.now() - lastNoteAtRef.current < NOTE_GAP_MS[levelRef.current]) return;
        const candidates = noteModelCandidates(apiConfig, memoryPalaceConfig?.lightLLM);
        if (noteModelRef.current === undefined) noteModelRef.current = candidates[0] || null;
        const model = noteModelRef.current;
        if (!model) return;
        noteBusyRef.current = true;
        lastNoteAtRef.current = Date.now();
        try {
            const text = await describeFrame(model, f.dataUrl, char?.name);
            const note: CinemaNote = { at: Date.now(), videoTime: f.videoTime ?? statusRef.current?.time, text };
            setLastNote(note);
            await updateSession(s => ({ ...s, notes: appendCinemaNote(s.notes, note) }));
        } catch (error) {
            if (error instanceof NoteVisionUnsupportedError) {
                const next = nextNoteModel(candidates, model);
                noteModelRef.current = next;
                lastNoteAtRef.current = 0;
                addToast(next
                    ? `${NOTE_MODEL_LABEL[model.source]}不会看图，画面笔记改用${NOTE_MODEL_LABEL[next.source]}`
                    : '没有会看图的模型，画面笔记先关掉了', 'info');
            } else {
                // 09-30 实测「没有笔记」：以前失败了只写日志，用户看不见。现在第一次失败就把原话报出来；
                // 同一个模型连着失败两次（有的接口不认图片但报错不说「图片」），换下一个模型试
                console.warn('[cinema] 画面笔记失败', error);
                noteFailRef.current += 1;
                const message = (error as any)?.message || String(error);
                const next = noteFailRef.current >= 2 ? nextNoteModel(candidates, model) : null;
                if (next) {
                    noteModelRef.current = next;
                    noteFailRef.current = 0;
                    lastNoteAtRef.current = 0;
                    addToast(`画面笔记用${NOTE_MODEL_LABEL[model.source]}连续失败，改用${NOTE_MODEL_LABEL[next.source]}。报错：${message}`, 'info');
                } else if (noteFailRef.current === 1) {
                    addToast(`画面笔记没写成（${NOTE_MODEL_LABEL[model.source]}）：${message}`, 'error');
                }
            }
        } finally {
            noteBusyRef.current = false;
        }
    };
    const noteFailRef = useRef(0);
    const onFrameRef = useRef<(f: CinemaFrame) => void>(() => {});
    onFrameRef.current = (f) => {
        if (f.reason === 'scene') {
            scenesSinceCharRef.current += 1;
            sceneTimesRef.current = [...sceneTimesRef.current, Date.now()].slice(-10);
            refreshStatus(); // 画面在动 → 旧的「暂停」可能要作废
        }
        if (f.reason === 'scene' || f.reason === 'tick') void writeNote(f);
    };

    // 暂停了多久：每次暂停只给角色一次「问一句」的机会
    const paused = !!status?.paused;
    useEffect(() => {
        if (paused && pauseRef.current.since === undefined) pauseRef.current = { since: Date.now(), handled: false };
        if (!paused && pauseRef.current.since !== undefined) pauseRef.current = { since: undefined, handled: false };
    }, [paused]);

    // 每 10 秒看一眼该不该主动开口（纯规则，不花钱；真开口了角色还能选择安静）
    useEffect(() => {
        if (view !== 'room') return;
        const timer = setInterval(() => {
            const reason = decideProactive({
                level: levelRef.current,
                now: Date.now(),
                lastUserAt: lastUserAtRef.current,
                lastCharAt: lastCharAtRef.current,
                scenesSinceChar: scenesSinceCharRef.current,
                paused: !!statusRef.current?.paused,
                pausedSince: pauseRef.current.since,
                pauseHandled: pauseRef.current.handled,
                blocked: busyRef.current || listeningRef.current || !!draftRef.current.trim() || !onlineRef.current || document.visibilityState !== 'visible',
            });
            if (!reason) return;
            if (reason === 'pause') pauseRef.current = { ...pauseRef.current, handled: true };
            void speakRef.current({ proactive: reason });
        }, 10_000);
        return () => clearInterval(timer);
    }, [view]);

    // ---- 语音：说话（听写）+ 角色出声（配音）----
    const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem(VOICE_ON_KEY) !== '0'; } catch { return true; } });
    const voiceOnRef = useRef(voiceOn); voiceOnRef.current = voiceOn;
    const [listening, setListening] = useState(false);
    const [sttBusy, setSttBusy] = useState(false);
    const listeningRef = useRef(false);
    const sttSessionRef = useRef<SttSession | null>(null);
    const sttTokenRef = useRef(0);
    const speakerRef = useRef<CinemaSpeaker | null>(null);
    /** 角色每一轮第一句气泡的时间 → 那一轮的语音，点气泡可以重听 */
    const lineAudioRef = useRef(new Map<number, string>());
    const speechProvider = apiConfig.speechRecognitionProvider || 'system';
    const canSpeak = canCinemaSpeak(char, apiConfig);

    const getSpeaker = () => {
        if (!speakerRef.current) {
            speakerRef.current = createCinemaSpeaker(message => console.warn('[cinema] 配音失败', message));
        }
        return speakerRef.current;
    };
    const toggleVoice = () => {
        const next = !voiceOn;
        setVoiceOn(next);
        try { localStorage.setItem(VOICE_ON_KEY, next ? '1' : '0'); } catch { /* ignore */ }
        if (next) getSpeaker().unlock(); else getSpeaker().stop();
    };

    /** 角色这一轮说的话念出来（开着「出声」、没在听你说话的时候）。旁白不念。 */
    const sayAloud = (replies: CinemaChatLine[]) => {
        if (!char || !voiceOnRef.current || listeningRef.current || !canCinemaSpeak(char, apiConfig)) return;
        const text = spokenTextOf(replies);
        const first = replies.find(r => r.kind !== 'action');
        if (!text || !first) return;
        void getSpeaker().say(text, char, apiConfig).then(url => { if (url) lineAudioRef.current.set(first.at, url); });
    };

    const stopListening = () => {
        sttTokenRef.current += 1;
        try { sttSessionRef.current?.stop(); } catch { /* ignore */ }
        sttSessionRef.current = null;
        listeningRef.current = false;
        setListening(false);
        setSttBusy(false);
    };

    /**
     * 点一下开始说话，再点一下（或者说完停顿）结束，听到的话自动发出去。
     * 开麦时角色先闭嘴：手机喇叭的声音会被自己录进去。电脑那边的片子声音也可能被录进去，戴耳机最好。
     */
    const toggleMic = async () => {
        if (listening) {
            // 让这次录音正常结束，听到的话还会发出去（token 不作废）
            try { sttSessionRef.current?.stop(); } catch { /* ignore */ }
            return;
        }
        if (!isSttSupported(speechProvider)) { addToast('这个环境不支持语音输入', 'info'); return; }
        getSpeaker().stop();
        const token = ++sttTokenRef.current;
        let heard = '';
        try {
            if (speechProvider !== 'system') prepareSiliconFlowAudioCapture();
            listeningRef.current = true;
            setListening(true);
            setSttBusy(false);
            const sttSession = await startStt('zh-CN', {
                onPartial: t => { if (sttTokenRef.current === token) { heard = t; setDraft(t); } },
                onFinal: t => { if (sttTokenRef.current === token) { heard = t; setDraft(t); } },
                onError: m => { if (sttTokenRef.current === token && m) addToast(m, 'info'); },
                onProviderFallback: m => { if (sttTokenRef.current === token) addToast(m, 'info'); },
                onRecordingEnd: () => {
                    if (sttTokenRef.current !== token) return;
                    listeningRef.current = false;
                    setListening(false);
                    setSttBusy(speechProvider !== 'system');
                },
                onEnd: () => {
                    if (sttTokenRef.current !== token) return;
                    listeningRef.current = false;
                    sttSessionRef.current = null;
                    setListening(false);
                    setSttBusy(false);
                    const text = heard.trim();
                    // 角色正在回的话先留在输入框里，等他说完你再点发送
                    if (text && !busyRef.current) {
                        setDraft('');
                        void speak({ userText: text });
                    }
                },
            }, {
                provider: speechProvider,
                apiKey: apiConfig.siliconFlowSpeechApiKey,
                stripEmoji: apiConfig.speechRecognitionStripEmoji !== false,
                fallbackToSenseVoice: true,
            });
            if (sttTokenRef.current !== token) { sttSession.stop(); return; }
            sttSessionRef.current = sttSession;
        } catch (error: any) {
            if (sttTokenRef.current !== token) return;
            stopListening();
            addToast(error?.message || '无法启动语音输入', 'error');
        }
    };

    // 离开放映室：闭嘴、关麦
    useEffect(() => {
        if (view === 'room') return;
        speakerRef.current?.stop();
        if (listeningRef.current) stopListening();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);
    useEffect(() => () => {
        speakerRef.current?.dispose();
        try { sttSessionRef.current?.stop(); } catch { /* ignore */ }
    }, []);

    const saveLineToChat = async (charId: string, s: CinemaSession, role: 'user' | 'assistant', content: string, videoTime?: number) => {
        if (!sessionRemembers(s)) return; // 不留痕：只留在影院自己的记录里
        try {
            await DB.saveMessage({ charId, role, type: 'text', content, metadata: cinemaMessageMetadata(s, videoTime) });
        } catch (error) {
            console.warn('[cinema] 存进私聊失败（放映室里照常）', error);
        }
    };

    /**
     * 这一场记不记，放映室里随时能改：
     *   记住 → 不留痕：把已经存进私聊的话（和散场卡）删掉，云端那份上下文作废
     *   不留痕 → 记住：把这一场到目前为止的话按原来的时间补存进去
     */
    const toggleRemember = async () => {
        const cur = sessionRef.current;
        if (!cur || !char) return;
        const next = !sessionRemembers(cur);
        if (!next && !window.confirm(`改成「不留痕」？\n这一场已经说过的话会从 ${char.name} 的聊天记录里删掉，之后说的也不再存；散场时不留卡片、不整理记忆。\n（如果之前已经散过场、整理进了记忆宫殿，那部分删不掉，要去记忆宫殿里手动删。）`)) return;
        try {
            if (next) {
                const count = await backfillSessionToChat(char.id, cur);
                markAmsgStateDirty({ char, userProfile, groups, realtimeConfig });
                addToast(`改成「记住」了，补存了 ${count} 句进聊天记录`, 'success');
            } else {
                const count = await removeSessionFromChat(char.id, cur.id);
                markAmsgStateDirty({ char, userProfile, groups, realtimeConfig }, 'invalidate');
                addToast(`改成「不留痕」了${count ? `，从聊天记录里删掉了 ${count} 条` : ''}`, 'success');
            }
            await updateSession(s => ({ ...s, remember: next }));
        } catch (error: any) {
            addToast(`没改成：${error?.message || error}`, 'error');
        }
    };

    /** 散场：记住的话落一张卡片进私聊、跟通话挂断一样整理记忆；不留痕就只收场。 */
    const endScreening = async () => {
        if (!session || !char || ending) return;
        const keeps = sessionRemembers(sessionRef.current || session);
        if (!window.confirm(keeps
            ? `散场？\n${char.name} 会记得今天一起看了${describeWork(session)}。之后还可以从「最近看过」点进来接着看。`
            : `散场？\n这一场是「不留痕」，${char.name} 在私聊里不会知道你们看过。之后还可以从「最近看过」点进来接着看。`)) return;
        setEnding(true);
        try {
            const endedAt = Date.now();
            const done: CinemaSession = (await updateSession(s => ({ ...s, endedAt, updatedAt: endedAt })))
                || { ...session, endedAt, updatedAt: endedAt };
            if (!keeps) {
                endCinemaPresence(char.id, done.id);
                void endAmsgChatPresence(char.id);
                stopAmsgChatPresence(char.id);
                addToast('散场了（这一场没有留痕）', 'success');
                setView('home');
                void reload();
                return;
            }
            await DB.saveMessage({
                charId: char.id, role: 'system', type: 'system',
                content: buildCinemaEndCardText(done, char.name),
                metadata: {
                    source: CINEMA_END_SOURCE, cinemaSessionId: done.id, cinemaTitle: done.title,
                    ...(done.meet === 'offline' ? { cinemaMeet: 'offline' } : {}),
                    ...(done.episode ? { cinemaEpisode: done.episode } : {}),
                    ...(done.lastVideoTime !== undefined ? { cinemaVideoTime: Math.floor(done.lastVideoTime) } : {}),
                },
            });
            endCinemaPresence(char.id, done.id);
            void endAmsgChatPresence(char.id);
            stopAmsgChatPresence(char.id);
            markAmsgStateDirty({ char, userProfile, groups, realtimeConfig });
            void runCallMemoryPalacePostFlow({
                char,
                getLiveChar: () => characters.find(c => c.id === char.id) || null,
                memoryPalaceConfig, apiConfig, userName: userProfile?.name, updateCharacter,
            }).catch(error => console.warn('[cinema] 散场后整理记忆失败', error));
            addToast('散场了，这一场已经记下', 'success');
            setView('home');
            void reload();
        } catch (error: any) {
            addToast(`散场没成功：${error?.message || error}`, 'error');
        } finally {
            setEnding(false);
        }
    };

    // ---- 页面 ----
    const connLabel = conn === 'open'
        ? (screenOnline ? '电脑在线' : '等电脑连上')
        : conn === 'connecting' ? '连接中…' : '没连上';

    if (!loaded) return <div className="cinema"><div className="cn-empty">…</div></div>;

    if (view === 'pair' && pairing) {
        const url = watchPageUrl();
        const host = workerHostForDisplay(pairing.workerUrl);
        return (
            <div className="cinema">
                <header className="cn-top">
                    <button className="cn-icon" onClick={() => { setView('home'); void reload(); }} aria-label="返回"><ArrowLeft size={20} /></button>
                    <div className="cn-top-title"><small>PAIR</small><h1>配对电脑</h1></div>
                    <span className="cn-icon" />
                </header>
                <main className="cn-scroll overflow-y-auto">
                    <ol className="cn-steps">
                        <li>
                            <b>在电脑上用 Chrome 或 360 极速浏览器打开</b>
                            <div className="cn-copy"><code>{url}</code><button onClick={async () => addToast(await copyText(url) ? '已复制' : '复制失败，手动抄一下', 'info')}><Copy size={16} /></button></div>
                        </li>
                        <li>
                            <b>第一次打开会问 Worker 地址，填这个</b>
                            <div className="cn-copy"><code>{host}</code><button onClick={async () => addToast(await copyText(host) ? '已复制' : '复制失败，手动抄一下', 'info')}><Copy size={16} /></button></div>
                        </li>
                        <li>
                            <b>再输入配对码</b>
                            <div className="cn-code">{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</div>
                            <p className="cn-lead">10 分钟内有效，只能用一次。配好以后电脑会记住，下次打开直接连。</p>
                        </li>
                    </ol>
                    <div className={`cn-pair-state ${screenOnline ? 'ok' : ''}`}>
                        <Monitor size={18} /> {screenOnline ? '电脑已经连上了！' : conn === 'open' ? '等电脑输入配对码…' : connLabel}
                    </div>
                    {screenOnline && <button className="cn-primary" onClick={() => { setView('home'); void reload(); }}>好了，回去开场</button>}
                </main>
            </div>
        );
    }

    if (view === 'room' && session) {
        const statusText = [describeStatus(status), externalSubsName ? `字幕：${externalSubsName}` : ''].filter(Boolean).join(' · ');
        return (
            <div className="cinema">
                <header className="cn-top">
                    <button className="cn-icon" onClick={() => { setView('home'); void reload(); }} aria-label="返回"><ArrowLeft size={20} /></button>
                    <div className="cn-top-title">
                        <small><span className={`cn-dot-inline ${conn === 'open' && screenOnline ? 'on' : conn === 'open' ? 'wait' : ''}`} title={connLabel} />{char?.name || '?'} {session.meet === 'offline' ? '坐在你旁边' : '和你隔着屏幕'}一起看</small>
                        <h1>{describeWork(session)}</h1>
                    </div>
                    <button className="cn-end" onClick={() => void endScreening()} disabled={ending}>散场</button>
                </header>
                <section className="cn-screen">
                    {frame
                        ? <img src={frame.dataUrl} alt="电脑上的画面" />
                        : <div className="cn-screen-empty">{screenOnline ? '电脑连上了，等它传画面…' : `${connLabel} · 在电脑上打开观影端`}</div>}
                    <div className="cn-screen-bar">
                        <span>{statusText || connLabel}</span>
                        <button onClick={async () => { const f = await requestFrame(); if (!f) addToast('电脑没回画面（没共享屏幕，或者没连上）', 'info'); }}>
                            <ArrowsClockwise size={14} /> 刷新画面
                        </button>
                    </div>
                </section>
                <div className="cn-proactive">
                    <span>主动开口</span>
                    <div className="cn-seg small">
                        {PROACTIVE_LEVELS.map(l => (
                            <button key={l.id} className={level === l.id ? 'on' : ''} onClick={() => changeLevel(l.id)}>{l.label}</button>
                        ))}
                    </div>
                    <button
                        className={`cn-remember ${sessionRemembers(session) ? 'on' : ''}`}
                        onClick={() => void toggleRemember()}
                        title={sessionRemembers(session) ? '这一场会记进聊天记录和记忆' : '这一场不留痕'}
                    >
                        {sessionRemembers(session) ? '记住' : '不留痕'}
                    </button>
                    <button
                        className={`cn-voice ${voiceOn && canSpeak ? 'on' : ''}`}
                        onClick={() => canSpeak ? toggleVoice() : addToast(`${char?.name || '角色'} 还没配音色，去神经链接里给 ta 选一个声音`, 'info')}
                        aria-label="出声"
                        title={canSpeak ? (voiceOn ? '角色的话会念出来' : '角色只打字') : '没配音色'}
                    >
                        {voiceOn && canSpeak ? <SpeakerHigh size={16} weight="fill" /> : <SpeakerSlash size={16} />}
                    </button>
                </div>
                {lastNote && <div className="cn-note">📝 {lastNote.text}</div>}
                <div className="cn-chat overflow-y-auto" ref={listRef}>
                    {session.lines.length === 0 && (
                        <div className="cn-empty small">
                            开场了。电脑上开始放以后，想说什么就说。<br />
                            {char?.name} 每次回你之前都会看一眼当下的画面。
                        </div>
                    )}
                    {session.lines.map((line, i) => line.kind === 'action' ? (
                        <div key={`${line.at}-${i}`} className={`cn-action ${line.role}`}>{line.text}</div>
                    ) : (
                        <div key={`${line.at}-${i}`} className={`cn-line ${line.role}`}>
                            {line.role === 'char' && char?.avatar && <img className="cn-avatar" src={char.avatar} alt="" />}
                            <div
                                className="cn-bubble"
                                onClick={() => {
                                    const url = line.role === 'char' ? lineAudioRef.current.get(line.at) : undefined;
                                    if (url) getSpeaker().replay(url);
                                }}
                            >
                                {line.text}
                                {line.role === 'char' && lineAudioRef.current.has(line.at) && <span className="cn-replay">🔊</span>}
                                {line.role === 'user' && (line.withFrame || line.videoTime !== undefined) && (
                                    <span className="cn-meta">{line.withFrame ? '附画面' : ''}{line.videoTime !== undefined ? ` ${formatVideoTime(line.videoTime)}` : ''}</span>
                                )}
                            </div>
                        </div>
                    ))}
                    {thinking && <div className="cn-line char"><div className="cn-bubble typing">{char?.name} 在看…</div></div>}
                </div>
                <footer className="cn-input">
                    <button className={`cn-eye ${withFrame ? 'on' : ''}`} onClick={() => setWithFrame(v => !v)} aria-label="带不带画面" title={withFrame ? '发消息时带上画面' : '只发文字'}>
                        <Eye size={20} weight={withFrame ? 'fill' : 'regular'} />
                    </button>
                    <button
                        className={`cn-mic ${listening ? 'on' : ''}`}
                        onClick={() => void toggleMic()}
                        disabled={sttBusy}
                        aria-label={listening ? '说完了' : '按一下说话'}
                        title={listening ? '再点一下结束，听到的话会自动发出去' : '按一下说话'}
                    >
                        <Microphone size={20} weight={listening ? 'fill' : 'regular'} />
                    </button>
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                        placeholder={listening ? '在听你说…（再点麦克风结束）' : sttBusy ? '正在转文字…' : thinking ? `${char?.name} 在看…` : '边看边说…'}
                        rows={1}
                    />
                    <button className="cn-send" onClick={() => void send()} disabled={!draft.trim() || thinking} aria-label="发送"><PaperPlaneRight size={20} weight="fill" /></button>
                </footer>
            </div>
        );
    }

    // ---- 首页 ----
    return (
        <div className="cinema">
            <header className="cn-top">
                <button className="cn-icon" onClick={closeApp} aria-label="关闭"><ArrowLeft size={20} /></button>
                <div className="cn-top-title"><small>CINEMA</small><h1>影院</h1></div>
                <span className="cn-icon" />
            </header>
            <main className="cn-scroll overflow-y-auto">
                <section className="cn-card">
                    <div className="cn-card-head"><Monitor size={18} /> 电脑</div>
                    {pairing ? (
                        <>
                            <p className="cn-lead">已配对 · 房间 <b>{pairing.code}</b>。电脑上打开观影端就会自动连上。</p>
                            <div className="cn-row">
                                <button className="cn-ghost" onClick={() => setView('pair')}>怎么在电脑上打开</button>
                                <button className="cn-ghost" onClick={() => void startPairing()} disabled={pairBusy}>重新配对</button>
                                <button className="cn-ghost danger" onClick={() => void forgetPairing()}>解除</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="cn-lead">视频在电脑上放，角色在这里陪你看。先把电脑配对上（只要一次）。</p>
                            <button className="cn-primary" onClick={() => void startPairing()} disabled={pairBusy}>{pairBusy ? '正在开放映室…' : '配对电脑'}</button>
                        </>
                    )}
                </section>

                <section className="cn-card">
                    <div className="cn-card-head"><FilmSlate size={18} /> 开一场</div>
                    <label className="cn-label">和谁一起看</label>
                    <div className="cn-chars">
                        {characters.map(c => (
                            <button key={c.id} className={`cn-char ${c.id === charId ? 'on' : ''}`} onClick={() => { setCharId(c.id); setMeetChoice(null); }}>
                                {c.avatar ? <img src={c.avatar} alt="" /> : <span className="cn-char-ph">{c.name.slice(0, 1)}</span>}
                                <span>{c.name}</span>
                            </button>
                        ))}
                    </div>
                    <label className="cn-label">看什么</label>
                    <input className="cn-field" value={title} onChange={e => setTitle(e.target.value)} placeholder="片名，比如：葬送的芙莉莲" />
                    <input className="cn-field" value={episode} onChange={e => setEpisode(e.target.value)} placeholder="第几集（可以不填）" />
                    <label className="cn-label">在哪儿看</label>
                    <div className="cn-seg">
                        <button className={meet === 'online' ? 'on' : ''} onClick={() => setMeetChoice('online')}>线上 · 各在各的地方</button>
                        <button className={meet === 'offline' ? 'on' : ''} onClick={() => setMeetChoice('offline')}>线下 · 坐在一起</button>
                    </div>
                    <p className="cn-hint">
                        {meet === 'offline'
                            ? (meetingNow
                                ? `你们正在见面，这一场会记在这次见面里。回到见面后 ${char?.name || 'TA'} 记得刚一起看了什么；看片用掉的时间，用见面里的「过场」往后推。`
                                : `${char?.name || 'TA'} 现在没在见面里。选线下的话就当作你们坐在一起看，但不会接到哪次见面上。`)
                            : `${char?.name || 'TA'} 知道你们不在一起，是隔着手机同步看。`}
                    </p>
                    <label className="cn-label">这一场记不记</label>
                    <div className="cn-seg">
                        <button className={remember ? 'on' : ''} onClick={() => setRemember(true)}>记住</button>
                        <button className={!remember ? 'on' : ''} onClick={() => setRemember(false)}>不留痕</button>
                    </div>
                    <p className="cn-hint">
                        {remember
                            ? `说过的话会记进你和 ${char?.name || 'TA'} 的聊天记录，散场时整理进记忆。`
                            : `只留在影院里：不存进聊天记录，散场也不整理记忆，${char?.name || 'TA'} 在私聊里不会知道看过。放映室里随时能改。`}
                    </p>
                    <label className="cn-label">{char?.name || 'TA'} 看过吗</label>
                    <div className="cn-seg">
                        <button className={spoiler === 'first' ? 'on' : ''} onClick={() => setSpoiler('first')}>第一次看</button>
                        <button className={spoiler === 'seen' ? 'on' : ''} onClick={() => setSpoiler('seen')}>看过（不剧透）</button>
                    </div>
                    <button className="cn-primary" onClick={() => void startSession()} disabled={!pairing}>{pairing ? '开场' : '先配对电脑'}</button>
                </section>

                {sessions.length > 0 && (
                    <section className="cn-card">
                        <div className="cn-card-head">最近看过</div>
                        {sessions.slice(0, 20).map(s => {
                            const who = characters.find(c => c.id === s.charId);
                            return (
                                <div key={s.id} className="cn-session">
                                    <button className="cn-session-main" onClick={() => pairing ? openSession(s) : addToast('先配对电脑', 'info')}>
                                        <b>{describeWork(s)}</b>
                                        <small>
                                            和 {who?.name || '（角色已删除）'} · {new Date(s.updatedAt).toLocaleDateString()}
                                            {s.lastVideoTime !== undefined ? ` · 看到 ${formatVideoTime(s.lastVideoTime)}` : ''}
                                            {` · ${s.lines.length} 句`}
                                            {s.remember === false ? ' · 不留痕' : ''}
                                            {s.endedAt ? ' · 已散场' : who && getActiveCinemaPresence(who.id)?.sessionId === s.id ? ' · 正在看' : ''}
                                        </small>
                                    </button>
                                    <button className="cn-icon" onClick={() => void removeSession(s)} aria-label="删除"><Trash size={16} /></button>
                                </div>
                            );
                        })}
                    </section>
                )}
            </main>
        </div>
    );
};

export default CinemaApp;
