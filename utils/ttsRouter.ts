/**
 * TTS 服务商路由：按 apiConfig.ttsProvider 分发到 MiniMax、鱼声 Fish Audio 或 ElevenLabs。
 *
 * 聊天语音条（Chat）、约会（DateSession）直接用这里的 synthesizeSpeech(Detailed)，
 * 不必关心底层是哪家。CallApp 因为要做分句流式 + 缓存键对齐，单独在自己内部分支。
 */
import { CharacterProfile, APIConfig } from '../types';
import {
  synthesizeSpeechDetailed as minimaxSynthesizeDetailed,
  cleanTextForTts,
  cleanVoiceMarkupForDisplay,
  type TtsResult,
  type TtsSynthOptions,
} from './minimaxTts';
import { synthesizeSpeechFishDetailed, resolveFishAudioApiKey, cleanTextForTtsFish, stripFishMarkupForDisplay } from './fishAudioTts';
import { resolveTtsProvider } from './ttsProvider';
import {
  cleanTextForTtsElevenLabs,
  normalizeElevenLabsVoiceId,
  resolveElevenLabsApiKey,
  resolveElevenLabsModel,
  stripElevenLabsMarkupForDisplay,
  synthesizeSpeechElevenLabsDetailed,
} from './elevenLabsTts';
import { resolveMiniMaxApiKey } from './minimaxApiKey';

export type { TtsResult, TtsSynthOptions };

type SynthOptions = TtsSynthOptions;

export async function synthesizeSpeechDetailed(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: SynthOptions,
): Promise<TtsResult> {
  const provider = resolveTtsProvider(apiConfig);
  if (provider === 'fishaudio') {
    return synthesizeSpeechFishDetailed(text, char, apiConfig, options);
  }
  if (provider === 'elevenlabs') {
    return synthesizeSpeechElevenLabsDetailed(text, char, apiConfig, options);
  }
  return minimaxSynthesizeDetailed(text, char, apiConfig, options);
}

export async function synthesizeSpeech(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: SynthOptions,
): Promise<string> {
  const { url } = await synthesizeSpeechDetailed(text, char, apiConfig, options);
  return url;
}

/**
 * 当前 TTS 服务商下，这个角色是否已配好可用音色。
 * 鱼声看 fishReferenceId；MiniMax 看 voiceId / timberWeights。
 * 各处「要不要显示语音按钮 / 要不要触发自动 TTS」的判断统一用它，避免漏掉鱼声分支。
 */
export const characterHasVoice = (char: CharacterProfile, apiConfig: APIConfig): boolean => {
  const vp = char.voiceProfile;
  const provider = resolveTtsProvider(apiConfig);
  if (provider === 'fishaudio') {
    return !!vp?.fishReferenceId;
  }
  if (provider === 'elevenlabs') return !!normalizeElevenLabsVoiceId(vp?.elevenLabsVoiceId);
  return !!(vp?.voiceId || (vp?.timberWeights && vp.timberWeights.length > 0));
};

/**
 * 当前服务商的 Key + 当前角色音色是否都已配置。
 *
 * （合上游协同工作台时补的：CollaborationWindow 用它决定要不要给协同回复配语音。）
 */
export const canSynthesizeSpeech = (char: CharacterProfile, apiConfig: APIConfig): boolean => {
  if (!characterHasVoice(char, apiConfig)) return false;
  const provider = resolveTtsProvider(apiConfig);
  if (provider === 'fishaudio') return !!resolveFishAudioApiKey(apiConfig);
  if (provider === 'elevenlabs') return !!resolveElevenLabsApiKey(apiConfig);
  return !!resolveMiniMaxApiKey(apiConfig);
};

/**
 * 按服务商清洗待朗读文本，调用方不必自己猜哪种标记该保留。
 *
 * （合上游恐龙咖啡馆那批时补的：Chat.tsx 生成语音前统一走它。）
 */
export const cleanTextForTtsProvider = (text: string, apiConfig: APIConfig): string => {
  const provider = resolveTtsProvider(apiConfig);
  if (provider === 'fishaudio') return cleanTextForTtsFish(text);
  if (provider === 'elevenlabs') return cleanTextForTtsElevenLabs(text, resolveElevenLabsModel(apiConfig));
  return cleanTextForTts(text);
};

/** 按服务商剥掉只给 TTS 看的标记，用于界面显示。 */
export const stripTtsMarkupForDisplay = (text: string, apiConfig: APIConfig): string => {
  const provider = resolveTtsProvider(apiConfig);
  if (provider === 'fishaudio') return stripFishMarkupForDisplay(text);
  if (provider === 'elevenlabs') return stripElevenLabsMarkupForDisplay(text);
  return cleanVoiceMarkupForDisplay(text);
};

/** 鱼声 / ElevenLabs 的清洗器需要看到原始 inline cue；MiniMax 用已消毒的 speech。 */
export const providerUsesRawVoiceMarkup = (apiConfig: APIConfig): boolean =>
  resolveTtsProvider(apiConfig) !== 'minimax';
