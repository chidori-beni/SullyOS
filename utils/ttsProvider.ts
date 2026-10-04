/**
 * 全局 TTS 服务商选择（MiniMax / 鱼声 Fish Audio / ElevenLabs）。
 *
 * 大多数语音合成入口都能拿到 apiConfig，直接用 `resolveTtsProvider(apiConfig)` 即可。
 * 但少数地方（如 chatPrompts.buildSystemPrompt 拼语音格式指导时）拿不到 apiConfig，
 * 所以这里额外维护一个模块级单例：OSContext 在 apiConfig.ttsProvider 变化时
 * 调 setTtsProvider() 同步，prompt 侧用 getTtsProvider() 读最新值。
 * （与 minimaxEndpoint 里的 region 单例同一套思路。）
 */
import type { APIConfig, TtsProvider } from '../types';

export const normalizeTtsProvider = (raw: unknown): TtsProvider =>
  raw === 'fishaudio' ? 'fishaudio' : raw === 'elevenlabs' ? 'elevenlabs' : 'minimax';

/** 界面上显示的服务商名字。 */
export const TTS_PROVIDER_LABELS: Record<TtsProvider, string> = {
  minimax: 'MiniMax',
  fishaudio: '鱼声 Fish',
  elevenlabs: 'ElevenLabs',
};

let currentProvider: TtsProvider = 'minimax';

export function setTtsProvider(provider: TtsProvider | string | undefined | null): void {
  currentProvider = normalizeTtsProvider(provider);
}

/**
 * 角色可以单独指定 TTS 服务商（voiceProfile.ttsProvider），比如中文角色用 MiniMax、日文角色用鱼声。
 * 没指定（undefined / 空串）→ 跟随全局设置。
 */
type CharTtsSource = { voiceProfile?: { ttsProvider?: TtsProvider | '' } } | null | undefined;

const charTtsOverride = (char: CharTtsSource): TtsProvider | undefined => {
  const raw = char?.voiceProfile?.ttsProvider;
  return raw ? normalizeTtsProvider(raw) : undefined;
};

/** 传了角色就先看角色自己的选择，否则 / 跟随全局时返回全局服务商。 */
export function getTtsProvider(char?: CharTtsSource): TtsProvider {
  return charTtsOverride(char) ?? currentProvider;
}

const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';
let currentElevenLabsModel = DEFAULT_ELEVENLABS_MODEL;

/** 同步当前 ElevenLabs 模型，供拿不到 apiConfig 的 prompt 构建器做模型感知。 */
export function setElevenLabsModel(model: string | undefined | null): void {
  currentElevenLabsModel = typeof model === 'string' && model.trim()
    ? model.trim()
    : DEFAULT_ELEVENLABS_MODEL;
}

export function getElevenLabsModel(): string {
  return currentElevenLabsModel;
}

/** 解析某个角色实际用的 TTS 服务商：角色单独指定 > apiConfig 全局（缺省 → minimax）。 */
export const resolveTtsProvider = (
  apiConfig?: Pick<APIConfig, 'ttsProvider'> | null,
  char?: CharTtsSource,
): TtsProvider =>
  charTtsOverride(char) ?? normalizeTtsProvider(apiConfig?.ttsProvider);

/**
 * 用户自定义「语音表演指南」覆盖。
 * 与 ttsProvider 单例同一套思路：chatPrompts / datePrompts 拼语音格式指导时拿不到 apiConfig，
 * 所以 OSContext 在 apiConfig.voicePrompts 变化时调 setVoicePromptOverrides() 同步，
 * prompt 侧用 getVoicePromptOverride() 读最新值。某项留空 → 返回 undefined → 调用方回退内置默认。
 *
 * 三个键：
 *   - 'minimax' / 'fishaudio' / 'elevenlabs'：聊天 + 电话共用，按当前服务商注入。
 *   - 'dateVoice'：见面（DateApp）专用的 [v:xxx] 语音情绪规则，与服务商无关、单独一份。
 */
export type VoicePromptKey = TtsProvider | 'dateVoice';

let voicePromptOverrides: Partial<Record<VoicePromptKey, string>> = {};

export function setVoicePromptOverrides(overrides: APIConfig['voicePrompts'] | undefined | null): void {
  voicePromptOverrides = {
    minimax: typeof overrides?.minimax === 'string' ? overrides.minimax : undefined,
    fishaudio: typeof overrides?.fishaudio === 'string' ? overrides.fishaudio : undefined,
    elevenlabs: typeof overrides?.elevenlabs === 'string' ? overrides.elevenlabs : undefined,
    dateVoice: typeof overrides?.dateVoice === 'string' ? overrides.dateVoice : undefined,
  };
}

/** 取某项的自定义语音指南；空白 / 未设 → undefined（调用方用内置默认兜底）。 */
export function getVoicePromptOverride(key: VoicePromptKey): string | undefined {
  const v = voicePromptOverrides[key];
  return v && v.trim() ? v : undefined;
}
