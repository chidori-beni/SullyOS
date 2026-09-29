/**
 * 影院 —— 电脑上放视频，手机里的角色同步看画面、陪你聊。
 *
 * 三个页面：首页（开一场 / 最近看过）· 配对电脑 · 放映室。
 * 每句话照通话的做法存进私聊消息库（说一句进一句，私聊界面不显示）；点「散场」落一张卡片。
 * 电脑那边是 public/watch.html（观影端），两边经用户自己的 amsg Worker 中转
 * （worker/amsg/src/watchRoom.ts）。逻辑见 utils/cinema/，方案见工作区「交接说明-一起看.md」。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowsClockwise, Copy, Eye, FilmSlate, Monitor, PaperPlaneRight, Trash } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { CharacterProfile } from '../types';
import { DB } from '../utils/db';
import { endAmsgChatPresence, markAmsgStateDirty, startAmsgChatPresence, stopAmsgChatPresence } from '../utils/amsgStateSync';
import { runCallMemoryPalacePostFlow } from '../utils/memoryPalace/callPostFlow';
import { endCinemaPresence, getActiveCinemaPresence, touchCinemaPresence } from '../utils/cinema/cinemaPresence';
import {
    buildCinemaEndCardText, CINEMA_END_SOURCE, cinemaMessageMetadata,
    describeStatus, describeWork, formatVideoTime, isFrameFresh, mergeCinemaStatus, newCinemaSession, workerHostForDisplay,
    type CinemaChatLine, type CinemaFrame, type CinemaPairing, type CinemaSession, type CinemaSpoilerMode, type CinemaStatus,
} from '../utils/cinema/cinema';
import { clearCinemaPairing, deleteCinemaSession, getCinemaPairing, listCinemaSessions, saveCinemaPairing, saveCinemaSession } from '../utils/cinema/cinemaDb';
import { createWatchRoom, WatchRoomSocket, type WatchConnState, type WatchMessage } from '../utils/cinema/watchRoomClient';
import { askCharacterInCinema, warmCinemaContext } from '../utils/cinema/askCinema';
import './cinema/cinema.css';

type View = 'home' | 'pair' | 'room';

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
            if (f.requestId) {
                const waiter = frameWaiters.current.get(f.requestId);
                if (waiter) { frameWaiters.current.delete(f.requestId); waiter(f); }
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
        }
    }, []);

    const refreshStatus = () => {
        const merged = mergeCinemaStatus(screenStatusRef.current, playerStatusRef.current);
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

    useEffect(() => { sessionRef.current = session; }, [session]);
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
        setSession(s);
        setFrame(null); frameRef.current = null;
        setStatus(null); statusRef.current = null;
        screenStatusRef.current = null; playerStatusRef.current = null;
        progressSavedAt.current = 0;
        setView('room');
    };

    const startSession = async () => {
        if (!pairing) { addToast('先配对电脑', 'info'); return; }
        if (!charId) { addToast('选一个一起看的人', 'info'); return; }
        if (!title.trim()) { addToast('填一下看什么', 'info'); return; }
        const s = newCinemaSession({ charId, title, episode, spoiler });
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

    const persist = async (next: CinemaSession) => {
        setSession(next);
        try { await saveCinemaSession(next); } catch (error) { console.warn('[cinema] 保存失败', error); }
    };

    const send = async () => {
        const text = draft.trim();
        if (!text || !session || !char || thinking) return;
        setDraft('');
        const videoTime = statusRef.current?.time;
        const userLine: CinemaChatLine = { role: 'user', text, at: Date.now(), videoTime };
        let current: CinemaSession = {
            ...session, lines: [...session.lines, userLine], updatedAt: Date.now(),
            lastVideoTime: videoTime ?? session.lastVideoTime,
        };
        await persist(current);
        // 说一句进一句：存进私聊消息库（界面不显示），角色在私聊里也知道你们正在一起看
        await saveLineToChat(char.id, current, 'user', text, videoTime);
        touchCinemaPresence(char.id, current);
        void startAmsgChatPresence(char.id, userLine.at);
        setThinking(true);
        try {
            let frameUrl = '';
            if (withFrame) {
                // 几秒内刚收到过画面就直接用，不再等电脑截新的
                const recent = frameRef.current && Date.now() - frameRef.current.at < RECENT_FRAME_MS ? frameRef.current : null;
                const fresh = recent || await requestFrame(1500);
                const use = fresh || (isFrameFresh(frameRef.current) ? frameRef.current : null);
                frameUrl = use?.dataUrl || '';
            }
            const result = await askCharacterInCinema({
                char, userProfile, groups, apiConfig, realtimeConfig,
                session: current, status: statusRef.current, frameDataUrl: frameUrl,
            });
            if (frameUrl && !result.sawFrame) addToast('当前模型不支持看图，这一轮只发了文字', 'info');
            if (frameUrl && result.sawFrame) {
                current = { ...current, lines: current.lines.map(l => l === userLine ? { ...l, withFrame: true } : l) };
            }
            const now = Date.now();
            const replies: CinemaChatLine[] = result.lines.map((line, i) => ({ role: 'char', text: line, at: now + i }));
            current = { ...current, lines: [...current.lines, ...replies], updatedAt: now };
            await persist(current);
            for (const reply of replies) await saveLineToChat(char.id, current, 'assistant', reply.text, videoTime);
            // 跟通话一样每轮打脏：云端主动消息那份上下文也跟着知道你们在一起看
            markAmsgStateDirty({ char, userProfile, groups, realtimeConfig });
        } catch (error: any) {
            addToast(`${char.name} 没回上：${error?.message || error}`, 'error');
        } finally {
            setThinking(false);
        }
    };

    const saveLineToChat = async (charId: string, s: CinemaSession, role: 'user' | 'assistant', content: string, videoTime?: number) => {
        try {
            await DB.saveMessage({ charId, role, type: 'text', content, metadata: cinemaMessageMetadata(s, videoTime) });
        } catch (error) {
            console.warn('[cinema] 存进私聊失败（放映室里照常）', error);
        }
    };

    /** 散场：落一张卡片进私聊、清掉「正在一起看」、跟通话挂断一样整理记忆。 */
    const endScreening = async () => {
        if (!session || !char || ending) return;
        if (!window.confirm(`散场？\n${char.name} 会记得今天一起看了${describeWork(session)}。之后还可以从「最近看过」点进来接着看。`)) return;
        setEnding(true);
        try {
            const endedAt = Date.now();
            const done: CinemaSession = { ...session, endedAt, updatedAt: endedAt };
            await persist(done);
            await DB.saveMessage({
                charId: char.id, role: 'system', type: 'system',
                content: buildCinemaEndCardText(done, char.name),
                metadata: {
                    source: CINEMA_END_SOURCE, cinemaSessionId: done.id, cinemaTitle: done.title,
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
        const statusText = describeStatus(status);
        return (
            <div className="cinema">
                <header className="cn-top">
                    <button className="cn-icon" onClick={() => { setView('home'); void reload(); }} aria-label="返回"><ArrowLeft size={20} /></button>
                    <div className="cn-top-title">
                        <small><span className={`cn-dot-inline ${conn === 'open' && screenOnline ? 'on' : conn === 'open' ? 'wait' : ''}`} title={connLabel} />{char?.name || '?'} 和你一起看</small>
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
                <div className="cn-chat overflow-y-auto" ref={listRef}>
                    {session.lines.length === 0 && (
                        <div className="cn-empty small">
                            开场了。电脑上开始放以后，想说什么就说。<br />
                            {char?.name} 每次回你之前都会看一眼当下的画面。
                        </div>
                    )}
                    {session.lines.map((line, i) => (
                        <div key={`${line.at}-${i}`} className={`cn-line ${line.role}`}>
                            {line.role === 'char' && char?.avatar && <img className="cn-avatar" src={char.avatar} alt="" />}
                            <div className="cn-bubble">
                                {line.text}
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
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                        placeholder={thinking ? `${char?.name} 在看…` : '边看边说…'}
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
                            <button key={c.id} className={`cn-char ${c.id === charId ? 'on' : ''}`} onClick={() => setCharId(c.id)}>
                                {c.avatar ? <img src={c.avatar} alt="" /> : <span className="cn-char-ph">{c.name.slice(0, 1)}</span>}
                                <span>{c.name}</span>
                            </button>
                        ))}
                    </div>
                    <label className="cn-label">看什么</label>
                    <input className="cn-field" value={title} onChange={e => setTitle(e.target.value)} placeholder="片名，比如：葬送的芙莉莲" />
                    <input className="cn-field" value={episode} onChange={e => setEpisode(e.target.value)} placeholder="第几集（可以不填）" />
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
