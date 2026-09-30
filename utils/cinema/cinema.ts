/**
 * 影院 —— 电脑上放视频，手机里的角色同步看画面、陪你聊。
 *
 * 这里只放纯逻辑（数据形状、提示词、清洗、画面新鲜度），不碰 IndexedDB / 网络，方便测试。
 * 存储见 cinemaDb.ts，放映室连接见 watchRoomClient.ts，请角色说话见 askCinema.ts。
 * 方案与分期见工作区根目录的「交接说明-一起看.md」。
 */

export const CINEMA_PAIR_ID = 'cinema-pair';
export const CINEMA_SESSION_PREFIX = 'cinema-session-';

/**
 * 放映室里的每句话都照通话的做法存进私聊的消息库（说一句进一句）：
 * 私聊界面不显示，但角色的上下文里以「[一起看：片名]」出现，也进记忆宫殿。
 * 散场时再落一条 system 卡片，私聊界面上看得到。
 */
export const CINEMA_MESSAGE_SOURCE = 'cinema';
export const CINEMA_END_SOURCE = 'cinema-end';

/** 手机记住的放映室（配对一次，以后打开直接连）。 */
export interface CinemaPairing {
    id: typeof CINEMA_PAIR_ID;
    workerUrl: string;
    code: string;
    secret: string;
    createdAt: number;
}

/** 角色有没有看过这部：决定能不能讲伏笔，但任何情况下都不剧透当前进度之后。 */
export type CinemaSpoilerMode = 'first' | 'seen';

export interface CinemaChatLine {
    role: 'user' | 'char';
    text: string;
    at: number;
    /** 这句话发出时视频放到哪（秒）。只有能拿到进度的片源才有 */
    videoTime?: number;
    /** 这句话随附了画面 */
    withFrame?: boolean;
    /** action = 括号里的小动作（text 不带括号），界面上显示成居中的旁白，不进气泡 */
    kind?: 'action';
}

/**
 * 线上 = 各在各的地方，隔着手机同步看；线下 = 正在见面，并肩坐着看同一块屏幕。
 * 开场时萧逸正在见面里就默认线下（交接说明-一起看.md 需求池 ②）。
 */
export type CinemaMeetMode = 'online' | 'offline';

export interface CinemaSession {
    id: string;
    charId: string;
    /** 旧记录没有这个字段，按线上算 */
    meet?: CinemaMeetMode;
    /** 线下看时，这一场属于哪一次见面（见面那边据此知道「这次见面里一起看过片」） */
    dateEncounterId?: string;
    /**
     * false = 不留痕：这一场只留在影院自己的记录里，不存进私聊、散场不留卡片、不整理记忆。
     * 旧记录没有这个字段，按「记住」算。开场时选，放映室里随时能改（用户 09-30 定）。
     */
    remember?: boolean;
    title: string;
    episode?: string;
    spoiler: CinemaSpoilerMode;
    startedAt: number;
    updatedAt: number;
    /** 最后知道的播放进度（秒），下次打开提示「上次看到哪」 */
    lastVideoTime?: number;
    /** 上次在哪看的：网站视频的网址（小插件报的），「接着看」时让电脑跳回去 */
    lastVideoUrl?: string;
    /** 上次是在观影端里放本地视频（lastVideoFile 是文件名），还是在网站上看 */
    lastVideoMode?: 'site' | 'local';
    lastVideoFile?: string;
    /** 点过「散场」的时间。再点进来接着看会清掉 */
    endedAt?: number;
    lines: CinemaChatLine[];
    /** 助理看截图写的画面笔记（最多存 CINEMA_NOTES_KEEP 条），角色平时靠它跟剧情 */
    notes?: CinemaNote[];
}

/** 一条画面笔记。 */
export interface CinemaNote {
    at: number;
    videoTime?: number;
    text: string;
}

export const CINEMA_NOTES_KEEP = 30;
/** 提示词里带最近几条笔记。 */
export const CINEMA_NOTES_IN_PROMPT = 8;

