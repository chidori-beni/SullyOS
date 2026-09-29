/**
 * 影院的「嘴」：把角色这一轮说的话合成语音、排队播放，随时能闭嘴。
 *
 * 合成走和私聊同一条路（ttsRouter：MiniMax / 鱼声 / ElevenLabs 都支持），先按服务商清洗文字。
 * 小动作（旁白）不念，只念说出口的话；一轮的几句拼成一段合成，少发几次请求，听起来也连贯。
 *
 * iPhone 上没有用户点一下就不让出声：进放映室、点麦克风、点发送这些时候都顺手调一次 unlock()，
 * 之后角色主动开口时才放得出来。
 */
import type { APIConfig, CharacterProfile } from '../../types';
import { canSynthesizeSpeech, cleanTextForTtsProvider, synthesizeSpeechDetailed } from '../ttsRouter';
import type { CinemaChatLine } from './cinema';

/** 一段极短的静音 wav，只用来在用户点击时「解锁」播放器。 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** 这一轮角色说出口的话（不含旁白）拼成一段要念的文字。 */
export const spokenTextOf = (lines: Pick<CinemaChatLine, 'role' | 'kind' | 'text'>[]): string =>
    lines
        .filter(line => line.role === 'char' && line.kind !== 'action')
        .map(line => line.text.trim())
        .filter(Boolean)
        .map(text => (/[。！？!?…~～」』）)]$/.test(text) ? text : `${text}。`))
        .join('');

export const canCinemaSpeak = (char: CharacterProfile | undefined, apiConfig: APIConfig): boolean =>
    !!char && canSynthesizeSpeech(char, apiConfig);

export interface CinemaSpeaker {
    /** 在用户点击里调用，让之后的自动播放不被 iPhone 拦住 */
    unlock: () => void;
    /** 合成并排队播放；返回可以重播的地址（合成失败返回 null） */
    say: (text: string, char: CharacterProfile, apiConfig: APIConfig) => Promise<string | null>;
    /** 重播某一段已经合成好的 */
    replay: (url: string) => void;
    /** 马上闭嘴，清空排队 */
    stop: () => void;
    /** 正在念吗 */
    isSpeaking: () => boolean;
    dispose: () => void;
}

export const createCinemaSpeaker = (onError?: (message: string) => void): CinemaSpeaker => {
    const audio: HTMLAudioElement | null = typeof Audio === 'function' ? new Audio() : null;
    if (audio) {
        audio.preload = 'auto';
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
    }
    const queue: string[] = [];
    const urls = new Set<string>();
    let playing = false;
    let generation = 0;

    const playNext = () => {
        if (!audio) return;
        const next = queue.shift();
        if (!next) { playing = false; return; }
        playing = true;
        audio.src = next;
        audio.play().catch(error => {
            playing = false;
            // iPhone 没解锁时会被拦：不当成错误弹窗，下一次用户点一下就好了
            console.warn('[cinema] 播放语音失败', error);
            playNext();
        });
    };
    if (audio) {
        audio.onended = playNext;
        audio.onerror = playNext;
    }

    return {
        unlock: () => {
            if (!audio || playing) return;
            try {
                audio.src = SILENT_WAV;
                void audio.play().catch(() => { /* 解锁失败也无所谓 */ });
            } catch { /* ignore */ }
        },
        say: async (text, char, apiConfig) => {
            const spoken = cleanTextForTtsProvider(text, apiConfig);
            if (!spoken || spoken.trim().length < 2) return null;
            const myGeneration = generation;
            try {
                const { url } = await synthesizeSpeechDetailed(spoken, char, apiConfig, {
                    groupId: apiConfig.minimaxGroupId || undefined,
                });
                if (!url) return null;
                if (url.startsWith('blob:')) urls.add(url);
                // 合成期间用户叫停了（开麦、离开放映室）：念不念都不重要了，别再出声
                if (myGeneration !== generation) return url;
                queue.push(url);
                if (!playing) playNext();
                return url;
            } catch (error: any) {
                onError?.(error?.message || String(error));
                return null;
            }
        },
        replay: (url) => {
            if (!audio) return;
            queue.length = 0;
            generation += 1;
            try { audio.pause(); } catch { /* ignore */ }
            queue.push(url);
            playing = false;
            playNext();
        },
        stop: () => {
            generation += 1;
            queue.length = 0;
            playing = false;
            if (!audio) return;
            try { audio.pause(); } catch { /* ignore */ }
        },
        isSpeaking: () => playing,
        dispose: () => {
            generation += 1;
            queue.length = 0;
            playing = false;
            try { audio?.pause(); } catch { /* ignore */ }
            for (const url of urls) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
            urls.clear();
        },
    };
};
