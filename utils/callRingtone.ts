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

import { appendDevDebugLog } from './devDebug';

/** 响多久没人接算未接。真手机是 30 秒左右，照抄。 */
export const RING_TIMEOUT_MS = 30_000;

/**
 * 预解锁最多允许"悬着"多久。
 *
 * 播的是内联静音 data URI，正常情况下 play() 的 promise 会立刻 settle。这个兜底是为了
 * 防 promise 永远不 settle 的极端情况——那会让 `priming` 一直是 true，真来电就永远
 * 被判成"已经在响"。宁可提前收工：解锁在 play() 被调用那一刻就已经拿到了。
 */
const PRIME_GUARD_MS = 1_000;

/** 震动节奏（安卓有效；iOS Safari 直接忽略 navigator.vibrate，不是 bug）。 */
const VIBRATE_PATTERN = [400, 200, 400, 1400];
const VIBRATE_INTERVAL_MS = 2400;

const RINGTONE_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'sounds/incoming-call.mp3')
  .replace(/([^:])\/\/+/g, '$1/');

/**
 * 预解锁**专用**的音源：0.05 秒、8kHz 单声道、全零采样的内联 WAV。
 *
 * ## 这就是「幽灵铃声」的根因
 *
 * 旧版 `primeRingtone()` 是拿**真铃声 mp3** 去做静音预播放的（`el.muted = true` 后
 * `el.play()`，等 promise settle 再 pause）。问题在于 iOS 上这条路两个闸门都不可靠：
 *
 *  - `volume` 在 iOS 的 HTMLMediaElement 上**直接被忽略**（只读，写了没用）；
 *  - `muted` 在「同一个用户手势里刚设 true 就 play()」这条路上会漏——WebKit 实测会先
 *    出声，过一小会儿才真正静音。
 *
 * 于是就有了那个折磨了十几轮的现象：**没有来电界面、没有 `start` 日志，却听得见铃声**。
 * 响多久完全取决于 `play()` 的 promise 什么时候 settle：
 *
 *  - settle 得快 → 只漏 1 秒左右（对应用户说的「响一下就断」）；
 *  - settle 得慢（首次要下载/解码 mp3）→ 一路播到 `pause()` 才停（对应「响十几秒」）；
 *  - promise 迟迟不 settle → mp3 自己播完（`loop` 是 false）→ 「响几十秒后自动停」。
 *
 * 第 12/13 轮那条 `pausedBefore: true, currentTimeBefore: 2.58` 的日志正是这件事的指纹：
 * 元素最终确实是暂停的，但播放位置已经前进了 2.58 秒——那 2.58 秒就是用户听到的声音。
 *
 * ## 为什么换成静音 WAV 就能根治
 *
 * 解锁是**按元素**记的，跟具体播的是哪个 URL 无关。所以预解锁完全没必要碰真铃声：
 * 用同一个 Audio 元素播一段内联静音，iOS 照样把这个元素标记为「已被手势解锁」，
 * 而**就算 `muted` 彻底失效，用户能听到的也只有 0.05 秒的静音**。
 * 这不是再加一道兜底，是把「有声音可漏」这件事本身消掉。
 *
 * data URI 还顺带解决了时间窗：不走网络，不用等 mp3 下载，promise 立刻 settle。
 */
const SILENT_PRIME_URL = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * iOS PWA 偶尔会在快速重开时留下一个仍属于旧 document 的 JS/audio 实例。
 * 页面级 pagehide 只能停自己这一页；BroadcastChannel + storage 这道跨 document
 * 闸用来通知同源旧页也停掉，不碰正常来电的展示逻辑。
 */
const RINGTONE_CONTROL_CHANNEL = 'sully-incoming-call-ringtone-v2';
const RINGTONE_STOP_STORAGE_KEY = 'sully-incoming-call-ringtone-stop-v2';
const RINGTONE_INSTANCE_ID = Math.random().toString(36).slice(2);

