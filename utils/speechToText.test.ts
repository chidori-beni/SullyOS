import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanSpeechTranscript, transcribeWithSiliconFlow } from './speechToText';

describe('speech-to-text transcript cleaning', () => {
  it('removes SenseVoice control tags and emotion emoji by default', () => {
    expect(cleanSpeechTranscript('<|zh|><|HAPPY|> 今天见到你真开心 😊！')).toBe('今天见到你真开心 ！');
  });

  it('preserves the raw transcript when cleanup is disabled', () => {
    expect(cleanSpeechTranscript(' <|HAPPY|>你好😊 ', false)).toBe('<|HAPPY|>你好😊');
  });
});

describe('SiliconFlow transcription request', () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
