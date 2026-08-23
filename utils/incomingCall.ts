/**
 * 角色主动来电 —— 标签解析 + 冷却判定 + 待接来电的进程内暂存。
 *
 * 解析那一半是**纯函数、零依赖**（连 type import 都没有），浏览器与 Cloudflare Worker
 * 共用同一份。理由跟 utils/scheduleChangeParse.ts 一模一样：worker 侧必须认得出这个标签
 * ——它留在正文里的话会被 sanitizeIntoSegments 的 stripBusinessTagsForNotification
 * （正则含 ACTION）整块剥掉，连 raw 都不留，客户端永远收不到，角色嘴上说"我打给你了"
 * 而电话根本没响。走 worker classifier 的 directive 通道才到得了。
 *
 * 两边各写一份解析的话，前台聊天里打得通的电话、主动消息里打不通。
 *
 * ── 标签形态 ─────────────────────────────────────────────────────────────
 *   [[ACTION:CALL|video|想看看你现在在干嘛]]
 *   [[ACTION:CALL|voice|睡了吗]]
 * 容错：全角竖线/冒号、中文别名（视频/语音）、模式缺省（缺省按语音）、
 *      `[[ACTION:CALL:video|…]]` 这种冒号写法。
 */

/** 来电界面/铃声的触发事件（window 级）。detail 是 PendingIncomingCall。 */
export const INCOMING_CALL_EVENT = 'sully-incoming-call';

/**
 * 同一个角色两通来电之间的最短间隔。
 *
 * 抄的糯叽机（它那边 30 分钟，localStorage 键 `bg_videocall_cooldown_*`）。这个闸不是
 * 为了省资源，是为了保住"来电"这件事的分量：一天响八次的电话跟一条消息没有区别，
 * 而且每一次都强行打断用户在干的事。冷却期内标签直接丢掉——**不降级成任何提示**，
 * 角色那句"我打给你了"照常显示，用户看到的最多是句没兑现的话，比一天八通电话好。
 */
export const INCOMING_CALL_COOLDOWN_MS = 30 * 60 * 1000;

export type CallInviteMode = 'voice' | 'video';

export interface CallInvite {
  mode: CallInviteMode;
  /** 接通后角色的第一句话；空串代表让它到时候自己现编。 */
  opening: string;
}

export interface ExtractedCallInvite {
  cleanedText: string;
  invite: CallInvite | null;
  /** 认出了 CALL 标签但内容废掉的条数，只用来打日志，不影响正文。 */
  malformedCount: number;
}

/**
 * 一整条 `[[ACTION:CALL …]]`。
 *
 * 用 `[\s\S]` 是有意的：开场白里模型经常自己换行。非贪婪 + 先到的 `]]` 收尾，
 * 跟 sanitize.ts 里那条 `\[\[(?:ACTION|…)[:\s][\s\S]*?\]\]` 的边界口径保持一致，
 * 免得两边对"这条标签到哪儿为止"的看法不同、剥完还剩半截。
 */
const CALL_TAG_RE = /\[\[\s*ACTION\s*[:：]\s*CALL\s*(?:[:：|｜]\s*)?([\s\S]*?)\]\]/gu;

const VIDEO_WORDS = /^(?:video|视频|視頻|视讯|視訊|影片|v)$/iu;
const VOICE_WORDS = /^(?:voice|audio|语音|語音|电话|電話|通话|通話|a)$/iu;

/** 把首字段判成模式；判不出来就说明模型没写模式，整段都是开场白。 */
const readMode = (field: string): CallInviteMode | null => {
  const word = field.trim().replace(/[。．.!！?？，,]+$/u, '');
  if (VIDEO_WORDS.test(word)) return 'video';
  if (VOICE_WORDS.test(word)) return 'voice';
  return null;
};

const parseBody = (body: string): CallInvite | null => {
  // 竖线（半角/全角）是规范分隔符；模型偶尔写成逗号，只在首段恰好是模式词时才认，
  // 否则"喂，在吗"这种开场白会被从逗号处劈成两半。
  const parts = body.split(/[|｜]/u);
  const head = parts.length > 1 ? readMode(parts[0]) : null;
  if (head) {
    return { mode: head, opening: parts.slice(1).join('|').trim() };
  }
  const whole = body.trim();
  if (!whole) return null;
  // 没写分隔符但整段就是一个模式词：`[[ACTION:CALL|video]]`，开场白留空让它现编。
  const soloMode = readMode(whole);
  if (soloMode) return { mode: soloMode, opening: '' };
  // 缺省按语音。视频要开摄像头、要渲染立绘，是更重的打扰；模型没明确说要视频时
  // 不该替它选重的那个。
  return { mode: 'voice', opening: whole };
};