export const appendCinemaNote = (notes: CinemaNote[] | undefined, note: CinemaNote): CinemaNote[] =>
    [...(notes || []), note].slice(-CINEMA_NOTES_KEEP);

/** 主动开口的频率。off = 只在用户说话时回。 */
export type CinemaProactiveLevel = 'off' | 'quiet' | 'normal' | 'chatty';

export const PROACTIVE_LEVELS: { id: CinemaProactiveLevel; label: string }[] = [
    { id: 'off', label: '不主动' },
    { id: 'quiet', label: '安静' },
    { id: 'normal', label: '适中' },
    { id: 'chatty', label: '话痨' },
];

/** 两次开口之间至少隔多久（离角色上一次说话算起）。 */
export const PROACTIVE_GAP_MS: Record<Exclude<CinemaProactiveLevel, 'off'>, number> = {
    quiet: 8 * 60_000,
    normal: 3 * 60_000, // 用户 09-30 嫌 4 分钟太久
    chatty: 90_000,
};
/** 两条笔记之间至少隔多久：话痨记得勤一点，安静就少记。 */
export const NOTE_GAP_MS: Record<CinemaProactiveLevel, number> = {
    off: 3 * 60_000,
    quiet: 2 * 60_000,
    normal: 60_000,
    chatty: 45_000,
};
/** 用户刚说过话就别抢话。 */
export const PROACTIVE_USER_QUIET_MS = 45_000;
/** 暂停超过这么久，角色可以问一句。 */
export const PROACTIVE_PAUSE_MS = 15_000;

export type ProactiveReason = 'scene' | 'silence' | 'pause';

export interface ProactiveState {
    level: CinemaProactiveLevel;
    now: number;
    /** 用户最后一次说话；这一场还没说过就用开场时间 */
    lastUserAt: number;
    /** 角色最后一次说话（回复或主动都算）；还没说过就用开场时间 */
    lastCharAt: number;
    /** 角色上次说话以后，又来了几次换场景 */
    scenesSinceChar: number;
    paused: boolean;
    pausedSince?: number;
    /** 这次暂停已经问过了 */
    pauseHandled: boolean;
    /** 用户正在打字 / 角色正在回 / 电脑没连上 —— 任何一样都不开口 */
    blocked: boolean;
}

/**
 * 这会儿该不该主动开口，该的话是因为什么。纯规则，不花钱。
 * 真正开口前角色还可以自己选择「[安静]」。
 */
export const decideProactive = (st: ProactiveState): ProactiveReason | null => {
    if (st.level === 'off' || st.blocked) return null;
    if (st.now - st.lastUserAt < PROACTIVE_USER_QUIET_MS) return null;
    const sinceChar = st.now - st.lastCharAt;
    if (st.paused) {
        const pausedFor = st.pausedSince ? st.now - st.pausedSince : 0;
        return !st.pauseHandled && pausedFor >= PROACTIVE_PAUSE_MS && sinceChar >= 60_000 ? 'pause' : null;
    }
    const gap = PROACTIVE_GAP_MS[st.level];
    if (sinceChar < gap) return null;
    if (st.scenesSinceChar > 0) return 'scene';
    if (sinceChar >= gap * 2 && st.now - st.lastUserAt >= gap * 2) return 'silence';
    return null;
};

/** 角色回「[安静]」= 这会儿不想说话。 */
export const isSilentReply = (raw: string): boolean =>
    /^[\s\[【（(]*安静[\s\]】）)。.…]*$/.test(String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim());

const PROACTIVE_REASON_TEXT: Record<ProactiveReason, string> = {
    scene: '画面换了一个场景',
    silence: '你们有一阵子没说话了',
    pause: '对方把视频暂停了',
};

/** 主动开口那一轮发给模型的「提示用户消息」：不存、不显示，只是让模型知道这一轮没人说话。 */
export const buildProactiveNudge = (reason: ProactiveReason, hasFrame: boolean): string =>
    `（这一轮没有人跟你说话。${PROACTIVE_REASON_TEXT[reason]}${hasFrame ? '，这是此刻屏幕上的画面' : ''}。）`;

