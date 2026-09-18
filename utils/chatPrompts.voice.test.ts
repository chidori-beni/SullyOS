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

describe('buildMessageHistory 用户语音消息', () => {
  const char = { id: 'c1', name: '小角色' } as any;
  const userProfile = { name: '我' } as any;

  it('明确告诉模型这是录音而不是手打，并保留转写内容和时长', () => {
    const { apiMessages } = ChatPrompts.buildMessageHistory([
      {
        id: 1,
        charId: 'c1',
        role: 'user',
        type: 'voice',
        content: '呼呼',
        timestamp: Date.now(),
        metadata: { transcript: '呼呼', audioDuration: 2.1, userVoice: true },
      },
    ] as any[], 10, char, userProfile, []);

    const content = apiMessages[0].content as string;
    expect(content).toContain('用户发送了一条语音消息');
    expect(content).toContain('这是录音，不是手打文字');
    expect(content).toContain('约 2 秒');
    expect(content).toContain('语音转写内容：「呼呼」');
  });

  it('即使 content 是旧数据里的音频地址，也优先读取 metadata 转写', () => {
    const { apiMessages } = ChatPrompts.buildMessageHistory([
      {
        id: 2,
        charId: 'c1',
        role: 'user',
        type: 'voice',
        content: 'blob:expired-recording',
        timestamp: Date.now(),
        metadata: { transcript: '我在听', audioDuration: 1 },
      },
    ] as any[], 10, char, userProfile, []);

    expect(apiMessages[0].content).toContain('语音转写内容：「我在听」');
    expect(apiMessages[0].content).not.toContain('blob:expired-recording');
  });
});
