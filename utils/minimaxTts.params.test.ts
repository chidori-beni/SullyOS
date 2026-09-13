import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import {
  buildMiniMaxTtsCacheKey,
  buildMiniMaxTtsPayload,
  getMiniMaxParamVersion,
  normalizeMiniMaxLanguageBoost,
} from './minimaxTts';

const profile = (overrides: Partial<NonNullable<CharacterProfile['voiceProfile']>> = {}) => ({
  voiceId: 'voice-clone-1',
  model: 'speech-2.8-hd',
  speed: 1.8,
  vol: 1,
  pitch: 11,
  voiceModify: { pitch: 80, intensity: 60, timbre: -75 },
  ...overrides,
});

describe('MiniMax parameter versions', () => {
  it('keeps missing versions on the exact legacy request path', () => {
    const vp = profile();
    // 句中的「。」会被糯叽机稀疏规则插停顿；句末那个不插（本 fork 的二改）。
    const payload = buildMiniMaxTtsPayload('你好。回来啦。', vp, { languageBoost: 'ja' });

    expect(getMiniMaxParamVersion(vp)).toBe('legacy');
    expect(payload.text).toContain('<#');
    expect(payload.voice_setting.speed).toBe(1.4);
    expect(payload.voice_setting.pitch).toBe(8);
    // 本 fork 把 english_normalization 放顶层：塞进 voice_setting 会被 MiniMax 忽略。
    expect(payload.english_normalization).toBe(true);
    expect(payload.voice_setting.english_normalization).toBeUndefined();
    expect(payload.language_boost).toBe('ja');
    expect(payload.audio_setting).toEqual({ format: 'mp3' });
    // 本 fork 的经典档一律用 hex 内联音频（第 13 批），不走签名网址。
    expect(payload.output_format).toBe('hex');
    expect(payload.voice_modify.intensity).not.toBe(60);
  });

  it('uses one natural request shape without forced punctuation pauses', () => {
    const vp = profile({
      minimaxParamVersion: 'natural-v2',
      emotion: 'calm',
    });
    const payload = buildMiniMaxTtsPayload('你好，回来啦。', vp, {
      languageBoost: 'ja',
      emotion: 'angry',
    });

    expect(payload.text).toBe('你好，回来啦。');
    expect(payload.text).not.toContain('<#');
    expect(payload.stream).toBe(false);
    expect(payload.output_format).toBe('url');
    expect(payload.audio_setting).toEqual({ format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 });
    expect(payload.language_boost).toBe('Japanese');
    // 本 fork 送 API 前会把 calm/fluent 归一化成 neutral（非法值 MiniMax 会整条报错）。
    expect(payload.voice_setting).toMatchObject({ speed: 1.8, pitch: 11, emotion: 'neutral' });
    expect(payload.voice_setting.english_normalization).toBeUndefined();
    expect(payload.voice_modify).toEqual({ pitch: 80, intensity: 60, timbre: -75 });
  });

  it('uses dynamic emotion only when the character leaves emotion on auto', () => {
    const payload = buildMiniMaxTtsPayload('测试', profile({
      minimaxParamVersion: 'natural-v2',
      emotion: undefined,
    }), { emotion: 'happy' });
    expect(payload.voice_setting.emotion).toBe('happy');
  });

  it('maps project language codes to official MiniMax values', () => {
    expect(normalizeMiniMaxLanguageBoost('en')).toBe('English');
    expect(normalizeMiniMaxLanguageBoost('ko')).toBe('Korean');
    expect(normalizeMiniMaxLanguageBoost('French')).toBe('French');
  });

  it('separates natural-v2 audio from legacy cache entries', () => {
    const payload = { text: '相同文本', model: 'speech-2.8-hd', voice_setting: { voice_id: 'v1' }, audio_setting: { format: 'mp3' } };
    expect(buildMiniMaxTtsCacheKey(payload, 'natural-v2')).not.toBe(buildMiniMaxTtsCacheKey(payload, 'legacy'));
  });
});