let audio: HTMLAudioElement | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let vibrateTimer: ReturnType<typeof setInterval> | null = null;
let primed = false;
let ringtoneChannel: BroadcastChannel | null = null;
let audioEpoch = 0;
/**
 * 正在跑预解锁的那一小段时间。元素此刻确实 `!paused`，但播的是静音 WAV，不是来电。
 * `isRinging()` 必须把它排除掉，否则刚好这时到达的真来电会被 Overlay 当成"已经在响"
 * 而直接 return：界面亮着、没有声音、也没有看门狗，那通电话会永远挂在那儿。
 */
let priming = false;

/**
 * 当前是否有一通**合法的、上层还在等它的**来电正在响。
 *
 * ## 为什么必须有这个标志
 *
 * 第 10/13/15 轮为了扑幽灵铃声，在 `pageshow` / `focus` / `visibilitychange` 上全都挂了
 * 无条件的 `stopRingtone()`。而 `stopRingtone()` 里有一行 `clearTimers()`——**它会把
 * 看门狗一起干掉**。合并窗口只有 2 秒，iOS 冷启动 / 从通知横幅进来时这几个事件会拖上
 * 好几秒才陆续到齐，于是：
 *
 *   一通刚开始响的真来电 → 2 秒后一个迟到的 `focus` → 铃声和看门狗一起没了
 *   → 来电界面永远挂在那儿，永远不会变成未接来电。
 *
 * 8/24 实测复现的正是这一串：后台点横幅接的那通没有响铃，之后每一通都不响，
 * 前台放着不接超过一分钟也不落未接来电。第一通之所以正常，只是它那 30 秒窗口里
 * 恰好没落进生命周期事件。
 *
 * 幽灵铃声的根因（预解锁播真铃声）已经拔掉了，这些"逢事件必硬停"的锤子就只剩误伤。
 * 现在改成：**有合法来电在响时，生命周期事件只许暂停/恢复声音，绝不许碰看门狗。**
 *
 * 这个标志不会卡死：看门狗最迟 `RING_TIMEOUT_MS` 就会 `stopRingtone()` 把它清掉，
 * 所以它的生命周期有硬上界。
 */
let ringActive = false;

/**
 * 单例元素当前是否真的挂着铃声源。
 *
 * ## 为什么必须自己记一个标志，而不能读 `currentSrc` / `src`
 *
 * 第 15 轮的"硬销毁"用 `removeAttribute('src')` + `load()` 去切断 iOS 的底层媒体管线。
 * 之后 WebKit 会把元素打成 `networkState = NETWORK_NO_SOURCE(3)`，
 * **但 `currentSrc` 里仍然残留着旧的 mp3 URL**。
 *
 * 旧的 `getAudio()` 恰恰是拿这个字符串判断"要不要把源接回来"：
 *
 * ```ts
 * } else if (!(audio.currentSrc || audio.src).includes('incoming-call.mp3')) { ... }
 * ```
 *
 * 残留值让这个条件永远为 false ⇒ **第一通电话之后，音源再也不会被接回来**，
 * `play()` 落在一个 NO_SOURCE 的空元素上：来电界面正常、看门狗正常、就是一点声音都没有；
 * 冷启动重开 App 会 `new Audio(RINGTONE_URL)`，所以第一通永远是正常的。
 *
 * 8/24 实机日志里那条 `networkStateBefore: 3` 配着 `srcBefore: ".../incoming-call.mp3"`
 * 就是这个状态的指纹——两者本不该同时成立。
 */
let srcAttached = false;

/**
 * 这条专项日志故意复用 lifecycle 分类：用户不需要再记一个新开关。
 * 只记铃声状态和事件来源，不记角色名、开场白或聊天正文。
 */
const logRingtone = (event: string, data: Record<string, unknown> = {}): void => {
  appendDevDebugLog('lifecycle', {
    label: `[callRingtone] ${event}`,
    data: {
      event,
      visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
      ...data,
    },
  });
};

const stopDomRingtoneAudios = (): void => {
  if (typeof document === 'undefined') return;
  try {
    document.querySelectorAll('audio').forEach((candidate) => {
      const src = candidate.currentSrc || candidate.src || '';
      if (!src.includes('incoming-call.mp3')) return;
      try {
        candidate.muted = true;
        candidate.pause();
        candidate.currentTime = 0;
        candidate.loop = false;
        // iOS WebKit 偶尔会让 detached/hidden audio 在 pause() 后继续持有底层播放源。
        // 移除 src + load() 才会真正切断这条旧媒体管线。
        candidate.removeAttribute('src');
        candidate.load();
      } catch { /* 某些 WebView 对已销毁元素会抛异常 */ }
    });
  } catch { /* querySelectorAll 不可用时只停单例 */ }
};

