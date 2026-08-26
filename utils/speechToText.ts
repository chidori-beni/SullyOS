/**
 * Unified speech-to-text (STT) — used by calls and user voice messages.
 *
 * Providers:
 *   - Web platform  → native `webkitSpeechRecognition` / `SpeechRecognition`
 *                     (zero dependency, streams interim results).
 *   - Capacitor app → `@capacitor-community/speech-recognition` (on-device capable),
 *                     loaded via dynamic import so it never enters the web bundle.
 *   - SiliconFlow   → MediaRecorder + /v1/audio/transcriptions, using either
 *                     SenseVoice Small or TeleSpeech ASR.
 *
 * The user speaks Chinese to the character by default, so the default recognition
 * language is zh-CN regardless of the character's TTS output language.
 */
import { Capacitor } from '@capacitor/core';

export type SttProvider = 'system' | 'siliconflow-sensevoice' | 'siliconflow-telespeech';

export interface SttOptions {
  provider?: SttProvider;
  apiKey?: string;
  /** Strip SenseVoice emotion/control tags and generated emoji. Defaults to true. */
  stripEmoji?: boolean;
  /** TeleSpeech temporary failures fall back to SenseVoice. Defaults to true. */
  fallbackToSenseVoice?: boolean;
}

export interface SttCallbacks {
  /** Fired repeatedly with the best-so-far transcript (interim + final). */
  onPartial?: (text: string) => void;
  /** Fired once with the final transcript when recognition settles. */
  onFinal?: (text: string) => void;
  /** Fired on any recognition error (already turned into a friendly message). */
  onError?: (message: string) => void;
  /** Fired when the session ends for any reason (success, error, or stop). */
  onEnd?: () => void;
  /** Fired as soon as microphone recording ends, before cloud transcription finishes. */
  onRecordingEnd?: () => void;
  /** Raw user recording, used to persist a playable outgoing voice message. */
  onAudio?: (blob: Blob, durationSeconds: number) => void;
  /** Non-fatal provider fallback notice. */
  onProviderFallback?: (message: string) => void;
}

export interface SttSession {
  /** Stop listening. Safe to call multiple times. */
  stop: () => void;
}

const isNative = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

const getWebCtor = (): any =>
  (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;

/** Whether voice input is usable in the current environment. */
export const isSttSupported = (provider: SttProvider = 'system'): boolean => {
  if (provider !== 'system') {
    return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof MediaRecorder !== 'undefined';
  }
  if (isNative()) return true; // plugin present; actual availability resolved at start()
  return !!getWebCtor();
};

const friendlyError = (raw: string): string => {
  if (/not-allowed|denied|permission/i.test(raw)) return '麦克风权限被拒绝，去系统设置里允许一下';
  if (/no-speech/i.test(raw)) return '没听清，再说一次？';
  if (/network/i.test(raw)) return '语音识别服务连不上，检查下网络';
  if (/aborted/i.test(raw)) return '';
  return raw || '语音识别出错了';
};

// 看门狗时长：开麦后这么久还没有任何音频/语音/结果信号，就判定这个浏览器的
// 在线识别后端不可用（国内套壳浏览器常见：有 webkitSpeechRecognition 对象、
// 麦克风也亮，但永远不返回结果、也不报错）。
const STT_WATCHDOG_MS = 7000;
const SILICONFLOW_TRANSCRIPTION_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const SILICONFLOW_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const SENSEVOICE_MODEL = 'FunAudioLLM/SenseVoiceSmall';
const TELESPEECH_MODEL = 'TeleAI/TeleSpeechASR';
const SENSEVOICE_TAG_RE = /<\|[^|>]+\|>/g;
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export const cleanSpeechTranscript = (text: string, stripEmoji = true): string => {
  const raw = String(text || '');
  if (!stripEmoji) return raw.trim();
  return raw
    .replace(SENSEVOICE_TAG_RE, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeApiKey = (value: string): string => value.trim().replace(/^Bearer\s+/i, '');

const chooseRecorderMimeType = (): string => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
};

const extensionForMime = (mime: string): string => {
  if (/mp4/i.test(mime)) return 'm4a';
  if (/ogg/i.test(mime)) return 'ogg';
  if (/wav/i.test(mime)) return 'wav';
  return 'webm';
};

class SiliconFlowSttError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SiliconFlowSttError';
  }
}

const readErrorMessage = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => '');
  if (!body) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(body);
    return String(parsed?.error?.message || parsed?.message || parsed?.data || body);
  } catch {
    return body.slice(0, 300);
  }
};

