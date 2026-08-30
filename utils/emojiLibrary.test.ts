import { describe, expect, it } from 'vitest';
import type { Emoji } from '../types';
import { sortEmojisForDisplay } from './emojiLibrary';

const emoji = (name: string, movedToFrontAt?: number): Emoji => ({
    name,
    url: `https://example.com/${name}.png`,
    movedToFrontAt,
});

describe('sortEmojisForDisplay', () => {
    it('未操作的旧表情保留原顺序', () => {
        expect(sortEmojisForDisplay([emoji('a'), emoji('b'), emoji('c')]).map(item => item.name))
            .toEqual(['a', 'b', 'c']);
    });

    it('最近移至最前的表情排在第一个', () => {
        expect(sortEmojisForDisplay([emoji('a', 10), emoji('b'), emoji('c', 20)]).map(item => item.name))
            .toEqual(['c', 'a', 'b']);
    });
});