const receiveCrossContextStop = (source?: unknown): void => {
  if (source === RINGTONE_INSTANCE_ID) return;
  // 本页正响着一通合法来电时不接受外部熔断：这道闸是用来清旧 document 的残留音的，
  // 不是用来掐掉用户眼前这通电话的（连带把看门狗清掉，那通电话就再也不会变未接）。
  if (ringActive) {
    logRingtone('cross-context-stop-ignored', { source, reason: 'ring-active' });
    return;
  }
  logRingtone('cross-context-stop-received', { source });
  stopRingtone();
  stopDomRingtoneAudios();
};

const ensureRingtoneChannel = (): BroadcastChannel | null => {
  if (ringtoneChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return ringtoneChannel;
  }
  try {
    ringtoneChannel = new BroadcastChannel(RINGTONE_CONTROL_CHANNEL);
    ringtoneChannel.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'hard-stop') receiveCrossContextStop(event.data.source);
    });
  } catch {
    ringtoneChannel = null;
  }
  return ringtoneChannel;
};

const broadcastCrossContextStop = (reason: string): void => {
  if (typeof window === 'undefined') return;
  const message = { type: 'hard-stop', reason, source: RINGTONE_INSTANCE_ID, at: Date.now() };
  try { ensureRingtoneChannel()?.postMessage(message); } catch { /* Safari 私有模式可能拒绝 */ }
  try { window.localStorage.setItem(RINGTONE_STOP_STORAGE_KEY, JSON.stringify(message)); } catch { /* 隐私模式 */ }
};

/** `HTMLMediaElement.networkState` 的两个"没有可用音源"取值。 */
const NETWORK_EMPTY = 0;
const NETWORK_NO_SOURCE = 3;

/**
 * 把铃声源接回单例元素。**只保留元素本身**，不 new 新的：iOS 的自动播放许可是按元素
 * 记的，每次切后台都换一个 Audio 就会把许可丢掉。
 */
const attachRingtoneSrc = (el: HTMLAudioElement): void => {
  try {
    el.src = RINGTONE_URL;
    el.load();
    srcAttached = true;
  } catch { /* 某些 WebView 对已销毁元素会抛异常 */ }
};

const getAudio = (): HTMLAudioElement | null => {
  if (typeof Audio === 'undefined') return null; // SSR / 测试环境
  if (!audio) {
    audio = new Audio(RINGTONE_URL);
    audio.preload = 'auto';
    (audio as any).playsInline = true;
    srcAttached = true;
    return audio;
  }
  // ⚠️ 这里**绝不能**再靠读 currentSrc / src 的字符串来判断（旧代码就是这么写的，
  // 那正是"第二通开始没有声音"的根因，见 srcAttached 的注释）。只信自己记的标志，
  // 外加一道用 networkState 兜底：WebKit 偶尔会把元素弄成 NO_SOURCE 而我们没记到。
  if (!srcAttached
    || audio.networkState === NETWORK_EMPTY
    || audio.networkState === NETWORK_NO_SOURCE) {
    attachRingtoneSrc(audio);
  }
  return audio;
};

const clearTimers = () => {
  if (watchdog != null) { clearTimeout(watchdog); watchdog = null; }
  if (vibrateTimer != null) { clearInterval(vibrateTimer); vibrateTimer = null; }
};

const stopVibration = (): void => {
  if (vibrateTimer != null) { clearInterval(vibrateTimer); vibrateTimer = null; }
  try { navigator.vibrate?.(0); } catch { /* iOS 没有这个 API */ }
};

const startVibration = (): void => {
  stopVibration();
  try {
    navigator.vibrate?.(VIBRATE_PATTERN);
    vibrateTimer = setInterval(() => {
      try { navigator.vibrate?.(VIBRATE_PATTERN); } catch { /* 同上 */ }
    }, VIBRATE_INTERVAL_MS);
  } catch { /* iOS 没有这个 API */ }
};

