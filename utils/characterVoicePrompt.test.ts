import { describe, expect, it } from 'vitest';
import { buildCharacterVoicePromptBlock } from './voiceProfile';
import { buildVoiceActingGuide } from './chatPrompts';

describe('角色专属语音提示词', () => {
  it('没填就不加任何东西', () => {
    expect(buildCharacterVoicePromptBlock({ name: '萧逸', voiceProfile: {} })).toBe('');
    expect(buildCharacterVoicePromptBlock({ name: '萧逸', voiceProfile: { voicePrompt: '   ' } })).toBe('');
    expect(buildCharacterVoicePromptBlock(undefined)).toBe('');
  });

  it('填了就带上角色名', () => {
    const block = buildCharacterVoicePromptBlock({ name: '萧逸', voiceProfile: { voicePrompt: '声音往下沉。' } });
    expect(block).toContain('萧逸的说话方式');
    expect(block).toContain('声音往下沉。');
  });

  it('聊天语音指南：接在通用指南后面、固定运行协议前面', () => {
    const guide = buildVoiceActingGuide({ name: '萧逸', voiceProfile: { voicePrompt: '几乎不用感叹号。' } });
    const at = guide.indexOf('几乎不用感叹号。');
    expect(at).toBeGreaterThan(0);
    expect(guide.indexOf('语音输出运行协议')).toBeGreaterThan(at);
  });

  it('没填时聊天语音指南和改之前一样', () => {
    const guide = buildVoiceActingGuide({ voiceProfile: {} });
    expect(guide).not.toContain('的说话方式');
  });
});