/** 电脑发来的一帧画面。 */
export interface CinemaFrame {
    dataUrl: string;
    at: number;
    /** scene = 换镜头；request = 手机要的；test = 试截；tick = 定时 */
    reason: string;
    videoTime?: number;
    /** 这帧对应哪次请求（手机要画面时带的 id） */
    requestId?: string;
}

/**
 * 播放状态。三种来源：
 *   local = 观影端网页里直接放的本地视频（精确）
 *   share = 观影端在共享别的网页 / 窗口（只知道在不在共享，不知道进度）
 *   site  = 油猴小插件从 B站 / 腾讯 / 优酷 / 爱奇艺 的播放器里读到的（精确，含暂停）
 */
export interface CinemaStatus {
    mode?: 'share' | 'local' | 'site';
    /** site 模式：哪个平台，比如「B站」 */
    site?: string;
    /** site 模式：播放页网址（小插件报的） */
    url?: string;
    title?: string;
    time?: number;
    duration?: number;
    paused?: boolean;
    subtitle?: string;
    sharing?: boolean;
    at: number;
}

export const newCinemaSession = (
    input: { charId: string; title: string; episode?: string; spoiler: CinemaSpoilerMode; meet?: CinemaMeetMode; dateEncounterId?: string; remember?: boolean },
    now = Date.now(),
): CinemaSession => ({
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    charId: input.charId,
    meet: input.meet === 'offline' ? 'offline' : 'online',
    remember: input.remember !== false,
    ...(input.meet === 'offline' && input.dateEncounterId ? { dateEncounterId: input.dateEncounterId } : {}),
    title: input.title.trim() || '没起名字的片子',
    episode: input.episode?.trim() || undefined,
    spoiler: input.spoiler,
    startedAt: now,
    updatedAt: now,
    lines: [],
});

export const cinemaSessionKey = (id: string) => `${CINEMA_SESSION_PREFIX}${id}`;

/** 1:02:03 / 12:34。拿不到进度时返回空串。 */
export const formatVideoTime = (seconds?: number): string => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

export const describeWork = (session: Pick<CinemaSession, 'title' | 'episode'>): string =>
    `《${session.title}》${session.episode ? ` ${session.episode}` : ''}`;

/** 画面多久以内算「现在的」。超过这个时间，就不当成眼前的画面发给角色。 */
export const FRAME_FRESH_MS = 45_000;

export const isFrameFresh = (frame: CinemaFrame | null | undefined, now = Date.now()): frame is CinemaFrame =>
    !!frame && typeof frame.dataUrl === 'string' && frame.dataUrl.startsWith('data:image/') && now - frame.at <= FRAME_FRESH_MS;

/**
 * 用户在电脑上用输入框输入的 Worker 地址：可以只填子域（cyoutatarou），也可以填整个地址。
 * 手机这边直接用设置里已经填好的地址，这个函数给观影端网页同款逻辑做测试。
 */
export const normalizeWorkerInput = (raw: string): string => {
    const text = raw.trim().replace(/\/+$/, '');
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (text.includes('.')) return `https://${text}`;
    return `https://sullyos-amsg.${text}.workers.dev`;
};

/** 手机上给用户看、让他在电脑上照着填的那段（去掉 https://，短一点好敲）。 */
export const workerHostForDisplay = (workerUrl: string): string =>
    workerUrl.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

export const watchSocketUrl = (workerUrl: string, pairing: Pick<CinemaPairing, 'code' | 'secret'>, role: 'phone' | 'screen'): string => {
    const base = workerUrl.trim().replace(/\/+$/, '').replace(/^http/i, 'ws');
    return `${base}/watch-room/ws?room=${encodeURIComponent(pairing.code)}&secret=${encodeURIComponent(pairing.secret)}&role=${role}`;
};

/**
 * 模型回的话：去掉思考块、聊天用的 [[标签]]，按空行拆成几条气泡。
 * 心声那一行（`{"t":"xinsheng",...}`）从开头一直删到结尾：影院的提示词已经不要心声了，
 * 但模型会照着私聊历史的惯性继续写，而且心声协议规定它总在最后。
 */