export const extractCallInvite = (text: string): ExtractedCallInvite => {
  if (!text || !text.includes('[[')) {
    return { cleanedText: text ?? '', invite: null, malformedCount: 0 };
  }
  let invite: CallInvite | null = null;
  let malformedCount = 0;
  const cleanedText = text.replace(CALL_TAG_RE, (_full, body: string) => {
    const parsed = parseBody(String(body ?? ''));
    // 一轮里吐了好几个只认第一个。多打几通电话没有任何语义，后面那些一律当噪音。
    if (parsed && !invite) invite = parsed;
    else if (!parsed) malformedCount += 1;
    return '';
  });
  return { cleanedText, invite, malformedCount };
};

/** 反向拼回标签 —— 给 worker directive 通道重放用（对齐 reconstructDirectiveTags 的写法）。 */
export const formatCallInviteTag = (invite: CallInvite): string =>
  `[[ACTION:CALL|${invite.mode}|${invite.opening}]]`;

// ─── 冷却 ────────────────────────────────────────────────────────────────

const COOLDOWN_KEY_PREFIX = 'sully-incoming-call-cooldown-v1:';

/** 纯判定，方便测；调用方拿 readLastCallAt() 喂它。 */
export const isCallCoolingDown = (lastAt: number | null, now: number = Date.now()): boolean =>
  lastAt != null && Number.isFinite(lastAt) && now - lastAt < INCOMING_CALL_COOLDOWN_MS;

export const readLastCallAt = (charId: string): number | null => {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY_PREFIX + charId);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null; // 隐私模式 WebView：读不到就当没冷却，宁可多响一次也不要哑火
  }
};

export const markCallFired = (charId: string, at: number = Date.now()): void => {
  try { localStorage.setItem(COOLDOWN_KEY_PREFIX + charId, String(at)); } catch { /* 同上 */ }
};

// ─── 待接来电（进程内单例） ───────────────────────────────────────────────

export interface PendingIncomingCall extends CallInvite {
  charId: string;
  charName: string;
  charAvatar?: string;
  /** 角色说"我打给你"那一刻（ms）。补收路径传 push 的 sentAt。 */
  ringAt: number;
}

/**
 * 为什么用模块级单例而不是往 OSContext 里加 state：
 * 来电要能从三个互相够不着的地方发起——前台聊天的后处理、推送补收的 runtime、
 * service worker 点通知回来的那一下。它们都不在 React 树里。挂在 OSContext 上就得
 * 让这三处各自想办法拿到 dispatch，等于把一个 5000 行的热点文件再改三处；
 * 单例 + window 事件是 activeMsgRuntime 已经在用的同一条路子。
 */
let pending: PendingIncomingCall | null = null;

export const getPendingIncomingCall = (): PendingIncomingCall | null => pending;

export const clearPendingIncomingCall = (): void => { pending = null; };

/**
 * 一通来电"过期"的界线。
 *
 * 离线补收会把角色说话的时刻和你打开 App 的时刻拉开几小时：昨晚十一点那句"我打给你"
 * 不该在今天中午突然响起来。超过这个岁数的一律不响，直接记一条未接来电——那也正是
 * 现实里发生的事（它打了，你没在）。
 */
export const STALE_CALL_MS = 3 * 60 * 1000;

export type IncomingCallResult =
  /** 正在响 */
  | 'ringing'
  /** 冷却期内，这通不响也不记未接（它压根不该打这一通） */
  | 'cooldown'
  /** 已经在响别人的电话了 */
  | 'busy'
  /** 补收来的旧电话：不响，但调用方应当记一条未接来电 */
  | 'stale';

/**
 * 发起一通来电。
 *
 * 落冷却戳放在这里而不是"接听时"：没接的电话也是打扰，也该占用配额，否则用户不接
 * 就会被连着打。
 */
export const requestIncomingCall = (
  call: Omit<PendingIncomingCall, 'ringAt'> & { ringAt?: number },
): IncomingCallResult => {
  const now = Date.now();
  const ringAt = call.ringAt ?? now;
  if (isCallCoolingDown(readLastCallAt(call.charId), now)) {
    console.log('[IncomingCall] ⏳ 冷却中，这通电话不响了:', call.charId);
    return 'cooldown';
  }
  // 已经在响一通了（多角色同时到点）——先来的那通留着，后到的丢掉。
  if (pending) {
    console.log('[IncomingCall] ⏳ 已有一通在响，跳过:', call.charId);
    return 'busy';
  }
  if (now - ringAt > STALE_CALL_MS) {
    console.log('[IncomingCall] ⏳ 这是补收回来的旧电话，只记未接:', call.charId);
    markCallFired(call.charId, now);
    return 'stale';
  }
  pending = { ...call, ringAt };
  markCallFired(call.charId, now);
  try {
    window.dispatchEvent(new CustomEvent(INCOMING_CALL_EVENT, { detail: pending }));
  } catch { /* 非浏览器环境（测试/worker）：暂存写好就行 */ }
  return 'ringing';
};
