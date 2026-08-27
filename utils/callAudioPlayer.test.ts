import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCallAudioElement, getCallAudioResumeIntent, resetCallAudioElement, setCallAudioResumeIntent } from './callAudioPlayer';

describe('call audio player lifetime', () => {
  afterEach(() => {
    resetCallAudioElement();
    expect(getCallAudioResumeIntent()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('reuses the same element across CallApp mounts and only resets explicitly', () => {
    class FakeAudio {
      preload = '';
      paused = false;
      ended = false;
      currentTime = 4;
      src = 'blob:https://sully.test/turn';
      pause = vi.fn(() => { this.paused = true; });
      load = vi.fn();
      setAttribute = vi.fn();
      removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      play = vi.fn(async () => { this.paused = false; });
    }
    vi.stubGlobal('Audio', FakeAudio);

    const first = getCallAudioElement();
    const second = getCallAudioElement();
    expect(first).toBe(second);
    expect(first).not.toBeNull();
    expect((first as unknown as FakeAudio).setAttribute).toHaveBeenCalledWith('playsinline', 'true');

    resetCallAudioElement();
    expect((first as unknown as FakeAudio).pause).toHaveBeenCalledOnce();
    expect((first as unknown as FakeAudio).removeAttribute).toHaveBeenCalledWith('src');
    expect((first as unknown as FakeAudio).load).toHaveBeenCalledOnce();
    // Resetting clears the source but intentionally keeps the element identity
    // for the next CallApp mount in this document.
    expect(getCallAudioElement()).toBe(first);

    setCallAudioResumeIntent(true);
    expect(getCallAudioResumeIntent()).toBe(true);
    resetCallAudioElement();
    expect(getCallAudioResumeIntent()).toBe(false);
  });
});
