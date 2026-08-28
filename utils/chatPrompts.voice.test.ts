import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildVoiceActingGuide, ChatPrompts } from './chatPrompts';
import { setTtsProvider, setVoicePromptOverrides } from './ttsProvider';

const character = (speed?: number) => ({
  voiceProfile: speed === undefined ? undefined : { speed },
});

beforeEach(() => {
  setTtsProvider('minimax');
  setVoicePromptOverrides(undefined);
});

afterEach(() => {
  setTtsProvider('minimax');
  setVoicePromptOverrides(undefined);
});

describe('chat voice runtime contract', () => {
  it('keeps interjection and effective speed instructions in the default guide', () => {
    const guide = buildVoiceActingGuide(character(0.9));

    expect(guide).toContain('语气声');
    expect(guide).toContain('(chuckle)');
    expect(guide).toContain('0.90×');
    expect(guide).toContain('voice_setting.speed');
  });

  it('does not let a custom guide remove the runtime contract', () => {
    setVoicePromptOverrides({ minimax: '只保留这条自定义角色口吻。' });

    const guide = buildVoiceActingGuide(character(0.85));

    expect(guide).toContain('只保留这条自定义角色口吻。');
    expect(guide).toContain('语气声');
    expect(guide).toContain('0.85×');
  });

  it('uses Fish cues and Fish effective speed when Fish Audio is active', () => {
    setTtsProvider('fishaudio');
    setVoicePromptOverrides({ fishaudio: '鱼声自定义指南。' });

    const guide = buildVoiceActingGuide(character(0.8));

    expect(guide).toContain('鱼声自定义指南。');
    expect(guide).toContain('[chuckling]');
    expect(guide).toContain('0.80×');
    expect(guide).toContain('prosody.speed');
    expect(guide).not.toContain('<#0.2#> / <#0.3#>');
  });

  it('injects the same contract into normal chat and fire-pack prompts', async () => {
    const char = {
      id: 'voice-prompt-char',
      name: '阿一',
      chatVoiceEnabled: true,
      voiceProfile: { speed: 0.9 },
    } as any;

    const build = async (forFirePack: boolean) => {
      const parts = await ChatPrompts.buildSystemPromptParts(
        char,
        { name: '条条' } as any,
        [], [], [], [],
        undefined, undefined, undefined, undefined, undefined, undefined,
        forFirePack ? { forFirePack: true } : undefined,
      );
      return parts.stable;
    };

    expect(await build(false)).toContain('语音输出运行协议');
    expect(await build(false)).toContain('0.90×');
    expect(await build(true)).toContain('语音输出运行协议');
    expect(await build(true)).toContain('0.90×');
  });
});