export const transcribeWithSiliconFlow = async (
  audio: Blob,
  provider: Extract<SttProvider, `siliconflow-${string}`>,
  apiKey: string,
  stripEmoji = true,
): Promise<string> => {
  const key = normalizeApiKey(apiKey);
  if (!key) throw new Error('请先到设置 → 其他 API 填写 SiliconFlow Key');
  if (!audio.size) throw new Error('没有录到声音，请再试一次');
  if (audio.size > SILICONFLOW_MAX_AUDIO_BYTES) throw new Error('录音超过 50MB，无法转写');

  const model = provider === 'siliconflow-telespeech' ? TELESPEECH_MODEL : SENSEVOICE_MODEL;
  const form = new FormData();
  form.append('file', audio, `recording.${extensionForMime(audio.type)}`);
  form.append('model', model);
  const response = await fetch(SILICONFLOW_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) {
    throw new SiliconFlowSttError(await readErrorMessage(response), response.status);
  }
  const data = await response.json();
  return cleanSpeechTranscript(data?.text || '', stripEmoji);
};

const shouldFallbackFromTeleSpeech = (error: unknown): boolean => {
  if (!(error instanceof SiliconFlowSttError)) return false;
  if (error.status === 401 || error.status === 403) return false;
  return error.status === 429 || error.status >= 500 || /overload|unavailable|timeout|繁忙|过载|限流/i.test(error.message);
};

// iOS PWA/WebKit can show the microphone prompt again when an app repeatedly
// calls getUserMedia() and immediately stops the returned track. A call is a
// single microphone session even though it contains many STT recordings, so
// keep one stream alive between turns and only release it when the caller
// leaves the call / closes the voice-message modal.
let siliconFlowMicrophone: MediaStream | null = null;
let siliconFlowMicrophoneRequest: Promise<MediaStream> | null = null;
let siliconFlowMicrophoneGeneration = 0;

type WebAudioSessionType = 'auto' | 'playback' | 'play-and-record';

/**
 * The route the user selected for role audio during a call.
 *
 * Web Audio has no portable "built-in speaker" / "receiver" sink id on iOS.
 * The closest control exposed to a PWA is the Audio Session category:
 * `playback` is the media/speaker attempt and `play-and-record` is the
 * phone-call/receiver attempt.  Keep this preference in one module so the
 * microphone boundary and every later TTS turn use the same choice.
 */
export type SiliconFlowAudioRoute = 'speaker' | 'receiver';
let siliconFlowAudioRoute: SiliconFlowAudioRoute = 'speaker';

const audioSessionTypeForRoute = (route: SiliconFlowAudioRoute): WebAudioSessionType =>
  route === 'speaker' ? 'playback' : 'play-and-record';

/**
 * Safari 16.4+ exposes a subset of the Audio Session API. Merely disabling a
 * live microphone track does not reliably leave the play-and-record category
 * on iPhone, so the next TTS turn can be routed through the receiver. Keep the
 * stream for permission reuse, but explicitly switch the system session at the
 * record/playback boundary whenever WebKit exposes the control.
 */
const setWebAudioSessionType = (type: WebAudioSessionType): boolean => {
  try {
    const audioSession = (navigator as Navigator & {
      audioSession?: { type: WebAudioSessionType };
    }).audioSession;
    if (!audioSession) return false;
    audioSession.type = type;
    return audioSession.type === type;
  } catch {
    return false;
  }
};

/**
 * Remember the user's route choice and apply it when WebKit exposes its
 * Audio Session API.  The preference is deliberately module-scoped: a TTS
 * request can finish after React has rendered another turn, so a stale
 * component closure must not silently restore the old route.
 */
export const setSiliconFlowAudioRoute = (route: SiliconFlowAudioRoute): void => {
  siliconFlowAudioRoute = route;
  // WebKit ends a live MediaStreamTrack as soon as the page changes to the
  // output-only `playback` category.  Once a call has acquired its reusable
  // microphone stream, keep the session in `auto` for the speaker route so the
  // permission/session survives the next turn.  `auto` preserves the current
  // hardware output route instead of silently forcing the receiver.
  setWebAudioSessionType(
    route === 'speaker' && hasLiveMicrophoneTrack(siliconFlowMicrophone)
      ? 'auto'
      : audioSessionTypeForRoute(route),
  );
};

export const getSiliconFlowAudioRoute = (): SiliconFlowAudioRoute => siliconFlowAudioRoute;

/** Reassert the selected media route immediately before call TTS playback. */
export const prepareSiliconFlowAudioPlayback = (): void => {
  setWebAudioSessionType(
    siliconFlowAudioRoute === 'speaker' && hasLiveMicrophoneTrack(siliconFlowMicrophone)
      ? 'auto'
      : audioSessionTypeForRoute(siliconFlowAudioRoute),
  );
};

