import { describe, expect, it } from 'vitest';
import { mergeCharacterVoiceProfile } from './voiceProfile';

describe('mergeCharacterVoiceProfile', () => {
  it('changing a voice id keeps speed and other provider-independent settings', () => {
    const next = mergeCharacterVoiceProfile({
      voiceId: 'old-voice',
      speed: 0.9,
      vol: 0.85,
      pitch: -1,
      fishReferenceId: 'fish-reference',
    }, {
      provider: 'minimax',
      voiceId: 'new-voice',
    });

    expect(next).toMatchObject({
      provider: 'minimax',
      voiceId: 'new-voice',
      speed: 0.9,
      vol: 0.85,
      pitch: -1,
      fishReferenceId: 'fish-reference',
    });
  });
});
