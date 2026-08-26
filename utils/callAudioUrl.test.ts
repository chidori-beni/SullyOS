import { describe, expect, it } from 'vitest';
import { resolveReusableCallAudioUrl } from './callAudioUrl';

describe('call audio URL lifetime', () => {
  it('keeps remote and data URLs reusable', () => {
    expect(resolveReusableCallAudioUrl(' https://cdn.example.test/call.mp3 ')).toBe('https://cdn.example.test/call.mp3');
    expect(resolveReusableCallAudioUrl('data:audio/mpeg;base64,AAAA')).toBe('data:audio/mpeg;base64,AAAA');
  });

  it('keeps only blob URLs created by the current CallApp session', () => {
    const live = new Set(['blob:https://sully.test/live']);
    expect(resolveReusableCallAudioUrl('blob:https://sully.test/live', live)).toBe('blob:https://sully.test/live');
    expect(resolveReusableCallAudioUrl('blob:https://sully.test/old', live)).toBeUndefined();
    expect(resolveReusableCallAudioUrl('blob:https://sully.test/old')).toBeUndefined();
  });

  it('rejects empty and non-string metadata', () => {
    expect(resolveReusableCallAudioUrl('   ')).toBeUndefined();
    expect(resolveReusableCallAudioUrl(null)).toBeUndefined();
    expect(resolveReusableCallAudioUrl({ url: 'blob:bad' })).toBeUndefined();
  });
});