/**
 * 退到后台时的"软停"：只把声音按住，**不碰看门狗、不清 `ringActive`**。
 *
 * 跟 `stopRingtone()` 的区别就是这一点，而这一点正是 8/24 那个"永远不变未接来电"的
 * bug 的全部内容。用户没接就是没接，30 秒之后照样该落一条未接来电——哪怕这 30 秒里
 * 他一直在别的 App 里。
 */
const pauseRingtoneForBackground = (reason: string): void => {
  const el = audio;
  logRingtone('background-pause', {
    reason,
    hasAudio: !!el,
    pausedBefore: el?.paused,
    watchdogArmed: watchdog != null,
  });
  stopVibration();
  if (!el) return;
  try {
    el.muted = true;
    el.pause();
    el.currentTime = 0;
  } catch { /* 忽略 */ }
};

/** 回到前台，把那通还没被接/拒/超时的电话继续响起来。 */
const resumeRingtoneForForeground = (reason: string): void => {
  const el = getAudio(); // src 被清过的话这里会自动接回铃声文件
  logRingtone('background-resume', {
    reason,
    hasAudio: !!el,
    watchdogArmed: watchdog != null,
  });
  if (!el) return;
  try {
    el.loop = true;
    el.muted = false;
    el.volume = 0.85;
    try { el.currentTime = 0; } catch { /* 有些浏览器要等 metadata */ }
    void el.play().catch((err) => {
      logRingtone('resume-play-rejected', { name: err?.name, message: err?.message });
    });
  } catch { /* 忽略 */ }
  startVibration();
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
  priming = true;
  const primeEpoch = audioEpoch;
  // ⚠️ 这一段的每一行都是「幽灵铃声」的直接修复，改动前请先读 SILENT_PRIME_URL 上面那段注释。
  // 核心是：**预解锁期间元素上挂的绝不能是真铃声**。iOS 的 muted 不可靠、volume 干脆无效，
  // 所以唯一稳的做法是让「可漏出来的声音」本身就是静音。
  el.muted = true;   // 双保险：即使 muted 有效也没坏处，失效了也只是漏 0.05 秒静音
  try { el.loop = false; } catch { /* 忽略 */ }
  try { el.src = SILENT_PRIME_URL; el.load(); srcAttached = false; } catch { /* 忽略 */ }
  logRingtone('prime-start', {
    pausedBefore: el.paused,
    currentTimeBefore: el.currentTime,
    source: 'silent-wav',
  });

  let settled = false;
  let guard: ReturnType<typeof setTimeout> | null = null;
  const finishPrime = (event: string, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (guard != null) { clearTimeout(guard); guard = null; }
    // stopRingtone / startRingtone 都会推进 audioEpoch。promise 迟到时若已经易主，
    // **一个字都不能碰这个元素**：旧代码在这里无条件 pause()，正好会把刚开始响的
    // 真来电掐掉（对应用户遇到过的「响一下就没了」的另一半）。
    const stale = audio !== el || primeEpoch !== audioEpoch;
    if (stale) {
      logRingtone(event, { stale: true, skipped: true });
      return;
    }
    priming = false;
    try { el.pause(); el.currentTime = 0; } catch { /* 忽略 */ }
    el.muted = false;
    // 解锁已经拿到（按元素记，跟播的是哪个 URL 无关），把真铃声接回来预加载，
    // 真来电时才不用等首字节。
    attachRingtoneSrc(el);
    logRingtone(event, {
      currentTimeAfter: el.currentTime,
      pausedAfter: el.paused,
      stale: false,
      restored: (el.currentSrc || el.src).includes('incoming-call.mp3'),
      ...(error && typeof error === 'object'
        ? { name: (error as { name?: unknown }).name, message: (error as { message?: unknown }).message }
        : {}),
    });
  };
  // 兜底：promise 万一永远不 settle，也必须把 priming 放掉、把铃声源接回来。
  guard = setTimeout(() => finishPrime('prime-guard-timeout'), PRIME_GUARD_MS);
  try {
    const attempt = el.play();
    if (attempt) {
      void attempt
        .then(() => finishPrime('prime-play-resolved'))
        .catch((error) => finishPrime('prime-play-rejected', error));
    } else finishPrime('prime-play-no-promise');
  } catch (error) {
    finishPrime('prime-play-threw', error);
  }
};