export const cleanCinemaReply = (raw: string): string[] => {
    const text = String(raw || '')
        .replace(/\{\s*"t"\s*:\s*"xinsheng"[\s\S]*$/i, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[\[[^\]]*\]\]/g, '')
        .replace(/\r/g, '')
        .trim();
    if (!text) return [];
    return text
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .map(line => line.slice(0, 400));
};

export interface CinemaSegment {
    kind: 'speech' | 'action';
    text: string;
}

const isStageDirection = (inner: string): boolean => /[^\x00-\x7f]/.test(inner);
const ACTION_AT_START = /^[（(]([^（）()]{1,80})[）)]\s*/;
const ACTION_AT_END = /\s*[（(]([^（）()]{1,80})[）)]$/;

/**
 * 把一行拆成「说的话」和「括号里的小动作」：只拆开头和结尾的括号，
 * 句子中间的括号当作说话的一部分（「那个人（就是穿黑衣服的）好可疑」）。
 * 「（往你那边靠了靠）这段好吓人」→ 旁白「往你那边靠了靠」+ 气泡「这段好吓人」。
 */
export const splitCinemaActions = (line: string): CinemaSegment[] => {
    let rest = String(line || '').trim();
    const head: CinemaSegment[] = [];
    const tail: CinemaSegment[] = [];
    let m: RegExpMatchArray | null;
    // 括号里有中文才算小动作：(laughs) (sighs) 这类英文是给配音用的语气声，得留在台词里
    while ((m = rest.match(ACTION_AT_START)) && isStageDirection(m[1])) {
        head.push({ kind: 'action', text: m[1].trim() });
        rest = rest.slice(m[0].length).trim();
    }
    while (rest && (m = rest.match(ACTION_AT_END)) && isStageDirection(m[1])) {
        tail.unshift({ kind: 'action', text: m[1].trim() });
        rest = rest.slice(0, rest.length - m[0].length).trim();
    }
    return [...head, ...(rest ? [{ kind: 'speech' as const, text: rest }] : []), ...tail].filter(seg => seg.text);
};

/** 一方这一轮说的几行 → 放映室里的几条记录（小动作单独成条）。 */
export const toCinemaLines = (role: CinemaChatLine['role'], texts: string[], at: number, videoTime?: number): CinemaChatLine[] =>
    texts
        .flatMap(splitCinemaActions)
        .map((seg, i) => ({
            role, text: seg.text, at: at + i,
            ...(videoTime !== undefined ? { videoTime } : {}),
            ...(seg.kind === 'action' ? { kind: 'action' as const } : {}),
        }));

/** 存进私聊 / 发给模型时的文字：小动作带回括号，读的人才知道那是动作不是台词。 */
export const cinemaLineText = (line: Pick<CinemaChatLine, 'text' | 'kind'>): string =>
    line.kind === 'action' ? `（${line.text}）` : line.text;

/** 放映室里这一场的对话，接在正常聊天上下文后面发给模型。 */
export const sessionLinesToApiMessages = (lines: CinemaChatLine[], limit = 30): { role: 'user' | 'assistant'; content: string }[] => {
    const recent = lines.slice(-limit);
    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const line of recent) {
        const time = formatVideoTime(line.videoTime);
        const body = cinemaLineText(line);
        const content = line.role === 'user' && time && line.kind !== 'action' ? `（放到 ${time}）${body}` : body;
        const role = line.role === 'user' ? 'user' : 'assistant';
        // 连续同一方的几句合成一条，免得有的接口不认连续两条 user
        const last = out[out.length - 1];
        if (last && last.role === role) last.content += `\n${content}`;
        else out.push({ role, content });
    }
    return out;
};

