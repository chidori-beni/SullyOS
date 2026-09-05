/**
 * Shared MiniMax TTS utility — used by ChatApp, DateApp, and CallApp
 */
import { CharacterProfile, APIConfig } from '../types';
import { resolveMiniMaxApiKey } from './minimaxApiKey';
import { minimaxFetch } from './minimaxEndpoint';
import { hashTtsParams, getCachedTts, saveCachedTts } from './ttsCache';
import { normalizeVoiceTags } from './sanitize';
import { prepareNuojiSpeechText } from './nuojiSpeechText';

export const DEFAULT_MODEL = 'speech-2.8-hd';

/** MiniMax 官方只在这两个模型上实现 inline 语气词。 */
export const MINIMAX_INTERJECTION_MODELS = new Set([
  'speech-2.8-hd',
  'speech-2.8-turbo',
]);

export const resolveMiniMaxModel = (model?: string | null): string =>
  (model || '').trim() || DEFAULT_MODEL;

export const supportsMiniMaxInterjections = (model?: string | null): boolean =>
  MINIMAX_INTERJECTION_MODELS.has(resolveMiniMaxModel(model).toLowerCase());

// MiniMax 支持的语气标签 — 这些在 TTS 中会被正确演绎，必须保留
export const VALID_INTERJECTION_TAGS = new Set([
  'chuckle', 'laughs', 'sighs', 'coughs', 'clear-throat', 'groans',
  'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'snorts',
  'lip-smacking', 'humming', 'hissing', 'emm', 'burps', 'sneezes',
]);

/** 删除 MiniMax 语气声，但保留普通括号和暂停标记。用于不支持语气词的旧模型。 */
export const stripMiniMaxInterjectionTags = (text: string): string =>
  (text || '').replace(/\(([^)]{1,80})\)/g, (match, inner: string) =>
    VALID_INTERJECTION_TAGS.has(inner.trim().toLowerCase()) ? '' : match);

// LLM 可以写在 <语音 emotion="…"> 里的取值。其余/未知一律丢弃不传。
// 注意这不等于 MiniMax 的 API 枚举 —— 'calm' / 'fluent' 是本项目历史上教给模型的说法，
// MiniMax 那边并不认，送上去等于送了个非法值。发请求前一律过 normalizeEmotionForApi()。
export const VALID_EMOTIONS = new Set([
  'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral', 'calm', 'fluent',
]);

// MiniMax voice_setting.emotion 真正接受的枚举（整条一个值）。
export const MINIMAX_API_EMOTIONS = new Set([
  'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral',
]);

/**
 * 把「模型写出来的情绪」翻译成「MiniMax 认的情绪」。
 * - 枚举内的原样返回；
 * - calm / fluent 这两个 MiniMax 不认的，归到 neutral（平稳叙述，正是它们的本意）；
 * - 其余一律返回 undefined = 不带 emotion 字段，让 MiniMax 用自己的默认。
 * 这一步很关键：以前 calm/fluent 被原样送出去，而真正合法的 neutral 反而被白名单挡掉了。
 */
export const normalizeEmotionForApi = (raw?: string | null): string | undefined => {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return undefined;
  if (MINIMAX_API_EMOTIONS.has(v)) return v;
  if (v === 'calm' || v === 'fluent') return 'neutral';
  return undefined;
};

/**
 * 共享的「语音演出规范」——教 LLM 把台词写成能被 MiniMax 自然念出来的对白。
 * 聊天语音条 / 电话 / 约会复用同一份，避免各处各写一套、规则互相打架。
 *
 * 注意定位：这里只讲「怎么把字写得有呼吸、有情绪节奏」。具体的标签机制
 * （<语音> 标签怎么用、[emotion] 放哪、动作词白名单）由各调用点自己的
 * prompt 负责，本块不重复。客户端 insertSpeechBreaks 已经按标点自动插停顿
 * 并去重封顶 0.6s，所以 LLM 手写的 <#x#> 是「在情绪节点上额外加重」，不是
 * 唯一的停顿来源——这也是为什么强调「只在该停的地方停」。
 */
