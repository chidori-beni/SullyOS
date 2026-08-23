/**
 * 来电铃声 —— 一个**活在 React 之外**的单例。
 *
 * ## 为什么必须放在组件外面
 *
 * 8/23 连炸两次，两次都是同一个根源：铃声挂在 `IncomingCallOverlay` 里，而那个组件
 * **随时可能被卸载**——`PhoneShell` 在开机动画、数据加载中、**锁屏**这三种情况下都会
 * 提前 return，整棵子树连同 `<audio>` 一起消失。
 *
 * 一旦在响铃途中发生这件事：
 *  - `<audio>` 元素被摘出页面，**但它会继续播**（这一点跟直觉相反，是关键）；
 *  - React 在跑清理函数之前就把 ref 断开了，代码想停的时候已经拿不到那个元素；
 *  - 界面上什么都没有（组件都没了），用户听得见铃声却找不到任何按钮，
 *    只能把整个 App 划掉。
 *
 * 单例 + `new Audio()`（从不进 DOM）让这一整类问题**结构上不可能发生**：
 * 没有挂载/卸载，没有 ref 断开，没有元素替换，谁都能停它。
 *
 * ## 看门狗
 *
 * 除此之外还有一道兜底：一旦开响就同时挂一个定时器，到点无条件停。
 * 就算上层每一条路都失灵，铃声也绝不会响过这个时长。**声音是唯一一种
 * "程序出错了用户却关不掉"的故障**，值得为它单独加一层保险。
 */

/** 响多久没人接算未接。真手机是 30 秒左右，照抄。 */
export const RING_TIMEOUT_MS = 30_000;

/** 震动节奏（安卓有效；iOS Safari 直接忽略 navigator.vibrate，不是 bug）。 */
const VIBRATE_PATTERN = [400, 200, 400, 1400];
const VIBRATE_INTERVAL_MS = 2400;

const RINGTONE_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'sounds/incoming-call.mp3')
  .replace(/([^:])\/\/+/g, '$1/');

let audio: HTMLAudioElement | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let vibrateTimer: ReturnType<typeof setInterval> | null = null;
let primed = false;

const getAudio = (): HTMLAudioElement | null => {
  if (typeof Audio === 'undefined') return null; // SSR / 测试环境
  if (!audio) {
    audio = new Audio(RINGTONE_URL);
    audio.preload = 'auto';
    (audio as any).playsInline = true;
  }
  return audio;
};

const clearTimers = () => {
  if (watchdog != null) { clearTimeout(watchdog); watchdog = null; }
  if (vibrateTimer != null) { clearInterval(vibrateTimer); vibrateTimer = null; }
};

/**
 * 借一次用户手势把铃声"解锁"。
 *
 * iOS 的自动播放限制是**按元素**算的：聊天里放过语音，解锁的是语音那个元素，
 * 跟铃声这个毫无关系。所以第一版实测「电话打进来了但一点声音都没有」——
 * 这个元素从来没被任何手势碰过，play() 直接被拒。
 *
 * 静音播一下再停掉即可，之后它就一直是解锁状态。**正在响的时候不要调**
 * （会把真铃声掐掉），调用方自己守住这一点；这里再守一道。
 */
export const primeRingtone = (): void => {
  if (primed) return;
  const el = getAudio();
  if (!el) return;
  if (!el.paused) { primed = true; return; } // 已经在响，本身就是解锁状态
  primed = true;
  el.muted = true;
  const done = () => {
    try { el.pause(); el.currentTime = 0; } catch { /* 忽略 */ }
    el.muted = false;
  };
  try {
    const attempt = el.play();
    if (attempt) void attempt.then(done).catch(() => { el.muted = false; });
    else done();
  } catch {
    el.muted = false;
  }
};

export const isRinging = (): boolean => !!audio && !audio.paused;

/**
 * 开响。`onTimeout` 是看门狗到点时的回调（上层据此记一条未接来电）。
 *
 * 用 muted 而不是 volume 做静音开关：volume 在两条代码路径之间来回改过一次之后
 * 就说不清当前该是多少了，muted 是个干净的布尔。
 */
export const startRingtone = (onTimeout: () => void): void => {
  const el = getAudio();
  clearTimers();
  if (el) {
    el.loop = true;
    el.muted = false;
    el.volume = 0.85;
    try { el.currentTime = 0; } catch { /* 有些浏览器要等 metadata */ }
    // 播放失败只记一行日志：自动播放被拦是预期内的一种结果，不是错误。
    void el.play().catch(err => {
      console.log('[IncomingCall] 铃声被浏览器拦下（还没有任何手势解锁过它）:', err?.name || err);
    });
  }
  try {
    navigator.vibrate?.(VIBRATE_PATTERN);
    vibrateTimer = setInterval(() => {
      try { navigator.vibrate?.(VIBRATE_PATTERN); } catch { /* 同上 */ }
    }, VIBRATE_INTERVAL_MS);
  } catch { /* iOS 没有这个 API */ }

  watchdog = setTimeout(() => {
    // 兜底：不管上层发生了什么，响到这里就必须停。
    stopRingtone();
    onTimeout();
  }, RING_TIMEOUT_MS);
};

/** 停响。**幂等**，随便谁、随便什么时候调都安全。 */
export const stopRingtone = (): void => {
  clearTimers();
  try { navigator.vibrate?.(0); } catch { /* 不支持就算了 */ }
  const el = audio;
  if (!el) return;
  try {
    el.pause();
    el.loop = false;
    el.currentTime = 0;
  } catch { /* 忽略 */ }
};

/** 只给测试用：把单例清干净。 */
export const __resetRingtoneForTest = (): void => {
  clearTimers();
  audio = null;
  primed = false;
};