export interface CinemaPromptContext {
    userName: string;
    charName: string;
    session: Pick<CinemaSession, 'title' | 'episode' | 'spoiler' | 'meet'>;
    status?: CinemaStatus | null;
    hasFrame: boolean;
    /** 助理笔记（按时间，最近几条） */
    notes?: CinemaNote[];
    /** 这一轮是角色自己想开口 */
    proactive?: ProactiveReason;
    /** 开着「出声」时：私聊用的那份语音写法（含用户自定义指南、角色专属语音提示词、固定运行协议） */
    voiceGuide?: string;
    /** 小插件从 B站 播放器读到的最近几句字幕（CC / AI 字幕） */
    recentSubtitles?: CinemaSubtitleLine[];
}

/** 一句字幕。time 是视频里的秒数（读不到就没有）。 */
export interface CinemaSubtitleLine {
    time?: number;
    text: string;
}

export const CINEMA_SUBTITLES_KEEP = 20;
export const CINEMA_SUBTITLES_IN_PROMPT = 10;

/** 把小插件新带来的几句接到后面：跟最后一句一样的不重复记，最多留 20 句。 */
export const appendSubtitleLines = (prev: CinemaSubtitleLine[], incoming: unknown): CinemaSubtitleLine[] => {
    if (!Array.isArray(incoming)) return prev;
    const out = [...prev];
    for (const raw of incoming) {
        const text = typeof raw?.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (!text || out[out.length - 1]?.text === text) continue;
        out.push({ text, ...(typeof raw?.time === 'number' && Number.isFinite(raw.time) ? { time: raw.time } : {}) });
    }
    return out.slice(-CINEMA_SUBTITLES_KEEP);
};

/**
 * 接在正常聊天 system prompt 后面的影院说明。人设、记忆、关系都来自正常那一段，
 * 这里只交代「你们正在一起看什么、怎么看、怎么说话」。
 */
