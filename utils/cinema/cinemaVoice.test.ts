import { beforeEach, describe, expect, it, vi } from 'vitest';

const synthesizeSpeechDetailed = vi.fn();
vi.mock('../ttsRouter', () => ({
    synthesizeSpeechDetailed: (...args: any[]) => synthesizeSpeechDetailed(...args),
    cleanTextForTtsProvider: (text: string) => text.replace(/\[[^\]]*\]/g, '').trim(),
    canSynthesizeSpeech: () => true,
}));

/** 假的播放器：记下放了什么，手动触发「放完了」。 */
class FakeAudio {
    static all: FakeAudio[] = [];
    src = '';
    played: string[] = [];
    paused = true;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    preload = '';
    constructor() { FakeAudio.all.push(this); }
    setAttribute() { /* ignore */ }
    play() { this.paused = false; this.played.push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
    finish() { this.onended?.(); }
}
(globalThis as any).Audio = FakeAudio;

const { createCinemaSpeaker, spokenTextOf } = await import('./cinemaVoice');

const char = { id: 'c', name: '萧逸' } as any;
const api = { baseUrl: 'x' } as any;
const flush = () => new Promise(r => setTimeout(r, 0));

describe('要念的是哪些话', () => {
    it('只念角色说出口的，旁白不念；没标点的补句号', () => {
        expect(spokenTextOf([
            { role: 'char', kind: 'action', text: '往你那边靠了靠' },
            { role: 'char', text: '别怕' },
            { role: 'char', text: '有我呢！' },
            { role: 'user', text: '好吓人' },
        ])).toBe('别怕。有我呢！');
    });

    it('全是旁白就不念', () => {
        expect(spokenTextOf([{ role: 'char', kind: 'action', text: '轻轻握住你的手' }])).toBe('');
    });
});

describe('影院的嘴', () => {
    beforeEach(() => { synthesizeSpeechDetailed.mockReset(); FakeAudio.all = []; });

    it('合成好就放，两段排队一段一段放', async () => {
        synthesizeSpeechDetailed.mockResolvedValueOnce({ url: 'blob:a' }).mockResolvedValueOnce({ url: 'blob:b' });
        const speaker = createCinemaSpeaker();
        const audio = FakeAudio.all[0];
        await speaker.say('第一段', char, api);
        await speaker.say('第二段', char, api);
        expect(audio.played).toEqual(['blob:a']);
        audio.finish();
        expect(audio.played).toEqual(['blob:a', 'blob:b']);
    });

    it('开麦叫停以后，还在合成的那段回来了也不许出声', async () => {
        let resolve!: (v: any) => void;
        synthesizeSpeechDetailed.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const speaker = createCinemaSpeaker();
        const audio = FakeAudio.all[0];
        const pending = speaker.say('说到一半', char, api);
        speaker.stop();
        resolve({ url: 'blob:late' });
        expect(await pending).toBe('blob:late'); // 还是能拿来重听
        await flush();
        expect(audio.played).toEqual([]);
    });

    it('太短或只剩标记的不念，也不发合成请求', async () => {
        const speaker = createCinemaSpeaker();
        expect(await speaker.say('[laugh]', char, api)).toBeNull();
        expect(synthesizeSpeechDetailed).not.toHaveBeenCalled();
    });

    it('合成失败不抛错，交给回调', async () => {
        synthesizeSpeechDetailed.mockRejectedValueOnce(new Error('音色没配'));
        const onError = vi.fn();
        const speaker = createCinemaSpeaker(onError);
        expect(await speaker.say('你好呀', char, api)).toBeNull();
        expect(onError).toHaveBeenCalledWith('音色没配');
    });

    it('点气泡重听：打断正在放的，改放那一段', async () => {
        synthesizeSpeechDetailed.mockResolvedValueOnce({ url: 'blob:now' });
        const speaker = createCinemaSpeaker();
        const audio = FakeAudio.all[0];
        await speaker.say('现在这段', char, api);
        speaker.replay('blob:old');
        expect(audio.played).toEqual(['blob:now', 'blob:old']);
    });
});
