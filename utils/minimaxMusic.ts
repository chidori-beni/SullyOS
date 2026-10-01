/**
 * MiniMax Music generation (music-2.6 / music-2.6-free).
 *
 * Reuses the same minimaxFetch + apiKey infrastructure that TTS uses, so
 * authentication / region routing / dev proxy / GitHub Pages bypass all just
 * work. Response shape mirrors TTS — hex-encoded audio in `data.audio`.
 *
 * Why this matters:
 *   - `music-2.6-free` is genuinely free for any account holding a MiniMax key
 *   - The user already filled their MiniMax key for TTS, so 0-config onboarding
 *   - 60s output cap (vs ACE-Step's 4 min) — fine for short demos
 */

import { APIConfig, SongLine, SongSheet } from '../types';
import { resolveMiniMaxApiKey } from './minimaxApiKey';
import { minimaxFetch } from './minimaxEndpoint';
import { convertHexAudioToBlob, fetchRemoteAudioBlob } from './minimaxTts';
import { DB } from './db';
import { getProxyWorkerUrl } from './proxyWorker';

// ── Types ──

export type MinimaxMusicModel = 'music-3.0' | 'music-2.6' | 'music-2.6-free';

export interface MinimaxMusicInput {
  model: MinimaxMusicModel;
  prompt: string;          // 1-2000 chars, comma-separated style description
  lyrics: string;          // 1-3500 chars, with [Verse]/[Chorus] markers
  isInstrumental?: boolean;
  /** When true and lyrics is empty, MiniMax auto-writes lyrics from prompt. */
  lyricsOptimizer?: boolean;
}

export interface MinimaxMusicResult {
  url: string;
  blob: Blob;
  mimeType: string;
  assetKey: string;
  cached: boolean;
  durationMs?: number;
}

// ── Cache (mirrors aceStepApi / ttsCache structure) ──

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function hashMinimaxMusicInputs(input: MinimaxMusicInput): string {
  return 'mmmusic_' + cyrb53(stableStringify(input));
}

interface CacheEntry { blob: Blob; mimeType: string; createdAt: number; lastUsedAt: number; }

async function getCached(key: string): Promise<CacheEntry | null> {
  try {
    const entry = (await DB.getAssetRaw(key)) as CacheEntry | null;
    if (!entry || !(entry.blob instanceof Blob)) return null;
    DB.saveAssetRaw(key, { ...entry, lastUsedAt: Date.now() }).catch(() => { /* ignore */ });
    return entry;
  } catch { return null; }
}

async function saveCached(key: string, blob: Blob, mimeType: string): Promise<void> {
  try {
    const now = Date.now();
    await DB.saveAssetRaw(key, { blob, mimeType, createdAt: now, lastUsedAt: now } as CacheEntry);
  } catch (e) { console.warn('[MiniMax music cache] save failed', e); }
}

/** Read previously-saved blob (used by Songwriting App on app reload). */
export async function loadMinimaxMusicBlob(assetKey: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const entry = await getCached(assetKey);
  if (!entry) return null;
  return { blob: entry.blob, mimeType: entry.mimeType };
}

// ── Lyric / prompt formatting ──

const GENRE_HINTS: Record<string, string> = {
  pop: 'pop', rock: 'rock', ballad: 'ballad, soft, emotional',
  rap: 'rap, hip-hop', folk: 'folk, acoustic',
  electronic: 'electronic, edm, synth', jazz: 'jazz, smooth',
  rnb: 'r&b, soul', free: '',
};
const MOOD_HINTS: Record<string, string> = {
  happy: 'upbeat, bright', sad: 'melancholy, sad',
  romantic: 'romantic, tender', angry: 'intense, aggressive',
  chill: 'chill, lo-fi, relaxed', epic: 'epic, cinematic',
  nostalgic: 'nostalgic, vintage', dreamy: 'dreamy, ambient',
};

/** Build a default prompt string from a song's genre/mood/bpm/key. */
export function buildMinimaxMusicPrompt(song: SongSheet): string {
  const parts: string[] = [];
  const g = GENRE_HINTS[song.genre]; if (g) parts.push(g);
  const m = MOOD_HINTS[song.mood]; if (m) parts.push(m);
  if (song.bpm && song.bpm > 0) parts.push(`${song.bpm} bpm`);
  if (song.key) parts.push(song.key.toLowerCase());
  return parts.join(', ');
}

// MiniMax expects capitalized section markers, slightly different from ACE-Step.
const SECTION_TAG: Record<string, string> = {
  'intro':      'Intro',
  'verse':      'Verse',
  'pre-chorus': 'Pre Chorus',
  'chorus':     'Chorus',
  'bridge':     'Bridge',
  'outro':      'Outro',
  // 'free' has no MiniMax-recognized tag; we just emit the raw lines.
};

/**
 * Convert SongLines to MiniMax-style lyric format. Skips draft lines so the
 * audio matches the booklet view.
 */
