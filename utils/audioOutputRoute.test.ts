import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAudioOutputRouteForTests,
  acquirePlaybackAudio,
  getAudioSessionType,
  noteAudioCaptureStarting,
  notePlaybackStarted,
  prepareSpeakerPlayback,
  restoreSpeakerAudioOutput,
  setAudioSessionType,
} from './audioOutputRoute';

/** Minimal stand-in for WebKit's `navigator.audioSession`. */
const stubAudioSession = (initial = 'auto') => {
  const writes: string[] = [];
  let type = initial;
  vi.stubGlobal('navigator', {
    audioSession: {
      get type() { return type; },
      set type(value: string) { type = value; writes.push(value); },
    },
  });
  return { writes, current: () => type };
};

class FakeAudio {
  static created: FakeAudio[] = [];
  src = '';
  loop = false;
  muted = true;
  volume = 0;
  paused = true;
  play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  setAttribute = vi.fn();
  removeAttribute = vi.fn();
  constructor() { FakeAudio.created.push(this); }
}

beforeEach(() => {
  FakeAudio.created = [];
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
});

afterEach(() => {
  __resetAudioOutputRouteForTests();
  vi.unstubAllGlobals();
});

describe('speaker route restore after a microphone capture', () => {
  it('ends on playback instead of handing the route back to auto', () => {
    const session = stubAudioSession('play-and-record');
    noteAudioCaptureStarting();

    restoreSpeakerAudioOutput();

    // `auto` first clears WebKit's play-and-record pin, `playback` then asks
    // for the media/speaker route. Ending on `auto` is the receiver regression.
    expect(session.writes).toEqual(['auto', 'playback']);
    expect(getAudioSessionType()).toBe('playback');
  });

  it('really re-activates the session with a fresh output-only element', () => {
    stubAudioSession('play-and-record');
    noteAudioCaptureStarting();

    restoreSpeakerAudioOutput();

    const primer = FakeAudio.created.at(-1)!;
    expect(primer.play).toHaveBeenCalledOnce();
    expect(primer.loop).toBe(true);
    // A muted element does not make iOS renegotiate the output route; the clip
    // itself is digital silence instead.
    expect(primer.muted).toBe(false);
    expect(primer.src.startsWith('data:audio/wav;base64,')).toBe(true);
  });

  it('does nothing when the page never captured audio', () => {
    const session = stubAudioSession('playback');

    restoreSpeakerAudioOutput();

    expect(session.writes).toEqual([]);
    expect(FakeAudio.created).toHaveLength(0);
  });

  it('stops the silent primer when a capture starts or real audio plays', () => {
    stubAudioSession('play-and-record');
    noteAudioCaptureStarting();
    restoreSpeakerAudioOutput();
    const primer = FakeAudio.created.at(-1)!;

    notePlaybackStarted();
    expect(primer.pause).toHaveBeenCalledOnce();

    restoreSpeakerAudioOutput();
    const second = FakeAudio.created.at(-1)!;
    expect(second).not.toBe(primer);
    noteAudioCaptureStarting();
    expect(second.pause).toHaveBeenCalledOnce();
  });
});

describe('playback element reuse', () => {
  it('replaces an element that was created before the last route reset', () => {
    stubAudioSession('play-and-record');
    noteAudioCaptureStarting();

    const first = acquirePlaybackAudio(null)!;
    expect(acquirePlaybackAudio(first)).toBe(first);

    restoreSpeakerAudioOutput();
    const second = acquirePlaybackAudio(first)!;

    // The stale element may still be bound to the receiver route it was
    // created on, so playback after a reset must use a new one.
    expect(second).not.toBe(first);
    expect(first.pause).toHaveBeenCalled();
    expect(acquirePlaybackAudio(second)).toBe(second);
  });
});

describe('prepareSpeakerPlayback', () => {
  it('asserts playback without re-running the route kick', () => {
    const session = stubAudioSession('auto');

    prepareSpeakerPlayback();
    prepareSpeakerPlayback();

    // Same-value writes are observable on WebKit (they can flash the volume
    // HUD), so the second call must be a no-op.
    expect(session.writes).toEqual(['playback']);
  });

  it('is a no-op when the Audio Session API is missing', () => {
    vi.stubGlobal('navigator', {});
    expect(() => prepareSpeakerPlayback()).not.toThrow();
    expect(setAudioSessionType('playback')).toBe(false);
  });
});