export const VOICE_ACTING_GUIDE = `### 让它听起来像活人在说话（重要）

你写的字会被原样念出来。目标不是"写一段通顺的话"，而是"写一段读出来有呼吸、有情绪起伏的对白"。读稿感、客服腔、新闻播报腔一旦出现就重写。

**1. 段与段之间要换气，别无缝冲。**
同一条语音里换行或停顿之后，如果还是你在继续说，第二段开头别一上来就冲进正题——加一个停顿、一个语气词或一次叹气当缓冲。
✅ 我知道你不是故意的。<#0.6#>只是……我还是会有点难过。
✅ (sighs) 算了。<#0.5#>听你的。
❌ 我知道你不是故意的。只是我还是会有点难过。（两句贴死，像棒读）
这些地方下一句开头尤其要缓一下：解释原因、情绪转折（吐槽转温柔 / 强硬转示弱 / 玩笑转认真）、沉默后再开口、安抚对方、委屈撒娇别扭的时候。

**2. 句子长短交错。** 一连串等长的句子是棒读的头号来源。让短句砸下来，让长句铺开。想强调某个词就拆开念："我。没。拿。"

**3. <#秒#> 停顿放在情绪节点，不要每句都塞。**
0.2 极短换气 / 0.3 轻顿 / 0.5 普通停顿 / 0.7 犹豫·叹息后停一下 / 1.0 明显沉默·震惊·压抑。
标记必须夹在能念的字之间（✅ 我没事。<#0.5#>只是有点累。）；别放在句首，也别两个标记连写（<#0.5#><#0.4#> 这种一定删一个）。

**4. 情绪不同，节奏不同：**
- 温柔安抚：慢、稳、短句多。"没事。<#0.6#>先别急着吓自己。"
- 委屈撒娇：语气软、停顿多一点但别太戏剧。"嗯……<#0.5#>你刚刚是不是又不理我。"
- 别扭傲娇：前半句嘴硬后半句放软，中间停一下。"哈。<#0.4#>你还真会折腾我。算了，<#0.5#>我帮你就是了。"
- 难过压抑：更慢、更多省略号、少用长句。"……我知道。<#0.8#>只是有点难受。"
- 紧张犹豫：断裂感，短停顿多。"等等。<#0.4#>我好像……<#0.5#>有点不确定。"
- 吐槽轻松：别太慢，轻微停顿即可。"行吧。<#0.3#>人类又发明了新的折磨方式。"

**5. 密度别失控。** 每 100 字里 <#x#> 大约 1–4 个、动作词 0–2 个。普通对话 2–4 句缓冲一次，强情绪 1–2 句一次。别整段全是同一个停顿值（会像坏掉的导航在念稿），也别连着堆同一个动作词。

（朗读语种不是中文时，上面示例里的中文语气词换成该语言里自然的叹词 / 填充词即可，呼吸和节奏的原理不变。）`;

// [happy]/【angry】… 这类情绪标签是给系统读取/设定 emotion 用的，绝不能被朗读或显示出来。
const EMOTION_TAG_RE = /[\[【]\s*(?:happy|sad|angry|fearful|disgusted|surprised|neutral|calm|fluent)\s*[\]】]/gi;
/** 移除文本里所有 [emotion] / 【emotion】 标记（任意位置），避免被朗读或显示。 */
export const stripEmotionTags = (text: string): string => (text || '').replace(EMOTION_TAG_RE, '');

/**
 * 把「只给 TTS 用」的演出标记从要显示给用户的文本里清掉。
 * <#秒#> 停顿标记和 (sighs)/(chuckle) 这类动作词是写给语音合成的，
 * 不应该原样出现在聊天气泡 / 转文字面板里（否则用户看到一堆 <#0.4#>）。
 * 只删白名单内的动作词；普通括号内容（比如正常的西文括注）保持不动。
 */