export function buildMinimaxMusicLyrics(lines: SongLine[]): string {
  const finalLines = lines.filter(l => !l.isDraft);
  if (finalLines.length === 0) return '';

  let out = '';
  let currentSection = '';
  for (const line of finalLines) {
    if (line.section !== currentSection) {
      currentSection = line.section;
      const tag = SECTION_TAG[currentSection];
      if (out) out += '\n\n';
      if (tag) out += `[${tag}]\n`;
    }
    out += `${line.content}\n`;
  }
  // MiniMax docs cap lyrics at 3500 chars. Leave a small buffer.
  return out.trim().slice(0, 3400);
}

// ── Public API ──

export interface SynthesizeOptions {
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  /** When true, skip the cache lookup and always make a fresh API call. */
  forceRegenerate?: boolean;
}

class AbortError extends Error {
  constructor() { super('aborted'); this.name = 'AbortError'; }
}

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AbortError();
};

const guessMimeFromUrl = (url: string): string => {
  const lower = url.toLowerCase().split('?')[0];
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
};

/**
 * Generate a song via MiniMax music_generation. Throws AbortError on signal
 * abort, or Error with a user-readable message on any failure.
 */
export async function synthesizeSongMinimax(
  input: MinimaxMusicInput,
  apiConfig: APIConfig,
  options: SynthesizeOptions = {},
): Promise<MinimaxMusicResult> {
  const { signal, onStatus } = options;
  const apiKey = resolveMiniMaxApiKey(apiConfig);
  if (!apiKey) throw new Error('请先在「设置」里填 MiniMax API Key');
  if (!input.prompt && !input.lyrics) throw new Error('风格描述和歌词至少需要一个');

  const cacheKey = hashMinimaxMusicInputs(input);
  if (!options.forceRegenerate) {
    const cached = await getCached(cacheKey);
    if (cached) {
      onStatus?.('cached');
      return {
        url: URL.createObjectURL(cached.blob),
        blob: cached.blob,
        mimeType: cached.mimeType,
        assetKey: cacheKey,
        cached: true,
      };
    }
  }

  onStatus?.('starting');
  checkAbort(signal);

  const payload: any = {
    model: input.model,
    prompt: input.prompt,
    lyrics: input.lyrics,
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
  };
  if (input.isInstrumental) payload.is_instrumental = true;
  if (input.lyricsOptimizer) payload.lyrics_optimizer = true;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-MiniMax-API-Key': apiKey,
  };
  if (apiConfig.minimaxGroupId) headers['X-MiniMax-Group-Id'] = apiConfig.minimaxGroupId;

  onStatus?.('processing');
  const res = await minimaxFetch('/api/minimax/music', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.base_resp?.status_msg || `Music API 失败 (HTTP ${res.status})`);
  }

  // MiniMax often returns HTTP 200 with a non-zero base_resp status for
  // business-level errors (rate limit / token plan required / etc.)
  const baseResp = data?.base_resp;
  if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
    throw new Error(`MiniMax 业务错误: ${baseResp.status_msg || `code=${baseResp.status_code}`}`);
  }

  const audio = data?.data?.audio;
  if (!audio) {
    console.error('[MiniMax music] no audio in response:', JSON.stringify(data).slice(0, 500));
    throw new Error('MiniMax 没返回音频数据');
  }

  onStatus?.('downloading');
  let blob: Blob;
  let mimeType = 'audio/mpeg';
  if (typeof audio === 'string' && /^https?:\/\//i.test(audio.trim())) {
    blob = await fetchRemoteAudioBlob(audio.trim());
    mimeType = guessMimeFromUrl(audio.trim());
  } else if (typeof audio === 'string') {
    blob = convertHexAudioToBlob(audio);
  } else {
    throw new Error('MiniMax 返回的 audio 字段格式异常');
  }

  saveCached(cacheKey, blob, mimeType).catch(() => { /* ignore */ });
  onStatus?.('done');

  const durationMs: number | undefined = data?.extra_info?.music_duration;

  return {
    url: URL.createObjectURL(blob),
    blob,
    mimeType,
    assetKey: cacheKey,
    cached: false,
    durationMs,
  };
}

// ── 腾讯云 TokenHub 转售的 MiniMax 音乐 ──
// MiniMax 官方 2026-08-20 起音乐接口不再对新用户开放（免费档停服），
// 腾讯云 TokenHub 还在卖同一套模型，约 ¥1/首，用户自己的 TokenHub Key 直连
// （2026-10-02 实测该端点 CORS 放行 *，浏览器可直接调，不用走 Worker）。
// 端点和 model 名来自 TokenHub 控制台的调用示例；成功响应长什么样文档没写，
// 这里按 MiniMax 原生格式（data.audio 为 hex 或 url）解析，再兼容几种常见变体，
// 都对不上时把原始响应前 300 字塞进报错，方便照着改。

export const TOKENHUB_MUSIC_URL = 'https://tokenhub.tencentmaas.com/v1/wand/minimax-music/generation';
export const TOKENHUB_MUSIC_MODEL = 'minimax-music-v3.0';

