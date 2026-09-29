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
}

export interface CinemaSession {
    id: string;
    charId: string;
    title: string;
    episode?: string;
    spoiler: CinemaSpoilerMode;
    startedAt: number;
    updatedAt: number;
    /** 最后知道的播放进度（秒），下次打开提示「上次看到哪」 */
    lastVideoTime?: number;
    /** 点过「散场」的时间。再点进来接着看会清掉 */
    endedAt?: number;
    lines: CinemaChatLine[];
}

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

/** 电脑发来的播放状态。 */
export interface CinemaStatus {
    mode?: 'share' | 'local';
    title?: string;
    time?: number;
    duration?: number;
    paused?: boolean;
    subtitle?: string;
    sharing?: boolean;
    at: number;
}

export const newCinemaSession = (input: { charId: string; title: string; episode?: string; spoiler: CinemaSpoilerMode }, now = Date.now()): CinemaSession => ({
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    charId: input.charId,
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

/** 放映室里这一场的对话，接在正常聊天上下文后面发给模型。 */
export const sessionLinesToApiMessages = (lines: CinemaChatLine[], limit = 30): { role: 'user' | 'assistant'; content: string }[] => {
    const recent = lines.slice(-limit);
    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const line of recent) {
        const time = formatVideoTime(line.videoTime);
        const content = line.role === 'user' && time ? `（放到 ${time}）${line.text}` : line.text;
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
    session: Pick<CinemaSession, 'title' | 'episode' | 'spoiler'>;
    status?: CinemaStatus | null;
    hasFrame: boolean;
}

/**
 * 接在正常聊天 system prompt 后面的影院说明。人设、记忆、关系都来自正常那一段，
 * 这里只交代「你们正在一起看什么、怎么看、怎么说话」。
 */
export const buildCinemaInstruction = (ctx: CinemaPromptContext): string => {
    const { userName, charName, session, status, hasFrame } = ctx;
    const work = describeWork(session);
    const time = formatVideoTime(status?.time);
    const duration = formatVideoTime(status?.duration);
    const progress = time ? `现在放到 ${time}${duration ? ` / ${duration}` : ''}${status?.paused ? '（暂停中）' : ''}。` : '';
    const subtitle = status?.subtitle?.trim() ? `当前字幕：「${status.subtitle.trim().slice(0, 200)}」。` : '';
    const spoilerRule = session.spoiler === 'seen'
        ? `你以前看过${work}，可以聊细节、埋伏笔、讲${userName}可能没注意到的东西；但**绝对不能剧透${userName}还没看到的剧情**（当前进度之后发生的事），最多意味深长地说一句「后面你就知道了」。`
        : `你是第一次看${work}，跟${userName}一样不知道后面会怎样。可以猜、可以期待、可以被吓到，但不要假装知道后面的剧情。就算你本来对这部作品有印象，也当作没看过。`;
    return `

【影院 · 一起看】${userName}在电脑上放${work}，你们正在一起看。${userName}的消息是边看边跟你说的。${progress}${subtitle}
${hasFrame ? `- 最后一条消息附带了**此刻屏幕上的画面**（电脑截图）。自然地结合画面说话，像坐在旁边一起看的人那样，不要描述「我看到一张截图」，也不要解释你是怎么看到的。画面里有字幕的话，字幕就是当下的台词。` : `- 这一轮没有拿到画面，只根据${userName}说的话和你们之前聊到的内容回应，不要编造画面细节。`}
- ${spoilerRule}
- 可以有自己的感想、吐槽、偏爱的角色，也可以讲一些更深的东西（镜头、伏笔、隐喻、背景、演员），但一切按你自己的性格和口吻来，不要变成百科或影评腔。
- 你们在看片，回得**短**一点：通常 1~3 句，口语，像弹幕或贴耳小声说的话；${userName}认真问问题时可以多说一点。
- 只输出你要说的话，可以分几行（每行会变成一条气泡）。不要写动作描写，不要加引号或标题。`;
};

/** 状态里的播放进度转成人话，给界面上的状态条用。 */
export const describeStatus = (status: CinemaStatus | null | undefined): string => {
    if (!status) return '';
    const time = formatVideoTime(status.time);
    if (status.mode === 'local' && time) {
        const dur = formatVideoTime(status.duration);
        return `${status.paused ? '暂停' : '播放中'} ${time}${dur ? ` / ${dur}` : ''}`;
    }
    if (status.mode === 'share') return status.sharing ? '电脑正在共享画面' : '电脑还没开始共享画面';
    return '';
};

/** 散场卡上那一行字（私聊界面显示，角色上下文里也看得到）。 */
export const buildCinemaEndCardText = (session: Pick<CinemaSession, 'title' | 'episode' | 'lastVideoTime' | 'lines'>, charName: string): string => {
    const time = formatVideoTime(session.lastVideoTime);
    const turns = session.lines.filter(line => line.role === 'user').length;
    return `一起看结束 · ${charName}｜${describeWork(session)}${time ? `｜看到 ${time}` : ''}｜聊了${turns}句`;
};

/** 存进私聊消息库时挂的 metadata。 */
export const cinemaMessageMetadata = (session: Pick<CinemaSession, 'id' | 'title' | 'episode'>, videoTime?: number) => ({
    source: CINEMA_MESSAGE_SOURCE,
    cinemaSessionId: session.id,
    cinemaTitle: session.title,
    ...(session.episode ? { cinemaEpisode: session.episode } : {}),
    ...(typeof videoTime === 'number' && Number.isFinite(videoTime) ? { cinemaVideoTime: Math.floor(videoTime) } : {}),
});
