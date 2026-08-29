import { beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import {
    TEXT_FAVORITES_INDEX_ASSET_ID,
    cleanTextForFavorite,
    getTextFavorite,
    listTextFavorites,
    makeTextFavoriteId,
    makeTextFavoriteSourceKey,
    removeTextFavorite,
    saveTextFavorite,
    sortTextFavorites,
    type TextFavorite,
} from './textFavorites';

const base = {
    source: 'chat' as const,
    sourceKey: makeTextFavoriteSourceKey('char-1', 1),
    messageId: 1,
    charId: 'char-1',
    charName: 'Sully',
    role: 'assistant' as const,
    sourceTimestamp: 100,
    content: '今天也要好好吃饭。',
};

beforeEach(async () => {
    await DB.deleteAsset(TEXT_FAVORITES_INDEX_ASSET_ID);
});

describe('text favorites repository', () => {
    it('uses a stable id and keeps text metadata newest-first', async () => {
        expect(makeTextFavoriteId('chat', base.sourceKey)).toBe(makeTextFavoriteId('chat', base.sourceKey));
        expect(makeTextFavoriteId('chat', base.sourceKey)).not.toBe(makeTextFavoriteId('chat', 'char-1:2'));

        await saveTextFavorite({ ...base, favoritedAt: 10 });
        await saveTextFavorite({
            ...base,
            sourceKey: makeTextFavoriteSourceKey('char-1', 2),
            messageId: 2,
            sourceTimestamp: 200,
            content: '别忘了回来。',
            favoritedAt: 20,
        });

        const items = await listTextFavorites();
        expect(items.map(item => item.messageId)).toEqual([2, 1]);
        expect(items[0].content).toBe('别忘了回来。');
    });

    it('upserts one chat message and removes it from the shared index', async () => {
        await saveTextFavorite(base);
        await saveTextFavorite({ ...base, content: '更新后的文字。' });

        expect((await listTextFavorites())).toHaveLength(1);
        expect((await getTextFavorite('chat', base.sourceKey))?.content).toBe('更新后的文字。');

        expect(await removeTextFavorite('chat', base.sourceKey)).toBe(true);
        expect(await listTextFavorites()).toEqual([]);
        expect(await getTextFavorite('chat', base.sourceKey)).toBeNull();
    });

    it('cleans transport markup but preserves ordinary text', () => {
        expect(cleanTextForFavorite('你好 [重要] <#0.4#>（轻笑）<语音>这段不该混进文字收藏</语音>')).toBe('你好 [重要] （轻笑）');
        expect(cleanTextForFavorite('第一句%%BILINGUAL%%Second line')).toBe('第一句\nSecond line');
    });

    it('sorts by source message time before favorite time', () => {
        const favorite = (id: string, sourceTimestamp: number): TextFavorite => ({
            ...base,
            id,
            sourceTimestamp,
            favoritedAt: id === 'old' ? 100 : 1,
        });
        expect(sortTextFavorites([favorite('old', 1), favorite('new', 2)]).map(item => item.id)).toEqual(['new', 'old']);
    });
});
