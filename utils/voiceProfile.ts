import type { CharacterProfile } from '../types';

export type CharacterVoiceProfile = NonNullable<CharacterProfile['voiceProfile']>;

/**
 * Merge a partial voice-profile update without silently discarding settings
 * that are not edited by the current control (speed, pitch, Fish reference,
 * and future fields included).
 */
export const mergeCharacterVoiceProfile = (
  current: CharacterProfile['voiceProfile'] | null | undefined,
  updates: Partial<CharacterVoiceProfile>,
): CharacterVoiceProfile => ({
  ...(current || {}),
  ...updates,
});

/**
 * 角色自己的「语音说话方式」（神经链接 → 语音里填的那一栏）。
 *
 * 接在全局语音指南（设置 → 其他 API → 语音提示词）后面，不替换它：
 * 通用规则（停顿怎么标、语气声用哪些）全局只维护一份，每个角色只写性格部分。
 * 聊天语音、电话、见面三处共用。留空 → 返回空串，行为与改之前一字不差。
 */
export const buildCharacterVoicePromptBlock = (
  char: { name?: string; voiceProfile?: CharacterProfile['voiceProfile'] } | null | undefined,
): string => {
  const text = char?.voiceProfile?.voicePrompt?.trim();
  if (!text) return '';
  const who = char?.name?.trim() || '这个角色';
  return `### ${who}的说话方式（只对${who}生效；和上面的通用规则冲突时，以这里为准）\n\n${text}`;
};
