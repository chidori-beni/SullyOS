import type { APIConfig, CharacterProfile } from '../../types';
import type { UiLocale } from '../uiLocale';
import type { CinemaSpeaker } from './cinemaVoice';

type TextRequest = { promise: Promise<string>; cancel: () => void };
/** A new request or context invalidates both pending translation and pending TTS. */
export const createLocalizedPlayback = (getSpeaker: () => CinemaSpeaker, stop: () => void) => {
  let generation = 0;
  let pending: (() => void) | undefined;
  const cache = new Map<string, string>();
  const release = (url: string) => { if (url.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch { /* browser unavailable */ } } };
  const invalidate = (clear = false) => {
    generation++; pending?.(); pending = undefined; stop();
    if (clear) { for (const url of cache.values()) release(url); cache.clear(); }
  };
  const play = async (input: { identity: string; locale: UiLocale; char: CharacterProfile; api: APIConfig; resolve: () => TextRequest; current: () => boolean }) => {
    if (!input.current()) return;
    invalidate();
    const token = generation;
    const valid = () => token === generation && input.current();
    const request = input.resolve(); pending = request.cancel;
    try {
      const text = await request.promise;
      if (!valid() || !text.trim()) return;
      pending = undefined;
      const key = JSON.stringify([input.identity, input.locale, text, input.char.id, input.char.voiceProfile, input.api]);
      const cached = cache.get(key);
      if (cached) { getSpeaker().replay(cached); return; }
      const url = await getSpeaker().say(text, input.char, input.api);
      if (!url) return;
      if (!valid()) { release(url); return; }
      cache.set(key, url);
      while (cache.size > 32) { const first = cache.keys().next().value!; release(cache.get(first)!); cache.delete(first); }
    } catch (error) { if (valid()) throw error; }
    finally { if (token === generation) pending = undefined; }
  };
  return { play, invalidate };
};
