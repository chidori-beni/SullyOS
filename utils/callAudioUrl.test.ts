import { afterEach, describe, expect, it } from 'vitest';
import {
  registerCallAudioBlobUrl,
  resolveReusableCallAudioUrl,
  revokeCallAudioBlobUrl,
} from './callAudioUrl';

describe('call audio URL lifetime', () => {
  afterEach(() => {
    revokeCallAudioBlobUrl('blob:https://sully.test/live');
    revokeCallAudioBlobUrl('blob:https://sully.test/suspended');
  });

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

  it('keeps a suspended-call blob reusable across CallApp remounts', () => {
    const url = 'blob:https://sully.test/suspended';
    registerCallAudioBlobUrl(url);
    expect(resolveReusableCallAudioUrl(url)).toBe(url);
    // The new CallApp instance has a fresh local Set; the document registry is
    // what bridges that remount without treating the URL as an old page blob.
    expect(resolveReusableCallAudioUrl(url, new Set())).toBe(url);
    revokeCallAudioBlobUrl(url);
    expect(resolveReusableCallAudioUrl(url)).toBeUndefined();
  });

  it('rejects empty and non-string metadata', () => {
    expect(resolveReusableCallAudioUrl('   ')).toBeUndefined();
    expect(resolveReusableCallAudioUrl(null)).toBeUndefined();
    expect(resolveReusableCallAudioUrl({ url: 'blob:bad' })).toBeUndefined();
  });
});
