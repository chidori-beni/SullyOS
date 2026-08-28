import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanSpeechTranscript, prepareSiliconFlowAudioCapture, prepareSiliconFlowAudioPlayback, releaseSiliconFlowMicrophone, setSiliconFlowAudioRoute, startStt, transcribeWithSiliconFlow } from './speechToText';

describe('speech-to-text transcript cleaning', () => {
  it('removes SenseVoice control tags and emotion emoji by default', () => {
    expect(cleanSpeechTranscript('<|zh|><|HAPPY|> 今天见到你真开心 😊！')).toBe('今天见到你真开心 ！');
  });

  it('preserves the raw transcript when cleanup is disabled', () => {
    expect(cleanSpeechTranscript(' <|HAPPY|>你好😊 ', false)).toBe('<|HAPPY|>你好😊');
  });
});

describe('SiliconFlow transcription request', () => {
  afterEach(() => {
    releaseSiliconFlowMicrophone();
    vi.unstubAllGlobals();
  });

  it.each([
    ['siliconflow-sensevoice' as const, 'FunAudioLLM/SenseVoiceSmall'],
    ['siliconflow-telespeech' as const, 'TeleAI/TeleSpeechASR'],
  ])('uploads the selected model for %s', async (provider, expectedModel) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe('https://api.siliconflow.cn/v1/audio/transcriptions');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sf-test-key');
      expect((init?.body as FormData).get('model')).toBe(expectedModel);
      return new Response(JSON.stringify({ text: '<|zh|>识别成功😊' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeWithSiliconFlow(
      new Blob(['audio'], { type: 'audio/webm' }),
      provider,
      'Bearer sf-test-key',
    );

    expect(result).toBe('识别成功');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('never sends a request without the user own key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribeWithSiliconFlow(new Blob(['audio']), 'siliconflow-sensevoice', ''))
      .rejects.toThrow('SiliconFlow Key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the selected call route when the Audio Session API is available', () => {
    const audioSessionTypes: string[] = [];
    let audioSessionType = 'auto';
    vi.stubGlobal('navigator', {
      audioSession: {
        get type() { return audioSessionType; },
        set type(value: string) { audioSessionType = value; audioSessionTypes.push(value); },
      },
    });

    setSiliconFlowAudioRoute('receiver');
    expect(audioSessionType).toBe('play-and-record');
    prepareSiliconFlowAudioPlayback();
    expect(audioSessionType).toBe('play-and-record');
    setSiliconFlowAudioRoute('speaker');
    expect(audioSessionType).toBe('playback');
    // Reassigning the same category is observable on WebKit and can make the
    // system briefly re-pick the route / show the volume HUD.
    expect(audioSessionTypes).toEqual(['play-and-record', 'playback']);
  });

  it('moves to a capture-compatible category before a microphone request', () => {
    let audioSessionType = 'playback';
    vi.stubGlobal('navigator', {
      audioSession: {
        get type() { return audioSessionType; },
        set type(value: string) { audioSessionType = value; },
      },
    });

    prepareSiliconFlowAudioCapture();

    // WebKit's stable route sequence starts a speaker capture from `auto`;
    // the resolved stream enters `play-and-record` only after getUserMedia.
    expect(audioSessionType).toBe('auto');
  });

  it('reuses one microphone stream across recordings until the call is released', async () => {
    const track = {
      enabled: true,
      readyState: 'live' as MediaStreamTrackState,
      stop: vi.fn(() => { track.readyState = 'ended'; }),
      addEventListener: vi.fn(),
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    const audioSessionTypes: string[] = [];
    let audioSessionType = 'playback';
    const getUserMedia = vi.fn(async () => {
      // Regression guard: after a TTS turn leaves the session in playback,
      // the category must be changed before WebKit evaluates getUserMedia().
      expect(audioSessionType).toBe('auto');
      return stream;
    });
    const audioSession = {
      get type() { return audioSessionType; },
      set type(value: string) { audioSessionType = value; audioSessionTypes.push(value); },
    };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, audioSession });

    class FakeMediaRecorder {
      static isTypeSupported = () => false;
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: MediaStream) {}
      start() { this.state = 'recording'; }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: '识别成功' }), { status: 200 })));

    const runRecording = async () => {
      let finish!: () => void;
      const ended = new Promise<void>(resolve => { finish = resolve; });
      // This mirrors the mic-button preflight in CallApp/UserVoiceInputModal.
      prepareSiliconFlowAudioCapture();
      const session = await startStt('zh-CN', { onEnd: finish }, {
        provider: 'siliconflow-sensevoice',
        apiKey: 'sf-test-key',
      });
      session.stop();
      await ended;
    };

    await runRecording();
    expect(track.enabled).toBe(false);
    expect(audioSessionTypes).toContain('play-and-record');
    // The recorder track is disabled between turns. WebKit needs a forced
    // category change to recompute the output route, and it must END on
    // `playback`: the old `playback -> auto` pair handed the decision back to a
    // session that still remembered play-and-record, which is what made every
    // later chat/call voice turn come out of the receiver until the user
    // manually swiped the PWA away and back.
    expect(audioSessionTypes.slice(-2)).toEqual(['auto', 'playback']);
    const routeChangesAfterFirstRecording = audioSessionTypes.length;
    await runRecording();

    expect(getUserMedia).toHaveBeenCalledOnce();
    // The cached stream is reused and `auto` is capture-compatible: the mic
    // button moves the session off `playback` first, then stopping the turn
    // repeats the forced `auto -> playback` kick. No second permission request
    // and no stale play-and-record category left behind.
    expect(audioSessionTypes.slice(routeChangesAfterFirstRecording)).toEqual(['auto', 'auto', 'playback']);
    expect(track.stop).not.toHaveBeenCalled();
    releaseSiliconFlowMicrophone();
    expect(track.stop).toHaveBeenCalledOnce();
    // Releasing the microphone must leave the speaker route asserted, not
    // `auto` — `auto` after a capture is exactly the receiver regression.
    expect(audioSessionTypes.at(-1)).toBe('playback');
  });
});
