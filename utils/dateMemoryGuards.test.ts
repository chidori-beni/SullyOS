import { describe, expect, it, vi } from 'vitest';
import { dateStateSaveSignature, releaseDateVoiceCache, trimDateVoiceCache } from './dateMemoryGuards';

describe('dateStateSaveSignature', () => {
    it('ignores timestamp but notices real changes', () => {
        const base: any = { currentText: 'a', dialogueQueue: [], dialogueIndex: 0, timestamp: 1 };
        expect(dateStateSaveSignature({ ...base, timestamp: 999 })).toBe(dateStateSaveSignature(base));
        expect(dateStateSaveSignature({ ...base, currentText: 'b' })).not.toBe(dateStateSaveSignature(base));
    });
});

describe('trimDateVoiceCache', () => {
    it('drops oldest entries, revokes blobs, keeps the playing one', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const cache: Record<string, { url: string }> = {};
        for (let i = 0; i < 5; i++) cache[`k${i}`] = { url: `blob:x/${i}` };
        const released = trimDateVoiceCache(cache, 'blob:x/0', 3);
        expect(released).toBe(2);
        expect(Object.keys(cache)).toEqual(['k0', 'k3', 'k4']);
        expect(revoke).toHaveBeenCalledWith('blob:x/1');
        expect(revoke).toHaveBeenCalledWith('blob:x/2');
        revoke.mockRestore();
    });

    it('releaseDateVoiceCache empties the cache and skips non-blob urls', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const cache: Record<string, { url: string }> = { a: { url: 'blob:y/1' }, b: { url: 'https://cdn/x.mp3' } };
        releaseDateVoiceCache(cache);
        expect(Object.keys(cache)).toEqual([]);
        expect(revoke).toHaveBeenCalledTimes(1);
        revoke.mockRestore();
    });
});