/**
 * 真铃声是否正在响。**预解锁那 0.05 秒不算**（见 `priming`）。
 */
export const isRinging = (): boolean => (
  !priming && (ringActive || (!!audio && !audio.paused))
);

/**
 * 开响。`onTimeout` 是看门狗到点时的回调（上层据此记一条未接来电）。
 *
 * 用 muted 而不是 volume 做静音开关：volume 在两条代码路径之间来回改过一次之后
 * 就说不清当前该是多少了，muted 是个干净的布尔。
 */
export const startRingtone = (onTimeout: () => void): void => {
  const el = getAudio();
  logRingtone('start', {
    hasAudio: !!el,
    pausedBefore: el?.paused,
    currentTimeBefore: el?.currentTime,
    wasPriming: priming,
    // 下次再出"有界面没声音"时，这三个字段一眼就能看出音源到底接上没有。
    srcAttached,
    readyStateBefore: el?.readyState,
    networkStateBefore: el?.networkState,
  });
  // 推进 epoch：万一预解锁的 play() promise 还没 settle，它到点时会认出自己已经过期，
  // 从而**不会**去 pause 这通刚开始响的真来电。
  audioEpoch += 1;
  priming = false;
  // 从这一刻起，生命周期事件只许暂停/恢复声音，不许再碰看门狗（见 ringActive 的注释）。
  ringActive = true;
  clearTimers();
  if (el) {
    el.loop = true;
    el.muted = false;
    el.volume = 0.85;
    try { el.currentTime = 0; } catch { /* 有些浏览器要等 metadata */ }
    // 播放失败只记一行日志：自动播放被拦是预期内的一种结果，不是错误。
    void el.play().catch(err => {
      logRingtone('play-rejected', { name: err?.name, message: err?.message });
      console.log('[IncomingCall] 铃声被浏览器拦下（还没有任何手势解锁过它）:', err?.name || err);
    });
  }
  startVibration();

  watchdog = setTimeout(() => {
    // 兜底：不管上层发生了什么，响到这里就必须停。
    logRingtone('watchdog-timeout');
    stopRingtone();
    onTimeout();
  }, RING_TIMEOUT_MS);
};

/** 停响。**幂等**，随便谁、随便什么时候调都安全。 */
export const stopRingtone = (): void => {
  logRingtone('stop', {
    hasAudio: !!audio,
    pausedBefore: audio?.paused,
    currentTimeBefore: audio?.currentTime,
    loopBefore: audio?.loop,
    readyStateBefore: audio?.readyState,
    networkStateBefore: audio?.networkState,
    srcBefore: audio?.currentSrc || audio?.src,
    ringActiveBefore: ringActive,
  });
  clearTimers();
  priming = false;
  // 这是"这通电话到此为止"的语义（接听/拒接/超时/真正离开页面）。生命周期事件想要的
  // 只是"先别出声"，它们该走 pauseRingtoneForBackground，不该走这里。
  ringActive = false;
  try { navigator.vibrate?.(0); } catch { /* 不支持就算了 */ }
  const el = audio;
  if (!el) return;
  try {
    // `pause()` + `currentTime = 0` 在 iOS PWA 上不是绝对的硬停：旧 document
    // 可能还保留一个 detached media pipeline。静音、暂停、清源、load 四步一起做，
    // 把底层媒体管线切断，同时保留元素本身以免丢掉 iOS 的播放许可。
    el.muted = true;
    el.pause();
    el.loop = false;
    el.currentTime = 0;
    el.removeAttribute('src');
    el.load();
  } catch { /* 忽略 */ }
  // 源已经被摘掉了。必须自己记下来——WebKit 的 currentSrc 会残留旧 URL，读它会得出
  // "源还在"的错误结论，下一通电话就再也接不回音源了（见 srcAttached 的注释）。
  srcAttached = false;
  // 不丢掉 Audio 元素本身：iOS 的播放许可有时按元素记录。只清掉 src，
  // 下一次 getAudio() 会把同一个元素重新接回铃声文件。
  audioEpoch += 1;
};

