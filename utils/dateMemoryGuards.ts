/**
 * 见面界面「待久了闪退」的两处内存护栏（2026-10-24）。
 *
 * 1) 自动存档去重：见面每 30s 落一次恢复快照。原来不管有没有变化都存，而且存的是
 *    「整个角色」——立绘 / 背景 / 换装套装全是 base64 大图，落库时还会先把库里旧的
 *    整份读出来。放着不动一小时就是 120 次整角色读写，iOS 上内存一路被顶高。
 *    现在只比对快照本身（去掉每次都变的 timestamp），没变就不写。
 * 2) 语音缓存封顶：每句台词合成后的 blob: 链接都留在缓存里、从不释放，
 *    聊得越久音频越多。现在只留最近 MAX_DATE_VOICE_CACHE 句，挤出去的释放掉。
 */
import type { DateState } from '../types';

export const MAX_DATE_VOICE_CACHE = 30;

/** 快照的「内容指纹」：timestamp 每次都变，不算内容变化。 */
export const dateStateSaveSignature = (state: DateState): string => {
    try {
        return JSON.stringify({ ...state, timestamp: 0 });
    } catch {
        // 序列化不了就当作每次都不同，宁可多存一次。
        return `unserializable:${Date.now()}:${Math.random()}`;
    }
};

const revokeIfBlob = (url: string | undefined) => {
    if (url && url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
};

/**
 * 把语音缓存削到上限以内：先进先出（对象键按插入顺序），正在播放的那条不动。
 * 直接改传入的对象，返回被释放的条数。
 */
export const trimDateVoiceCache = <T extends { url: string }>(
    cache: Record<string, T>,
    playingUrl?: string,
    max: number = MAX_DATE_VOICE_CACHE,
): number => {
    const keys = Object.keys(cache);
    let excess = keys.length - max;
    let released = 0;
    for (const key of keys) {
        if (excess <= 0) break;
        const entry = cache[key];
        if (playingUrl && entry?.url === playingUrl) continue;
        delete cache[key];
        revokeIfBlob(entry?.url);
        excess--;
        released++;
    }
    return released;
};

/** 离开见面时释放全部语音 blob。 */
export const releaseDateVoiceCache = <T extends { url: string }>(cache: Record<string, T>): void => {
    for (const key of Object.keys(cache)) {
        revokeIfBlob(cache[key]?.url);
        delete cache[key];
    }
};