export const buildCinemaInstruction = (ctx: CinemaPromptContext): string => {
    const { userName, charName, session, status, hasFrame, proactive } = ctx;
    const recentNotes = (ctx.notes || []).slice(-CINEMA_NOTES_IN_PROMPT);
    const notesBlock = recentNotes.length
        ? `\n- 最近的画面笔记（助理看截图写的，按时间先后，帮你跟上剧情；只当作你自己看到的画面，不要提到「笔记」或「助理」）：\n${recentNotes.map(n => `  · ${formatVideoTime(n.videoTime) || new Date(n.at).toLocaleTimeString()} ${n.text}`).join('\n')}`
        : '';
    const recentSubs = (ctx.recentSubtitles || []).slice(-CINEMA_SUBTITLES_IN_PROMPT);
    const subtitlesBlock = recentSubs.length
        ? `\n- 最近的台词（播放器上的字幕，按时间先后；这是剧里人物说的话，不是${userName}说的）：\n${recentSubs.map(l => `  · ${formatVideoTime(l.time) ? `${formatVideoTime(l.time)} ` : ''}${l.text}`).join('\n')}`
        : '';
    const proactiveBlock = proactive
        ? `\n- **这一轮没人跟你说话**（${PROACTIVE_REASON_TEXT[proactive]}），是你自己看着看着想说点什么：可以是感想、吐槽、猜测、提醒对方注意某个细节，或者因为暂停随口问一句。别重复你刚说过的话。**如果这会儿确实没什么想说的，只输出「[安静]」**，不要硬凑。`
        : '';
    const work = describeWork(session);
    const time = formatVideoTime(status?.time);
    const duration = formatVideoTime(status?.duration);
    const progress = time ? `现在放到 ${time}${duration ? ` / ${duration}` : ''}${status?.paused ? '（暂停中）' : ''}。` : '';
    const subtitle = status?.subtitle?.trim() ? `当前字幕：「${status.subtitle.trim().slice(0, 200)}」。` : '';
    // 小插件读到的播放页标题，常带着第几集 / 分P 名，帮角色对上是哪一集
    const pageTitle = status?.mode === 'site' && status.title?.trim() ? `电脑上的播放页标题是「${status.title.trim().slice(0, 80)}」。` : '';
    const spoilerRule = session.spoiler === 'seen'
        ? `你以前看过${work}，可以聊细节、埋伏笔、讲${userName}可能没注意到的东西；但**绝对不能剧透${userName}还没看到的剧情**（当前进度之后发生的事），最多意味深长地说一句「后面你就知道了」。`
        : `你是第一次看${work}，跟${userName}一样不知道后面会怎样。可以猜、可以期待、可以被吓到，但不要假装知道后面的剧情。就算你本来对这部作品有印象，也当作没看过。`;
    const offline = session.meet === 'offline';
    const scene = offline
        ? `你们正在见面，此刻**并肩坐在一起**看${work}，看的是同一块屏幕。之前见面里是在哪、是什么情形，照历史里的见面记录接着来，不要换地方。`
        : `${userName}在电脑上放${work}，你们**不在一起**，各在各的地方隔着手机同步看。不要写成坐在一起，也不要有碰到对方的动作。`;
    const format = offline
        ? `- 只输出你要说的话，可以分几行（每行会变成一条气泡）。人就在旁边，可以带一点很轻的小动作：**单独写一行，整行用（）括起来**，比如（往你那边靠了靠），它会显示成旁白而不是气泡。一次最多一个、一句话以内，别写成大段描写。${userName}的消息里整行（）括起来的，是${userName}的动作。不要加引号或标题。`
        : `- 只输出你要说的话，可以分几行（每行会变成一条气泡）。不要写动作描写，不要加引号或标题。`;
    return `

【影院 · 一起看】${scene}${userName}的消息是边看边跟你说的。${progress}${pageTitle}${subtitle}
${hasFrame ? `- 最后一条消息附带了**此刻屏幕上的画面**（电脑截图）。自然地结合画面说话，像${offline ? '坐在旁边' : '一起看'}的人那样，不要描述「我看到一张截图」，也不要解释你是怎么看到的。画面里有字幕的话，字幕就是当下的台词。` : `- 这一轮没有拿到画面，只根据${userName}说的话和你们之前聊到的内容回应，不要编造画面细节。`}
- ${spoilerRule}
- 可以有自己的感想、吐槽、偏爱的角色，也可以讲一些更深的东西（镜头、伏笔、隐喻、背景、演员），但一切按你自己的性格和口吻来，不要变成百科或影评腔。
- 你们在看片，回得**短**一点：通常 1~3 句，口语，像弹幕或${offline ? '凑到耳边' : '贴着话筒'}小声说的话；${userName}认真问问题时可以多说一点。${subtitlesBlock}${notesBlock}${proactiveBlock}
${format}${ctx.voiceGuide ? `

【影院 · 出声】你在放映室里说的每一句话都会被直接念出来：不用写 <语音> 标签，整段台词就是语音。照下面的语音写法来写（停顿标记、英文语气声都可以用，它们不会显示在屏幕上）；中文（）括起来的小动作照旧单独一行，不会被念出来。

${ctx.voiceGuide}` : ''}`;
};

/** 状态里的播放进度转成人话，给界面上的状态条用。 */
export const describeStatus = (status: CinemaStatus | null | undefined): string => {
    if (!status) return '';
    const time = formatVideoTime(status.time);
    if (status.mode === 'local' && time) {
        const dur = formatVideoTime(status.duration);
        return `${status.paused ? '暂停' : '播放中'} ${time}${dur ? ` / ${dur}` : ''}`;
    }
    if (status.mode === 'site' && time) {
        const dur = formatVideoTime(status.duration);
        return `${status.site ? `${status.site} · ` : ''}${status.paused ? '⏸ 暂停' : '播放中'} ${time}${dur ? ` / ${dur}` : ''}`;
    }
    if (status.mode === 'share') return status.sharing ? '电脑正在共享画面' : '电脑还没开始共享画面';
    return '';
};

/** 散场卡上那一行字（私聊界面显示，角色上下文里也看得到）。 */
export const buildCinemaEndCardText = (session: Pick<CinemaSession, 'title' | 'episode' | 'lastVideoTime' | 'lines' | 'meet'>, charName: string): string => {
    const time = formatVideoTime(session.lastVideoTime);
    const turns = session.lines.filter(line => line.role === 'user').length;
    return `一起看结束${session.meet === 'offline' ? '（面对面）' : ''} · ${charName}｜${describeWork(session)}${time ? `｜看到 ${time}` : ''}｜聊了${turns}句`;
};