/**
 * Reassert a capture-compatible category in the originating mic-button turn.
 * Once a call already owns a live reusable stream, `auto` is enough for
 * MediaRecorder and avoids an unnecessary `auto` → `play-and-record` route
 * transition (iOS can show the volume HUD for that transition even though the
 * user did not press a volume key).
 */
export const prepareSiliconFlowAudioCapture = (): void => {
  setWebAudioSessionType(
    siliconFlowAudioRoute === 'speaker' && hasLiveMicrophoneTrack(siliconFlowMicrophone)
      ? 'auto'
      : 'play-and-record',
  );
};

function hasLiveMicrophoneTrack(stream: MediaStream | null): stream is MediaStream {
  if (!stream) return false;
  return stream.getAudioTracks().some(track => track.readyState !== 'ended');
}

const prepareSiliconFlowMicrophone = (stream: MediaStream, preserveOutputRoute = false) => {
  setWebAudioSessionType(
    preserveOutputRoute && siliconFlowAudioRoute === 'speaker'
      ? 'auto'
      : 'play-and-record',
  );
  stream.getAudioTracks().forEach(track => {
    if (track.readyState === 'live') track.enabled = true;
  });
};

const pauseSiliconFlowMicrophone = (stream: MediaStream) => {
  // Disabling the track stops capture between turns while keeping the browser's
  // permission/session alive for the next recording.
  stream.getAudioTracks().forEach(track => {
    if (track.readyState === 'live') track.enabled = false;
  });
  // Restore the user's selected route for the role's next generated voice turn.
  // When the cached stream is still live, the speaker route deliberately uses
  // `auto`: WebKit's Audio Session spec ends capture tracks in `playback`, which
  // would turn every following tap into a fresh permission request.
  prepareSiliconFlowAudioPlayback();
};

const getSiliconFlowMicrophone = async (): Promise<MediaStream> => {
  if (hasLiveMicrophoneTrack(siliconFlowMicrophone)) {
    // The stream already passed the permission boundary. Keep the speaker
    // route in `auto` instead of toggling the Audio Session category again.
    prepareSiliconFlowMicrophone(siliconFlowMicrophone, true);
    return siliconFlowMicrophone;
  }
  if (siliconFlowMicrophoneRequest) return siliconFlowMicrophoneRequest;

  const generation = siliconFlowMicrophoneGeneration;
  let request: Promise<MediaStream>;
  // TTS playback deliberately leaves WebKit's AudioSession in `playback` so
  // role audio stays on the speaker. WebKit rejects getUserMedia while that
  // category is active, and the rejection happens before the returned
  // promise's `then()` can restore it. Switch to a recording-compatible
  // category before requesting the first stream; cached streams already take
  // this path in prepareSiliconFlowMicrophone().
  setWebAudioSessionType('play-and-record');
  request = navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).then(stream => {
    // If the owning call disappeared while the permission sheet was open, do
    // not leave a newly granted stream running in the background.
    if (generation !== siliconFlowMicrophoneGeneration) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('麦克风请求已取消');
    }
    siliconFlowMicrophone = stream;
    stream.getTracks().forEach(track => {
      track.addEventListener?.('ended', () => {
        if (siliconFlowMicrophone === stream) siliconFlowMicrophone = null;
      }, { once: true });
    });
    prepareSiliconFlowMicrophone(stream);
    return stream;
  }).finally(() => {
    if (siliconFlowMicrophoneRequest === request) siliconFlowMicrophoneRequest = null;
  });
  siliconFlowMicrophoneRequest = request;
  return request;
};

/** Release the cached SiliconFlow microphone when the call/modal is really closed. */
export const releaseSiliconFlowMicrophone = () => {
  siliconFlowMicrophoneGeneration += 1;
  const stream = siliconFlowMicrophone;
  siliconFlowMicrophone = null;
  siliconFlowMicrophoneRequest = null;
  stream?.getTracks().forEach(track => track.stop());
  // Leaving a call should not leave the whole PWA in a phone-call category.
  // The next call re-applies the remembered route before it plays/records.
  setWebAudioSessionType('auto');
};