export const cleanVoiceMarkupForDisplay = (text?: string | null): string => {
  if (!text) return '';
  return text
    .replace(/<#\s*[\d.]+\s*#>/g, '')                 // 停顿标记 <#0.4#>
    .replace(/\(([^)]{1,40})\)/g, (m, inner: string) =>
      VALID_INTERJECTION_TAGS.has(inner.trim().toLowerCase()) ? '' : m) // 动作词，仅删白名单
    .replace(/[ \t]{2,}/g, ' ')                        // 合并多余空格
    .replace(/[ \t]+([，。！？、；：,.!?…])/g, '$1')    // 标点前残留空格
    .replace(/([，、；：,])\s*\1+/g, '$1')               // 删标记后留下的连续重复标点
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// 设计：不再做「中文舞台指示 → 语气标签」的猜测式映射（体验差、不可预测、有损）。
// 改为「教 LLM 直接写官方 sound tag」+「客户端只做白名单消毒」。
// 因此这里只保留一个合法标签白名单（上方 VALID_INTERJECTION_TAGS），不保留任何中→英映射表。

/**
 * 消毒括号内容（不做任何映射，只做白名单）：
 * - 中文舞台指示（……）一律删除，绝不读出来；
 * - 西文括号仅保留合法 sound tag（如 (laughs)），其余删除。
 * LLM 现在被要求直接写官方英文 sound tag，所以这里不再翻译中文提示词。
 */
const stripParensPreservingTags = (text: string): string => {
  return stripEmotionTags(text)
    // 中文括号舞台指示：一律删除
    .replace(/（[^）]{0,48}）/g, '')
    // 西文括号：仅保留白名单 sound tag，其余删除
    .replace(/\(([^)]{1,80})\)/g, (_m, inner: string) => {
      const tag = inner.trim().toLowerCase();
      return VALID_INTERJECTION_TAGS.has(tag) ? `(${tag})` : '';
    });
};

/**
 * Clean text for TTS — strip stage directions, system tags, and voice markup.
 * If <语音>...</语音> tag exists, use its content (already translated for TTS).
 * Otherwise, strip（parenthetical cues）so they aren't read aloud.
 * Known interjection tags like (chuckle) / (sighs) are preserved.
 */
export const cleanTextForTts = (raw: string): string => {
  // 0. 语音标签自愈 — 历史坏数据 (未闭合/孤儿闭合/全角符号) 也要能解析出来
  raw = normalizeVoiceTags(raw);
  // 1. If <语音> tag exists (with or without emotion attribute), extract & use its content only
  const voiceTagMatch = raw.match(/<[语語]音[^>]*>([\s\S]*?)<\/\s*[语語]音\s*>/);
  if (voiceTagMatch) {
    return stripParensPreservingTags(voiceTagMatch[1]).replace(/\s+/g, ' ').trim();
  }

  let text = raw;
  // 2. Strip [[...]] system markers
  text = text.replace(/\[\[.*?\]\]/g, '');
  // 3. Strip %%BILINGUAL%% and everything after
  text = text.replace(/%%BILINGUAL%%[\s\S]*/i, '');
  // 4. Strip parenthetical cues (preserving valid interjection tags only)
  text = stripParensPreservingTags(text);
  // 5. Strip <语音>...</语音> / <字幕>...</字幕> tags if they somehow remain
  //    (字幕是显示用的中文对照, 绝不能被朗读)
  text = text.replace(/<[语語]音[^>]*>[\s\S]*?<\/\s*[语語]音\s*>/g, '');
  text = text.replace(/<字幕>[\s\S]*?<\/字幕>/g, '');
  // 6. Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
};

/**
 * 统一生成最终送入 MiniMax 的文本。
 * 语气词能力跟模型绑定：旧模型即使收到标签也不会演绎，先删掉避免被当作普通英文念出来。
 */
export const prepareMiniMaxTtsText = (text: string, model?: string | null): string => {
  const effectiveModel = resolveMiniMaxModel(model);
  const source = supportsMiniMaxInterjections(effectiveModel)
    ? text
    : stripMiniMaxInterjectionTags(text);
  return prepareNuojiSpeechText(source);
};

export interface ParsedVoiceOutput {
  /** Text OUTSIDE the <语音> tag — what shows in the chat bubble. */
  display: string;
  /** TTS-ready spoken text (sanitized: only whitelisted MiniMax sound tags kept). */
  speech: string;
  /**
   * Raw <语音> inner content, whitespace-collapsed only — square-bracket cues and
   * parens are PRESERVED. Fish Audio needs this so its native inline cues
   * ([happy]/[whispering]/[break]…) survive to the API; cleanTextForTtsFish does
   * the provider-appropriate cleaning downstream. Empty when no <语音> tag.
   */
  rawSpeech: string;
  /** Validated MiniMax emotion from the tag's emotion="…" attribute, or undefined. */
  emotion?: string;
  /** Whether a <语音> tag was present at all. */
  hasVoiceTag: boolean;
  /**
   * <字幕>…</字幕> 里的中文对照（外语语音模式下模型显式给出的翻译）。
   * 语音条「转文字」面板的翻译第一优先级用它 —— 有显式字幕就不用猜、不用调 LLM。
   */
  subtitle?: string;
}