// TokenHub 默认回一个腾讯云 COS 的签名下载链接，但那个桶不带 CORS 头，
// 浏览器 fetch 必被拦（2026-10-02 实测：生成成功、下载 Load failed）。
// 所以请求里要 output_format: 'hex' 让音频直接装在响应里；万一 TokenHub
// 不认这个参数仍回链接，先直连试一次，再借代理 Worker 的 /replicate/file
// 代下载（worker/index.js 里白名单已放行 aigc-output-*.myqcloud.com）。
const downloadTokenHubAudio = async (audioUrl: string): Promise<Blob> => {
  try {
    return await fetchRemoteAudioBlob(audioUrl);
  } catch (directErr) {
    console.warn('[TokenHub music] direct download blocked, trying proxy worker', directErr);
  }
  const proxied = `${getProxyWorkerUrl()}/replicate/file?url=${encodeURIComponent(audioUrl)}`;
  const res = await fetch(proxied);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 150);
    throw new Error(`歌已生成，但下载被拦：直连被跨域拦截，代理 Worker 也失败 (HTTP ${res.status}) ${detail}`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('歌已生成，但代理 Worker 下载到的是空文件');
  return blob;
};

const pickTokenHubAudio = (data: any): string | null => {
  const candidates = [
    data?.data?.audio, data?.data?.audio_url, data?.data?.url,
    data?.audio, data?.audio_url, data?.url,
    data?.output?.audio, data?.output?.audio_url, data?.result?.audio, data?.result?.audio_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
};

export async function synthesizeSongTokenHub(
  input: Omit<MinimaxMusicInput, 'model'>,
  apiConfig: APIConfig,
  options: SynthesizeOptions = {},
): Promise<MinimaxMusicResult> {
  const { signal, onStatus } = options;
  const apiKey = (apiConfig.tokenHubApiKey || '').trim();
  if (!apiKey) throw new Error('请先在「设置」里填腾讯云 TokenHub API Key');
  if (!input.prompt && !input.lyrics) throw new Error('风格描述和歌词至少需要一个');

  const cacheKey = 'tokenhub_' + hashMinimaxMusicInputs({ ...input, model: TOKENHUB_MUSIC_MODEL as any });
  if (!options.forceRegenerate) {
    const cached = await getCached(cacheKey);
    if (cached) {
      onStatus?.('cached');
      return {
        url: URL.createObjectURL(cached.blob),
        blob: cached.blob,
        mimeType: cached.mimeType,
        assetKey: cacheKey,
        cached: true,
      };
    }
  }

  onStatus?.('starting');
  checkAbort(signal);

  const payload: any = {
    model: TOKENHUB_MUSIC_MODEL,
    prompt: input.prompt,
    lyrics: input.lyrics,
    lyrics_optimizer: !!input.lyricsOptimizer,
    output_format: 'hex',
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
  };
  if (input.isInstrumental) payload.is_instrumental = true;

  onStatus?.('processing');
  const res = await fetch(TOKENHUB_MUSIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  const rawText = await res.text();
  let data: any = null;
  try { data = JSON.parse(rawText); } catch { /* non-JSON */ }

  // TokenHub 网关错误：{ error: { message, message_zh, code } }
  const gwErr = data?.error;
  if (!res.ok || gwErr) {
    const msg = (typeof gwErr === 'object' ? (gwErr?.message_zh || gwErr?.message) : gwErr)
      || data?.base_resp?.status_msg
      || rawText.slice(0, 200)
      || `HTTP ${res.status}`;
    const code = typeof gwErr === 'object' && gwErr?.code ? ` [${gwErr.code}]` : '';
    throw new Error(`腾讯云出歌失败 (HTTP ${res.status})${code}: ${msg}`);
  }

  const baseResp = data?.base_resp;
  if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
    throw new Error(`腾讯云出歌业务错误: ${baseResp.status_msg || `code=${baseResp.status_code}`}`);
  }

  const audio = data ? pickTokenHubAudio(data) : null;
  if (!audio) {
    console.error('[TokenHub music] no audio in response:', rawText.slice(0, 1000));
    throw new Error(`腾讯云没返回音频，原始响应: ${rawText.slice(0, 300)}`);
  }

  onStatus?.('downloading');
  let blob: Blob;
  let mimeType = 'audio/mpeg';
  if (/^https?:\/\//i.test(audio)) {
    blob = await downloadTokenHubAudio(audio);
    mimeType = guessMimeFromUrl(audio);
  } else if (audio.startsWith('data:')) {
    blob = await (await fetch(audio)).blob();
    mimeType = blob.type || mimeType;
  } else {
    blob = convertHexAudioToBlob(audio);
  }

  saveCached(cacheKey, blob, mimeType).catch(() => { /* ignore */ });
  onStatus?.('done');

  return {
    url: URL.createObjectURL(blob),
    blob,
    mimeType,
    assetKey: cacheKey,
    cached: false,
    durationMs: data?.extra_info?.music_duration,
  };
}