/** 存进私聊消息库时挂的 metadata。 */
export const cinemaMessageMetadata = (session: Pick<CinemaSession, 'id' | 'title' | 'episode' | 'meet' | 'dateEncounterId'>, videoTime?: number) => ({
    source: CINEMA_MESSAGE_SOURCE,
    cinemaSessionId: session.id,
    cinemaTitle: session.title,
    ...(session.episode ? { cinemaEpisode: session.episode } : {}),
    ...(session.meet === 'offline' ? { cinemaMeet: 'offline' } : {}),
    ...(session.meet === 'offline' && session.dateEncounterId ? { dateEncounterId: session.dateEncounterId } : {}),
    ...(typeof videoTime === 'number' && Number.isFinite(videoTime) ? { cinemaVideoTime: Math.floor(videoTime) } : {}),
});

/** 小插件多久没报就当它不在了（关了标签页、换了电脑）。播放中每 15 秒报一次。 */
export const PLAYER_STALE_MS = 45_000;
/** 暂停中不会一直报，暂停的状态留久一点。 */
export const PLAYER_PAUSED_STALE_MS = 30 * 60 * 1000;

/**
 * 画面在某个时刻之后还在动吗：之后至少来了两次换场景。
 * 只算一次不够——刚按暂停时播放器会弹出暂停图标 / 控制条，本身就可能被当成一次换场景。
 */
export const isPictureMovingSince = (sceneTimes: number[], since: number): boolean =>
    sceneTimes.filter(t => t > since + 3000).length >= 2;

/** 小插件报的状态还算不算数。 */
export const isPlayerFresh = (player: CinemaStatus | null | undefined, now = Date.now()): player is CinemaStatus =>
    !!player && now - player.at <= (player.paused ? PLAYER_PAUSED_STALE_MS : PLAYER_STALE_MS);

/**
 * 观影端（画面）和小插件（进度）各报各的，合成一份给界面和提示词用：
 * 小插件还在报就用它的进度 / 暂停 / 标题，否则退回观影端的。
 */
export const mergeCinemaStatus = (
    screen: CinemaStatus | null | undefined,
    player: CinemaStatus | null | undefined,
    now = Date.now(),
    /** 电脑自己发来的换场景帧的时间（最近几次） */
    sceneTimes: number[] = [],
): CinemaStatus | null => {
    if (isPlayerFresh(player, now) && player.paused && isPictureMovingSince(sceneTimes, player.at)) {
        // 小插件说暂停了，可画面在它说完之后还在不停换场景：那条「暂停」是旧的或者说的是别的标签页
        // （09-30 实测：没点暂停，角色却问「怎么停在这了」）。不信它，退回观影端的状态。
        return screen || null;
    }
    if (isPlayerFresh(player, now)) {
        // 本地片在观影端里放时，观影端自己的进度更准，小插件不会出现在那个页面上
        if (screen?.mode === 'local' && typeof screen.time === 'number') return screen;
        return { ...player, mode: 'site', subtitle: player.subtitle || screen?.subtitle };
    }
    return screen || null;
};

/** 这一场记不记（旧记录没有字段 = 记）。 */
export const sessionRemembers = (session: Pick<CinemaSession, 'remember'> | null | undefined): boolean => session?.remember !== false;

// ───────── 外挂字幕（观影端第 5 块选的字幕文件） ─────────

/** 一句外挂字幕：[开始毫秒, 结束毫秒, 文字] */
export type SubtitleCue = [number, number, string];

export interface ExternalSubtitles {
    name: string;
    /** 正数 = 字幕推后：视频放到 t 时，对应字幕文件里 t - offset 那一句 */
    offsetMs: number;
    cues: SubtitleCue[];
}

export const MAX_EXTERNAL_CUES = 6000;

