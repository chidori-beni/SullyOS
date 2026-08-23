// utils/amsgChatPresence.ts
/**
 * 同角色活跃会话租约（Heartbeat）— 纯常量、类型与解析/新鲜度判定。
 *
 * ⚠️ 叶子模块：会被 worker/amsg 打进 Cloudflare bundle，同时被浏览器侧
 * （amsgStateSync 的租约 timer / activeMsgClient 的 PUT）复用——不得 import
 * DB / React / 任何浏览器环境依赖（与 utils/amsg2ExpireGuard.ts 同一约束）。
 *
 * 语义：一轮真实用户消息进入生成流程时立即写 `amsg:char:<charId>/chat_presence`，
 * 等待角色回复期间每 2s 续租；成功/失败/中断后停止续租，远端值靠 45s TTL 自然失效。
 * 它只代表「正在和这个角色交互」，不是 App 在线状态。worker 对 expire AI 任务先检查
 * 新鲜租约，新鲜则 { skip: true }，再走 last-message 规则。
 */

export const AMSG_CHAT_PRESENCE_KEY = 'chat_presence';
export const CHAT_PRESENCE_HEARTBEAT_MS = 2_000;
export const CHAT_PRESENCE_TTL_MS = 45_000;

/**
 * 「要不要发 iOS 系统通知」专用的新鲜度窗口，比 CHAT_PRESENCE_TTL_MS 短得多。
 *
 * 为什么不能共用 45s 的 TTL：那个 TTL 是给「expire AI 任务」用的，宽一点无所谓——
 * 判错了最多是少发一条定时问候。但通知这件事判错的方向是**反的**：租约还没过期时
 * worker 认为「人还在前台」→ 不发 Push。用户按下发送后立刻切后台 / 划掉 App，
 * 云端回复通常 10~40 秒才到，全落在 45 秒窗口里 —— 结果就是**退到后台反而收不到通知**。
 *
 * 而「人已经走了」这个信号本身是不可靠的：iOS 上 App 被划掉时没有任何代码能跑，
 * 切后台时那次「我走了」的网络写也可能被系统掐断。所以不能指望显式下线信号，
 * 只能让**沉默本身**快速说明问题：心跳 2 秒一次，超过 5 秒没续上就当人已经离开。
 *
 * 5 = 心跳 2s × 2 + 1s 余量：允许丢一拍（网络抖动 / iOS 前台节流定时器），
 * 连丢两拍就退回系统通知。这个短窗口还会让“发完立即切后台、5 秒后收到回复”
 * 不会继续被旧前台租约压掉。
 */
export const CHAT_PRESENCE_PUSH_FRESH_MS = 5_000;

export interface AmsgChatPresence {
  v: 1;
  charId: string;
  /** 最近一次续租的 epoch ms。worker 以自己的 ctx.now 判断 TTL。 */
  activeAt: number;
  /** 最近一条真实用户消息，用于一次性任务的 anchor 规则。 */
  lastUserMessageAt: number | null;
}

export const parseAmsgChatPresence = (raw: string | undefined): AmsgChatPresence | null => {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.v === 1 && typeof value.charId === 'string' &&
      typeof value.activeAt === 'number' &&
      (value.lastUserMessageAt === null || typeof value.lastUserMessageAt === 'number')
      ? value as AmsgChatPresence : null;
  } catch {
    return null;
  }
};

/**
 * 「此刻页面确实开着」——只用于决定要不要发系统通知。
 *
 * 与 isFreshChatPresence 的差别只有窗口长短，判定方向一致：拿不准就返回 false，
 * 让调用方保留系统通知（漏一个横幅 = 用户以为角色没理他；多一个横幅只是小噪音）。
 */
export const isForegroundForPush = (
  value: AmsgChatPresence | null | undefined,
  charId: string,
  nowMs: number,
): boolean => Boolean(
  value && value.v === 1 && value.charId === charId &&
  value.activeAt > 0 &&
  value.activeAt <= nowMs + 10_000 && nowMs - value.activeAt <= CHAT_PRESENCE_PUSH_FRESH_MS,
);

export const isFreshChatPresence = (
  value: AmsgChatPresence | null | undefined,
  charId: string,
  nowMs: number,
): boolean => Boolean(
  value && value.v === 1 && value.charId === charId &&
  value.activeAt <= nowMs + 10_000 && nowMs - value.activeAt <= CHAT_PRESENCE_TTL_MS,
);
