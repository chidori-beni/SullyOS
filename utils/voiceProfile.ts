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