/** 电脑发来的字幕文件：核对形状，坏的丢掉。没有句子就返回 null（= 不用外挂字幕了）。 */
export const sanitizeExternalSubtitles = (msg: { name?: unknown; offsetMs?: unknown; cues?: unknown }): ExternalSubtitles | null => {
    if (!Array.isArray(msg.cues)) return null;
    const cues: SubtitleCue[] = [];
    for (const raw of msg.cues.slice(0, MAX_EXTERNAL_CUES)) {
        if (!Array.isArray(raw)) continue;
        const [a, b, t] = raw;
        if (typeof a !== 'number' || typeof b !== 'number' || typeof t !== 'string' || !Number.isFinite(a) || !Number.isFinite(b) || !t.trim()) continue;
        cues.push([a, Math.max(a, b), t.trim().slice(0, 200)]);
    }
    if (!cues.length) return null;
    cues.sort((x, y) => x[0] - y[0]);
    return {
        name: typeof msg.name === 'string' ? msg.name.slice(0, 120) : '字幕',
        offsetMs: typeof msg.offsetMs === 'number' && Number.isFinite(msg.offsetMs) ? msg.offsetMs : 0,
        cues,
    };
};

/**
 * 此刻大概放到第几秒：状态里的进度 + 离上报过了多久（在放的话）。
 * 共享画面、没有小插件的时候没有进度，返回 undefined——外挂字幕就对不上。
 */
export const estimateVideoTime = (status: CinemaStatus | null | undefined, now = Date.now()): number | undefined => {
    if (!status || typeof status.time !== 'number' || !Number.isFinite(status.time)) return undefined;
    if (status.paused) return status.time;
    return status.time + Math.max(0, (now - status.at) / 1000);
};

/** 按进度挑出「这一句」和「最近几句」（最近 windowSec 秒里开始的，最多 max 句）。 */
export const pickSubtitleWindow = (
    subs: ExternalSubtitles,
    videoTime: number,
    windowSec = 90,
    max = CINEMA_SUBTITLES_IN_PROMPT,
): { current?: string; recent: CinemaSubtitleLine[] } => {
    const ms = videoTime * 1000 - subs.offsetMs;
    const current = subs.cues.find(c => c[0] <= ms && ms < c[1])?.[2];
    const recent = subs.cues
        .filter(c => c[0] <= ms && c[0] >= ms - windowSec * 1000)
        .slice(-max)
        .map(c => ({ time: Math.max(0, Math.round((c[0] + subs.offsetMs) / 1000)), text: c[2] }));
    return { current, recent };
};

// ───────── 一键接着看 ─────────

/** 往前退几秒再放，免得漏掉上次停下前的那句。 */
export const RESUME_REWIND_SEC = 3;

export interface ResumeCommand {
    type: 'resume';
    id: string;
    time: number;
    title: string;
    mode: 'site' | 'local';
    url?: string;
    file?: string;
}

/** 这一场能不能「接着看」：要知道看到哪，而且要么有网址、要么是本地视频。 */
export const canResume = (session: Pick<CinemaSession, 'lastVideoTime' | 'lastVideoUrl' | 'lastVideoMode'>): boolean =>
    typeof session.lastVideoTime === 'number' && session.lastVideoTime > 0
    && (!!session.lastVideoUrl || session.lastVideoMode === 'local');

/** 发给电脑的「接着看」指令。 */
export const buildResumeCommand = (
    session: Pick<CinemaSession, 'title' | 'episode' | 'lastVideoTime' | 'lastVideoUrl' | 'lastVideoMode' | 'lastVideoFile'>,
    now = Date.now(),
): ResumeCommand | null => {
    if (!canResume(session)) return null;
    const local = session.lastVideoMode === 'local' || !session.lastVideoUrl;
    return {
        type: 'resume',
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        time: Math.max(0, Math.floor(session.lastVideoTime! - RESUME_REWIND_SEC)),
        title: describeWork(session),
        mode: local ? 'local' : 'site',
        ...(local ? { file: session.lastVideoFile } : { url: session.lastVideoUrl }),
    };
};