/** 只给测试用：把单例清干净。 */
export const __resetRingtoneForTest = (): void => {
  clearTimers();
  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch { /* ignore */ }
  }
  audio = null;
  primed = false;
  priming = false;
  ringActive = false;
  srcAttached = false;
  audioEpoch += 1;
};

// PWA/WebView 可能在页面切换或整页退出时来不及跑 React effect cleanup。
// 主动把单例声音停掉，避免旧页面的 Audio 在用户重新进入 APP 后继续响到看门狗。
if (typeof window !== 'undefined') {
  ensureRingtoneChannel();
  try {
    window.addEventListener('storage', (event) => {
      if (event.key !== RINGTONE_STOP_STORAGE_KEY || !event.newValue) return;
      try {
        const message = JSON.parse(event.newValue) as { source?: unknown };
        receiveCrossContextStop(message.source);
      } catch { /* 忽略坏掉的旧标记 */ }
    });
  } catch { /* storage 事件不可用时仍保留 BroadcastChannel */ }

  // 新页面初始化时先通知旧页面停铃，再继续正常初始化。
  broadcastCrossContextStop('document-init');
  stopRingtone();
  stopDomRingtoneAudios();

  const stopOnPageExit = () => {
    logRingtone('page-exit-stop');
    broadcastCrossContextStop('page-exit');
    stopRingtone();
    stopDomRingtoneAudios();
  };
  window.addEventListener('pagehide', stopOnPageExit);
  window.addEventListener('beforeunload', stopOnPageExit);

  // iOS 可能把一次“回到 PWA”拆成 pageshow / focus / visibilitychange 三连事件，
  // 而且冷启动 / 从通知横幅进来时它们会拖上好几秒才陆续到齐。
  //
  // ⚠️ 8/24 实测炸过：这里原本是无条件 `stopRingtone()`，而 `stopRingtone()` 里的
  // `clearTimers()` 会把**看门狗一起干掉**。合并窗口只有 2 秒，于是一个迟到的 `focus`
  // 就能让一通刚开始响的真来电既没了声音、也永远不会变成未接来电——来电界面挂死。
  //
  // 现在分两种情况：
  //  - 有合法来电在响（`ringActive`）→ 只做暂停/恢复，**一个字都不碰看门狗**；
  //  - 没有（`ringActive` 为 false）→ 维持原来的硬停，继续清掉旧 document 的残留音。
  const RESUME_EVENT_COALESCE_MS = 2_000;
  let lastResumeStopAt = 0;
  const stopOnAppResume = () => {
    if (ringActive) {
      // 那通电话还没被接/拒/超时，用户刚回来——该继续响，而不是被清场。
      resumeRingtoneForForeground('app-resume');
      return;
    }
    const now = Date.now();
    if (now - lastResumeStopAt < RESUME_EVENT_COALESCE_MS) {
      logRingtone('resume-stop-coalesced');
      return;
    }
    lastResumeStopAt = now;
    logRingtone('resume-stop');
    broadcastCrossContextStop('app-resume');
    stopRingtone();
    stopDomRingtoneAudios();
  };
  window.addEventListener('pageshow', stopOnAppResume);
  window.addEventListener('focus', stopOnAppResume);

  // iOS 独立 PWA 退到后台时经常不会触发 pagehide/beforeunload，而是把整个 JS 页面冻结。
  // 若 Audio 仍在 loop，用户下次点开 App 会听到一通“上次的旧电话”从后台续播。
  // 所以不可见时仍然要把声音按住；但**只按声音**——看门狗必须继续跑，用户没接就是没接，
  // 30 秒后照样该落一条未接来电，哪怕这 30 秒他一直在别的 App 里。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (ringActive) {
        pauseRingtoneForBackground('visibility-hidden');
        return;
      }
      // 下一次恢复必须重新执行一次硬停，不能被之前的 pageshow 时间戳跳过。
      lastResumeStopAt = 0;
      logRingtone('visibility-hidden-stop');
      broadcastCrossContextStop('visibility-hidden');
      stopRingtone();
      stopDomRingtoneAudios();
      return;
    }
    logRingtone('visibility-visible');
    stopOnAppResume();
  });
}