const startSiliconFlow = async (
  cb: SttCallbacks,
  options: SttOptions,
): Promise<SttSession> => {
  const provider = options.provider === 'siliconflow-telespeech'
    ? 'siliconflow-telespeech'
    : 'siliconflow-sensevoice';
  const key = normalizeApiKey(options.apiKey || '');
  if (!key) throw new Error('请先到设置 → 其他 API 填写 SiliconFlow Key');
  if (!isSttSupported(provider)) throw new Error('当前环境不支持录音');

  const stream = await getSiliconFlowMicrophone();
  const mime = chooseRecorderMimeType();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let stopped = false;

  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    pauseSiliconFlowMicrophone(stream);
    cb.onRecordingEnd?.();
    const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
    const duration = Math.max(0.2, (Date.now() - startedAt) / 1000);
    cb.onAudio?.(blob, duration);
    try {
      let text: string;
      try {
        text = await transcribeWithSiliconFlow(blob, provider, key, options.stripEmoji !== false);
      } catch (error) {
        if (provider !== 'siliconflow-telespeech' || options.fallbackToSenseVoice === false || !shouldFallbackFromTeleSpeech(error)) throw error;
        cb.onProviderFallback?.('TeleSpeech 暂时不可用，已自动改用 SenseVoice 完成识别');
        text = await transcribeWithSiliconFlow(blob, 'siliconflow-sensevoice', key, options.stripEmoji !== false);
      }
      if (text) {
        cb.onPartial?.(text);
        cb.onFinal?.(text);
      } else {
        cb.onError?.('没有识别到文字，请靠近麦克风再试一次');
      }
    } catch (error: any) {
      cb.onError?.(friendlyError(error?.message || String(error)));
    } finally {
      cb.onEnd?.();
    }
  };
  recorder.onerror = () => cb.onError?.('录音失败，请检查麦克风权限');
  recorder.start(250);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
};

const startWeb = (lang: string, cb: SttCallbacks): SttSession => {
  const Ctor = getWebCtor();
  if (!Ctor) throw new Error('当前浏览器不支持语音识别');
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  // 持续聆听到用户手动停（贴合 UI 的「点麦克风结束」），别一遇停顿就自己断。
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  let ended = false;
  // 是否收到过识别器「活着」的信号（音频开始 / 检测到说话 / 出结果）。
  let gotSignal = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
  const markAlive = () => { gotSignal = true; clearWatchdog(); };

  rec.onaudiostart = markAlive;
  rec.onspeechstart = markAlive;
  rec.onresult = (e: any) => {
    markAlive();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    cb.onPartial?.((finalText + interim).trim());
  };
  rec.onerror = (e: any) => {
    const msg = friendlyError(String(e?.error || ''));
    if (msg) cb.onError?.(msg);
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    clearWatchdog();
    cb.onRecordingEnd?.();
    const f = finalText.trim();
    if (f) cb.onFinal?.(f);
    cb.onEnd?.();
  };
  rec.start();
  // 若在看门狗时限内识别器毫无生命迹象，多半是这个浏览器没有可用的在线识别
  // 服务（套壳浏览器/缺 Google 服务的 WebView）。明确告诉用户，别让麦克风空亮。
  watchdog = setTimeout(() => {
    if (gotSignal || ended) return;
    cb.onError?.('这个浏览器识别不到语音，多半不支持在线语音识别（国内套壳浏览器常见）。换 Chrome / Edge，或者直接打字吧。');
    try { rec.stop(); } catch { /* ignore */ }
  }, STT_WATCHDOG_MS);
  return { stop: () => { clearWatchdog(); try { rec.stop(); } catch { /* ignore */ } } };
};

const startNative = async (lang: string, cb: SttCallbacks): Promise<SttSession> => {
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');

  const perm = await SpeechRecognition.checkPermissions().catch(() => ({ speechRecognition: 'prompt' as const }));
  if (perm.speechRecognition !== 'granted') {
    const req = await SpeechRecognition.requestPermissions();
    if (req.speechRecognition !== 'granted') throw new Error('麦克风权限被拒绝');
  }

  let lastPartial = '';
  let ended = false;
  const handle = await SpeechRecognition.addListener('partialResults', (data: any) => {
    const m = data?.matches?.[0];
    if (m) { lastPartial = m; cb.onPartial?.(m); }
  });

  const finish = (finalText: string, errMsg?: string) => {
    if (ended) return;
    ended = true;
    handle.remove();
    cb.onRecordingEnd?.();
    if (errMsg) cb.onError?.(friendlyError(errMsg));
    else if (finalText) cb.onFinal?.(finalText);
    cb.onEnd?.();
  };

  // With partialResults: true, start() resolves once recognition settles.
  SpeechRecognition.start({ language: lang, partialResults: true, popup: false, maxResults: 1 })
    .then((res: any) => finish((res?.matches?.[0] || lastPartial || '').trim()))
    .catch((e: any) => finish('', e?.message || 'native-error'));

  return { stop: () => { SpeechRecognition.stop().catch(() => { /* ignore */ }); } };
};

/**
 * Start a speech-to-text session. Resolves to a handle you can `stop()`.
 * All transcripts arrive via the callbacks.
 */
export const startStt = async (lang: string, cb: SttCallbacks, options: SttOptions = {}): Promise<SttSession> => {
  const language = lang || 'zh-CN';
  if (options.provider && options.provider !== 'system') return startSiliconFlow(cb, options);
  if (isNative()) return startNative(language, cb);
  return startWeb(language, cb);
};