// <语音 emotion="happy">…</语音> — emotion attribute optional, single/double/no quotes tolerated.
// 属性前空格可省 (<语音emotion=…> 也认), 闭合标签容许空格 / 简繁互换。
const VOICE_TAG_RE = /<[语語]音(?:[^>]*?emotion\s*=\s*["']?([a-zA-Z]+)["']?)?[^>]*>([\s\S]*?)<\/\s*[语語]音\s*>/;

/**
 * Parse an assistant message into display text + spoken text + emotion.
 * The single source of truth for the structured voice-output format that the
 * LLM is taught to emit. Invalid emotions are dropped (returns undefined) so a
 * malformed attribute can never reach the API.
 */
const SUBTITLE_BLOCK_RE = /<字幕>([\s\S]*?)<\/字幕>/;

export const parseVoiceOutput = (raw: string): ParsedVoiceOutput => {
  if (!raw) return { display: '', speech: '', rawSpeech: '', hasVoiceTag: false };
  // 语音标签自愈: 未闭合 / 孤儿闭合 / 全角符号 / 属性写歪, 先修再配对。
  // 新消息落库前 sanitize 已经修过, 这里主要救历史坏数据 + 非落库调用点 (电话/见面)。
  raw = normalizeVoiceTags(raw);
  const m = raw.match(VOICE_TAG_RE);
  if (!m) {
    // 没有语音标签: 落单的字幕标签剥掉留内文, 别把原始标签当正文
    return { display: raw.replace(/<\/?字幕>/g, '').trim(), speech: '', rawSpeech: '', hasVoiceTag: false };
  }
  const rawEmotion = (m[1] || '').trim().toLowerCase();
  const emotion = VALID_EMOTIONS.has(rawEmotion) ? rawEmotion : undefined;
  const speech = stripParensPreservingTags(m[2]).replace(/\s+/g, ' ').trim();
  // 不做 MiniMax 的括号/情绪标剥离，留给 cleanTextForTtsFish 按鱼声规则处理。
  const rawSpeech = m[2].replace(/\s+/g, ' ').trim();
  const subtitle = raw.match(SUBTITLE_BLOCK_RE)?.[1]?.trim() || undefined;
  // display = 语音块和字幕块之外的文字 (普通闲聊); 字幕单独走 subtitle 字段
  const display = raw
    .replace(/<[语語]音[^>]*>[\s\S]*?<\/\s*[语語]音\s*>/g, '')
    .replace(/<字幕>[\s\S]*?<\/字幕>/g, '')
    .trim();
  return { display, speech, rawSpeech, emotion, hasVoiceTag: true, subtitle };
};

/**
 * 停顿时长上限（秒）。日常对话里超过这个数就不像"换气"而像"卡住了"/"在演"，
 * 所以不管是这里自动插的还是模型自己手写的，最后都削到这个值以内。
 */
const MAX_BREAK_SECONDS = 0.5;

/** 为 TTS 文本插入 MiniMax 原生停顿标签 <#秒数#>，让语音有自然停顿
 * 停顿层次（从短到长）:
 *   ，、；  →  0.06s  微停（换气级）
 *   。！？  →  0.12s  句末停顿
 *   ——     →  0.18s  话题转折 / 拖长
 *   ……     →  0.35s  欲言又止 / 沉默感
 *   \n     →  0.25s  段落换气
 */
export const insertSpeechBreaks = (text: string): string => {
  if (!text) return '';
  return text
    // 省略号：欲言又止 / 犹豫
    .replace(/[…]{2,}/g, '……<#0.45#>')          // 多个省略号连用，更长
    .replace(/[…]/g, '…<#0.35#>')               // 单个省略号
    .replace(/\.{3,}/g, '...<#0.35#>')           // 英文省略号
    // 破折号：话题转折、语气拉长
    .replace(/——/g, '——<#0.22#>')
    .replace(/--/g, '--<#0.22#>')
    // 句末标点：句子之间留出真实呼吸（别让角色一口气赶完）
    .replace(/([。])/g, '$1<#0.22#>')
    .replace(/([！？!?])/g, '$1<#0.26#>')        // 感叹/疑问停顿更明显
    // 句中标点：换气
    .replace(/([，,])/g, '$1<#0.10#>')
    .replace(/([、；;：:])/g, '$1<#0.07#>')
    // 换行：段落间停顿
    .replace(/\n/g, '\n<#0.30#>')
    // 去重：相邻多个停顿标签只保留最长的那个（封顶 MAX_BREAK_SECONDS）
    .replace(/(<#[\d.]+#>[\s]*){2,}/g, (match) => {
      const times = [...match.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1]));
      const maxTime = Math.min(Math.max(...times), MAX_BREAK_SECONDS);
      return `<#${maxTime.toFixed(2)}#>`;
    })
    // 单独一个的也要封顶：上面那条只处理"连着好几个"的情况，模型自己手写的
    // <#1.0#> 会原样漏过去。日常对话里超过半秒的停顿听着就是"卡住了"，一律削平。
    .replace(/<#\s*([\d.]+)\s*#>/g, (_m, sec: string) => {
      const v = parseFloat(sec);
      if (!Number.isFinite(v)) return '';
      return `<#${Math.min(v, MAX_BREAK_SECONDS).toFixed(2)}#>`;
    })
    .trim();
};

