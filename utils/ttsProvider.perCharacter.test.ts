import { describe, expect, it } from 'vitest';
import { getTtsProvider, resolveTtsProvider, setTtsProvider } from './ttsProvider';

describe('角色单独指定 TTS 服务商', () => {
  it('角色没选 → 跟随全局', () => {
    expect(resolveTtsProvider({ ttsProvider: 'fishaudio' }, { voiceProfile: {} })).toBe('fishaudio');
    expect(resolveTtsProvider({ ttsProvider: 'elevenlabs' }, { voiceProfile: { ttsProvider: '' } })).toBe('elevenlabs');
    expect(resolveTtsProvider({ ttsProvider: 'fishaudio' })).toBe('fishaudio');
  });

  it('角色选了 → 角色优先', () => {
    expect(resolveTtsProvider({ ttsProvider: 'minimax' }, { voiceProfile: { ttsProvider: 'fishaudio' } })).toBe('fishaudio');
    expect(resolveTtsProvider({ ttsProvider: 'fishaudio' }, { voiceProfile: { ttsProvider: 'minimax' } })).toBe('minimax');
  });

  it('prompt 侧单例同样角色优先', () => {
    setTtsProvider('minimax');
    expect(getTtsProvider()).toBe('minimax');
    expect(getTtsProvider({ voiceProfile: { ttsProvider: 'fishaudio' } })).toBe('fishaudio');
    expect(getTtsProvider({ voiceProfile: {} })).toBe('minimax');
  });
});
