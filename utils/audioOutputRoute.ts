/**
 * audioOutputRoute.ts — iPhone / WebKit 「用过语音转文字之后角色语音变小声」的输出路由修复。
 *
 * 现象与根因
 * ----------
 * 只要页面调用过 `getUserMedia()`，iOS 的 AVAudioSession 就会进入
 * play-and-record 类别，输出端口跟着落到听筒（receiver）。此时：
 *
 *   - 把采集 track 设成 `enabled = false` 不会让会话失活；
 *   - 把 `navigator.audioSession.type` 写回 `'auto'` 只是「交还给 WebKit 决定」，
 *     WebKit 在刚采集过的会话上仍然会保留 play-and-record；
 *   - 于是下一条角色 TTS 继续从听筒出声，用户听起来就是「音量突然很小」。
 *
 * 用户手动把 PWA 上滑再滑回来之所以能修好，是因为切后台会真的让音频会话
 * **失活一次**，回前台重新激活时才按 playback 类别重新协商到扬声器。
 *
 * 这个模块做的事情，就是把那一次「上滑再滑回来」用代码复现：
 *
 *   1. 采集彻底结束之后，
 *   2. 把 `audioSession.type` 先打到 `auto` 再打到 `playback`（顺序不能反：
 *      旧实现是 `playback → auto`，最后停在 `auto`，等于又把决定权交回给
 *      仍然记着 play-and-record 的 WebKit）；
 *   3. 用一个**全新的、只输出的**静音音频元素真正启动一次播放，逼 WebKit
 *      重新激活会话并重新协商输出路由；
 *   4. 这个静音元素一直播到真正的角色语音开始播为止，中间不留「全静默」
 *      的空窗，避免会话又失活一次退回听筒。
 *
 * 对照素材：糯叽机 4.64（`【糯叽机】/糯叽机4.64.apk`，解包后 `assets/public/`）
 * 完全没有用 `navigator.audioSession`，但它常驻一个静音 keep-alive 音频元素
 * （BackgroundKeepAlive），录音开始时 pause、录音结束 500ms 后 resume。会话
 * 因此几乎从不失活，所以那边只需要在最开始滑一次就稳定了。本模块是同一思路
 * 的按需版本：只在真正采集过麦克风之后才踢一次，不常驻播放。
 *
 * 边界：网页层只能请求音频会话「类别」，无法调用原生
 * `AVAudioSession.overrideOutputAudioPort(.speaker)` 硬锁物理端口。这里是网页层
 * 的最佳努力，不能当成硬件路由已保证。
 * 参考：<https://bugs.webkit.org/show_bug.cgi?id=218012>
 */

export type WebAudioSessionType = 'auto' | 'playback' | 'play-and-record';

/** 静音兜底元素最长播多久（毫秒）。正常情况下真正的语音开始播时就会被停掉。 */
const PRIMER_MAX_HOLD_MS = 60_000;

/** 静音 WAV 的时长；循环播放，取 1 秒是为了不让 iOS 在循环点出现可听见的断档。 */
const PRIMER_CLIP_SECONDS = 1;

const getAudioSession = (): { type: WebAudioSessionType } | undefined => {
  try {
    return (navigator as Navigator & { audioSession?: { type: WebAudioSessionType } }).audioSession;
  } catch {
    return undefined;
  }
};

/** 当前 WebKit 音频会话类别；不支持该 API 时返回 undefined。 */
export const getAudioSessionType = (): WebAudioSessionType | undefined => {
  try { return getAudioSession()?.type; } catch { return undefined; }
};

/**
 * 写入音频会话类别。
 *
 * 在 WebKit 上「写入同一个值」并不是空操作：它会重新跑一次路由选择，还可能
 * 闪一下系统音量 HUD。所以默认带同值保护，只有刻意要触发重算时才 `force`。
 */
export const setAudioSessionType = (type: WebAudioSessionType, force = false): boolean => {
  try {
    const audioSession = getAudioSession();
    if (!audioSession) return false;
    if (!force && audioSession.type === type) return true;
    audioSession.type = type;
    return audioSession.type === type;
  } catch {
    return false;
  }
};

// ── 静音兜底元素 ──────────────────────────────────────────────────────────

let silentClipUrl: string | null = null;

/** 生成一段数字静音的 8bit / 8kHz 单声道 WAV data URL（约 1KB，运行时构造）。 */
const getSilentClipUrl = (): string | null => {
  if (silentClipUrl) return silentClipUrl;
  if (typeof btoa !== 'function' || typeof DataView === 'undefined') return null;
  const sampleRate = 8000;
  const frames = sampleRate * PRIMER_CLIP_SECONDS;
  const bytes = new Uint8Array(44 + frames);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);   // fmt chunk size
  view.setUint16(20, 1, true);    // PCM
  view.setUint16(22, 1, true);    // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);    // block align
  view.setUint16(34, 8, true);    // bits per sample
  ascii(36, 'data');
  view.setUint32(40, frames, true);
  bytes.fill(128, 44);            // 8bit PCM 的静音是 0x80，不是 0
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  silentClipUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return silentClipUrl;
};