/**
 * Soft-clamp a numeric value to keep it within a safe range.
 * Preserves direction and feel but prevents extreme spikes that sound unnatural.
 */
const softClamp = (value: number, limit: number): number => {
  if (Math.abs(value) <= limit) return value;
  // Beyond the limit, compress logarithmically — still moves in the same direction but tapers off
  const sign = value > 0 ? 1 : -1;
  const excess = Math.abs(value) - limit;
  return sign * (limit + Math.log1p(excess) * (limit * 0.15));
};

/** Build timber_weights & voice_modify extras from a voiceProfile */
export const buildTtsExtras = (vp: CharacterProfile['voiceProfile']) => {
  if (!vp) return {};
  const extras: any = {};
  const tw = vp.timberWeights;
  if (tw && tw.length > 1) {
    extras.timber_weights = (() => {
      const totalWeight = tw.reduce((sum: number, t: any) => sum + (t.weight || 0), 0);
      if (totalWeight === 0) return tw.map((t: any) => ({ voice_id: t.voice_id, weight: Math.round(100 / tw.length) }));
      const raw = tw.map((t: any) => ({ voice_id: t.voice_id, weight: Math.round((t.weight / totalWeight) * 100) }));
      const diff = 100 - raw.reduce((s: number, r: any) => s + r.weight, 0);
      if (diff !== 0) raw[0].weight += diff;
      return raw;
    })();
  }
  if (vp.voiceModify) {
    const vm: any = {};
    // Clamp voice_modify params to prevent extreme spikes (e.g. sudden shrill voice)
    // pitch: safe range ±40 (full API range is ±100)
    // intensity: safe range ±30 — this is the biggest culprit for sudden shrill spikes
    // timbre: safe range ±40
    if (vp.voiceModify.pitch) vm.pitch = Math.round(softClamp(vp.voiceModify.pitch, 40));
    if (vp.voiceModify.intensity) vm.intensity = Math.round(softClamp(vp.voiceModify.intensity, 30));
    if (vp.voiceModify.timbre) vm.timbre = Math.round(softClamp(vp.voiceModify.timbre, 40));
    if (vp.voiceModify.sound_effects) vm.sound_effects = vp.voiceModify.sound_effects;
    if (Object.keys(vm).length) extras.voice_modify = vm;
  }
  return extras;
};

/**
 * Build voice_setting fields (speed, vol, pitch, emotion) with safe ranges.
 * `emotionOverride` (validated MiniMax emotion, e.g. from a <语音 emotion="…"> tag)
 * wins over the character's static voiceProfile.emotion. Invalid values are ignored.
 */
