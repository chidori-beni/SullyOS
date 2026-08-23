/**
 * 角色主动来电 —— 浏览器侧那一半：冷却、待接来电暂存、"从来电通知点进来"的窗口。
 *
 * **解析住在 utils/incomingCallParse.ts**（零依赖叶子，worker classifier 要引它）。
 * 这里转发一道，现有调用点不用改 import——同 scheduleChange.ts 之于 scheduleChangeParse.ts。
 */

export type {
  CallInvite,
  CallInviteMode,
  ExtractedCallInvite,
} from './incomingCallParse';
export { extractCallInvite, formatCallInviteTag } from './incomingCallParse';

import type { CallInvite } from './incomingCallParse';

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

// ─── "用户点了来电横幅" ───────────────────────────────────────────────────

const CALL_BANNER_OPEN_KEY = 'sully-incoming-call-opened-v1';

/**
 * 点了横幅之后多久之内还算"这一下是来接电话的"。
 *
 * 比自动响铃的 STALE_CALL_MS 宽得多，因为语义完全不同：自动响铃是系统替用户做主，
 * 隔夜的电话不该突然响；而点横幅是**用户自己按下的接听**，从点到 App 起来、补收跑完
 * 可能要好几秒甚至十几秒（冷启动 + 落库），这段时间不能把他刚按的那一下判成过期。
 */
export const CALL_BANNER_GRACE_MS = 10 * 60 * 1000;

/**
 * 记下"这一次进 App 是点来电横幅进来的"。
 *
 * 用 sessionStorage 而不是模块变量：冷启动时这面旗要跨过整个 App 初始化才被读到
 * （SW 的 postMessage / URL 参数 → 补收落库 → applyAssistantPostProcessing），
 * 中间但凡有一次模块重新求值，模块变量就没了。
 */
export const noteCallBannerOpened = (charId: string, at: number = Date.now()): void => {
  try { sessionStorage.setItem(CALL_BANNER_OPEN_KEY, JSON.stringify({ charId, at })); } catch { /* 隐私模式 */ }
};

/** 读并清掉。只认同一个角色——横幅是谁的电话，接的就是谁。 */
export const consumeCallBannerOpened = (charId: string, now: number = Date.now()): boolean => {
  try {
    const raw = sessionStorage.getItem(CALL_BANNER_OPEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { charId?: string; at?: number };
    if (parsed?.charId !== charId) return false;
    sessionStorage.removeItem(CALL_BANNER_OPEN_KEY);
    return typeof parsed.at === 'number' && now - parsed.at <= CALL_BANNER_GRACE_MS;
  } catch {
    return false;
  }
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
  // 用户刚在锁屏上点了这通电话的横幅 —— 那是一次明确的"接听"，冷却和过期都不该拦。
  // 拦下来的话，用户按了接听、App 起来了、然后什么都没发生，比不响还糟。
  const answeredFromBanner = consumeCallBannerOpened(call.charId, now);
  if (!answeredFromBanner && isCallCoolingDown(readLastCallAt(call.charId), now)) {
    console.log('[IncomingCall] ⏳ 冷却中，这通电话不响了:', call.charId);
    return 'cooldown';
  }
  // 已经在响一通了（多角色同时到点）——先来的那通留着，后到的丢掉。
  if (pending) {
    console.log('[IncomingCall] ⏳ 已有一通在响，跳过:', call.charId);
    return 'busy';
  }
  if (!answeredFromBanner && now - ringAt > STALE_CALL_MS) {
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