const createAudioElement = (): HTMLAudioElement | null => {
  try {
    if (typeof Audio === 'function') return new Audio();
    if (typeof document !== 'undefined') return document.createElement('audio');
  } catch {
    // 某些 WebView / 测试环境暴露了 Audio 但不允许构造。
  }
  return null;
};

const markInlinePlayback = (audio: HTMLAudioElement) => {
  try {
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
  } catch { /* 非 DOM 环境 */ }
};

let primer: HTMLAudioElement | null = null;
let primerTimer: ReturnType<typeof setTimeout> | null = null;

/** 是否真的采集过麦克风。没采集过就不需要踢路由，免得平白闪音量 HUD。 */
let capturedSinceLoad = false;

/**
 * 每做一次路由重置就 +1。已经存在的播放元素可能仍然绑在旧的输出路由上，
 * 所以下一次播放要换一个新元素（见 `acquirePlaybackAudio`）。
 */
let routeGeneration = 0;
const elementGenerations = new WeakMap<HTMLAudioElement, number>();

export const stopSilentPlaybackPrimer = (): void => {
  if (primerTimer) { clearTimeout(primerTimer); primerTimer = null; }
  const audio = primer;
  primer = null;
  if (!audio) return;
  try { audio.pause(); } catch { /* ignore */ }
  try { audio.loop = false; } catch { /* ignore */ }
  try { audio.removeAttribute('src'); audio.load(); } catch { /* ignore */ }
};

const startSilentPlaybackPrimer = (): void => {
  stopSilentPlaybackPrimer();
  const audio = createAudioElement();
  if (!audio) return;
  const url = getSilentClipUrl();
  if (!url) return;
  markInlinePlayback(audio);
  audio.src = url;
  audio.loop = true;
  audio.muted = false;   // 会话必须真的在输出，元素本身不能静音；音频内容是数字静音
  audio.volume = 1;
  primer = audio;
  try {
    const attempt = audio.play();
    if (attempt && typeof attempt.then === 'function') {
      void attempt.catch(() => { if (primer === audio) stopSilentPlaybackPrimer(); });
    }
  } catch {
    if (primer === audio) stopSilentPlaybackPrimer();
  }
  primerTimer = setTimeout(() => stopSilentPlaybackPrimer(), PRIMER_MAX_HOLD_MS);
};

// ── 对外 API ──────────────────────────────────────────────────────────────

/** 采集即将开始：停掉静音兜底元素，别让它和 getUserMedia 抢会话。 */
export const noteAudioCaptureStarting = (): void => {
  capturedSinceLoad = true;
  stopSilentPlaybackPrimer();
};

/**
 * 采集结束后把输出路由踢回扬声器：`auto → playback`，再用全新静音元素
 * 真正激活一次会话。只有在本次加载真的采集过麦克风时才动手。
 */
export const restoreSpeakerAudioOutput = (): void => {
  if (!capturedSinceLoad) return;
  setAudioSessionType('auto', true);
  setAudioSessionType('playback', true);
  routeGeneration += 1;
  startSilentPlaybackPrimer();
};

/**
 * 真正的语音即将播放前调用：确认类别是 playback，但不重复踢路由。
 * 同值写入会被 `setAudioSessionType` 的保护挡掉，所以可以每次播放都调。
 */
export const prepareSpeakerPlayback = (): void => {
  setAudioSessionType('playback');
};

/**
 * 取回一个可以用来播放的 audio 元素。
 *
 * 上一次路由重置之前创建的元素可能仍绑在听筒路由上，所以这种情况下换一个
 * 新元素；否则沿用原来的，避免每次播放都新建元素、丢掉 iOS 的播放解锁状态。
 */
export const acquirePlaybackAudio = (current: HTMLAudioElement | null): HTMLAudioElement | null => {
  if (current && elementGenerations.get(current) === routeGeneration) return current;
  if (current) {
    try { current.pause(); } catch { /* ignore */ }
  }
  const audio = createAudioElement();
  if (!audio) return current;
  markInlinePlayback(audio);
  elementGenerations.set(audio, routeGeneration);
  return audio;
};

/** 真正的语音已经开始播：静音兜底元素完成使命，停掉。 */
export const notePlaybackStarted = (): void => {
  stopSilentPlaybackPrimer();
};

/** 仅供测试：把模块状态复位。 */
export const __resetAudioOutputRouteForTests = (): void => {
  stopSilentPlaybackPrimer();
  capturedSinceLoad = false;
  routeGeneration = 0;
  silentClipUrl = null;
};