export const buildVoiceSettings = (vp: CharacterProfile['voiceProfile'], emotionOverride?: string) => {
  const picked = (emotionOverride && VALID_EMOTIONS.has(emotionOverride))
    ? emotionOverride
    : (vp?.emotion || '');
  // 送 API 前统一归一化：calm/fluent → neutral，非法值 → 不带这个字段。
  const emotion = normalizeEmotionForApi(picked);
  return {
    // Clamp speed to 0.75–1.4 for natural human feel (API allows 0.5–2)
    speed: Math.max(0.75, Math.min(1.4, vp?.speed ?? 1)),
    vol: Math.max(0.3, Math.min(2, vp?.vol ?? 1)),
    // Clamp base pitch to ±8 semitones (API allows ±12) to avoid alien sound
    pitch: Math.max(-8, Math.min(8, vp?.pitch ?? 0)),
    // 注意：english_normalization **不在这里**。它是请求体的顶层参数，
    // 塞进 voice_setting 会被 MiniMax 忽略掉（糯叽机放在顶层，这边跟着改了）。
    ...(emotion ? { emotion } : {}),
  };
};

/** Convert hex audio from MiniMax to a playable Blob */
export const convertHexAudioToBlob = (hexAudio: string, mimeType = 'audio/mpeg'): Blob => {
  const cleanHex = hexAudio.trim().replace(/^0x/i, '');
  if (!cleanHex || cleanHex.length % 2 !== 0 || /[^\da-f]/i.test(cleanHex)) {
    throw new Error('MiniMax 返回的 HEX 音频数据格式异常');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return new Blob([bytes], { type: mimeType });
};

/** Fetch remote audio URL and return as Blob */
export const fetchRemoteAudioBlob = async (sourceUrl: string): Promise<Blob> => {
  const cacheBustedUrl = sourceUrl.includes('?')
    ? `${sourceUrl}&_ts=${Date.now()}`
    : `${sourceUrl}?_ts=${Date.now()}`;
  const response = await fetch(cacheBustedUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`音频下载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('音频下载为空文件');
  return blob;
};

/**
 * 合成选项。`forceRegenerate` / `speedJitter` 是「重新生成语音」（重 roll）用的：
 *
 * - forceRegenerate: 跳过本地 TTS 缓存直接请求 API。缓存是按「文本 + 全部语音参数」
 *   哈希的，文本和设置都没变时必然命中，重 roll 就会拿回一模一样的旧音频 ——
 *   这正是「点了重新生成但听起来没变」的原因。合成结果照常写回缓存（覆盖旧的）。
 * - speedJitter: 叠加在语速上的极小偏移（调用方用 ±0.02 这个量级）。MiniMax 不提供
 *   seed，同样的输入偶尔会返回完全一样的音频；这时调用方可以带一个听不出来的语速
 *   偏移再试一次，逼出另一条。正常合成不要传这个字段。
 */
export interface TtsSynthOptions {
  languageBoost?: string;
  groupId?: string;
  emotion?: string;
  forceRegenerate?: boolean;
  speedJitter?: number;
}

export interface TtsResult {
  /** Playable URL for <audio> — a blob: URL when `blob` is present, otherwise a remote MiniMax CDN URL */
  url: string;
  /** Raw audio blob when available. Null when we fell back to the remote URL (CORS / network). */
  blob: Blob | null;
}

/**
 * Call MiniMax TTS and return both the raw blob (if available) and a playable URL.
 * Prefer this variant when you need to persist audio to storage — the blob can be
 * written to IndexedDB so the audio survives page/component reloads.
 */
export async function synthesizeSpeechDetailed(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: TtsSynthOptions
): Promise<TtsResult> {
  const apiKey = resolveMiniMaxApiKey(apiConfig);
  if (!apiKey) throw new Error('缺少 MiniMax API Key');
  const vp = char.voiceProfile;
  if (!vp?.voiceId && (!vp?.timberWeights || vp.timberWeights.length === 0)) {
    throw new Error('角色未配置语音');
  }

  // 停顿改用糯叽机那套稀疏规则（见 nuojiSpeechText）：文本里已经有 <#x#> / (chuckle)
  // 就原样送、一个都不加；没有标记才在 …… 。！？ —— 和「逗号+转折连词」处插。
  // 原来的 insertSpeechBreaks 是每个标点都插、还叠在模型写的标记之上，
  // 同一个 speech-2.8-hd 在糯叽机自然、在这边夸张，主因就在这。
  const model = resolveMiniMaxModel(vp?.model);
  const processedText = prepareMiniMaxTtsText(text, model);

  const payload: any = {
    model,
    text: processedText,
    stream: false,
    voice_setting: {
      voice_id: vp?.voiceId || '',
      ...buildVoiceSettings(vp, options?.emotion),
    },
    audio_setting: { format: 'mp3' },
    // english_normalization 是**顶层**参数，不是 voice_setting 的字段。
    // 以前塞在 voice_setting 里，MiniMax 直接忽略 —— 数字/英文一直没被正常念。
    english_normalization: true,
    ...buildTtsExtras(vp),
  };
  // 重 roll 的语速微调：叠加后仍夹在 buildVoiceSettings 用的同一档安全区间内，
  // 保证「听不出快慢差别，但请求体不同」——既换到另一条音频，也不改变角色语速手感。
  if (options?.speedJitter) {
    payload.voice_setting.speed = Math.max(
      0.75,
      Math.min(1.4, (payload.voice_setting.speed ?? 1) + options.speedJitter),
    );
  }

  // Only set language_boost when an explicit voice language is chosen. Leaving it
  // unset keeps Chinese prosody stable (auto-detect made the tone wobble per line).
  if (options?.languageBoost) payload.language_boost = options.languageBoost;

  // Check the shared cache before hitting the network. Two call sites that
  // build the same payload get the same hash and reuse whichever one synthesized
  // the audio first — across sessions, across apps.
  const cacheKey = hashTtsParams({
    kind: 'minimax-t2a',
    text: payload.text,
    model: payload.model,
    voice_setting: payload.voice_setting,
    timber_weights: payload.timber_weights,
    voice_modify: payload.voice_modify,
    language_boost: payload.language_boost,
    audio_setting: payload.audio_setting,
  });
  // 重 roll 时跳过读缓存（写回照旧），否则拿回来的永远是同一条旧音频。
  if (!options?.forceRegenerate) {
    const cached = await getCachedTts(cacheKey);
    if (cached) {
      return { url: URL.createObjectURL(cached), blob: cached };
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-MiniMax-API-Key': apiKey,
  };
  if (options?.groupId) headers['X-MiniMax-Group-Id'] = options.groupId;

  const res = await minimaxFetch('/api/minimax/t2a', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `TTS 失败 (HTTP ${res.status})`);

  // Check MiniMax business-level error (can return HTTP 200 with status_code != 0)
  const baseResp = data?.base_resp;
  if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
    throw new Error(`TTS 业务错误: ${baseResp.status_msg || `status_code=${baseResp.status_code}`}`);
  }

  const audio = data?.data?.audio;
  if (!audio) {
    // Log full response for debugging
    console.error('[TTS] No audio in response:', JSON.stringify(data).slice(0, 500));
    throw new Error('TTS 返回无音频数据');
  }

  let blob: Blob;
  if (/^https?:\/\//i.test(audio.trim())) {
    try {
      blob = await fetchRemoteAudioBlob(audio.trim());
    } catch (e) {
      // fetch() may fail due to CORS when hitting MiniMax CDN directly;
      // return the raw URL so <audio src=...> can load it without CORS.
      console.warn('[TTS] fetchRemoteAudioBlob failed, returning remote URL directly', (e as any)?.message || e);
      return { url: audio.trim(), blob: null };
    }
  } else {
    blob = convertHexAudioToBlob(audio);
  }
  // Persist to the shared cache in the background — the next identical request
  // (same text + voice settings) will be served locally.
  saveCachedTts(cacheKey, blob).catch(() => { /* ignore */ });
  return { url: URL.createObjectURL(blob), blob };
}

/**
 * Call MiniMax TTS and return a playable URL. Thin wrapper around
 * `synthesizeSpeechDetailed` — use that variant when you also need the raw blob.
 */
export async function synthesizeSpeech(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: TtsSynthOptions
): Promise<string> {
  const { url } = await synthesizeSpeechDetailed(text, char, apiConfig, options);
  return url;
}
