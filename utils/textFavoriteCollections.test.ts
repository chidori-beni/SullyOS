import { beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import {
    TEXT_FAVORITE_COLLECTIONS_INDEX_ASSET_ID,
    makeTextFavoriteCollectionId,
    normalizeTextFavoriteCollectionMessages,
    listTextFavoriteCollections,
    removeTextFavoriteCollection,
    upsertTextFavoriteCollection,
} from './textFavoriteCollections';

const base = {
    source: 'chat' as const,
    charId: 'char-1',
    charName: 'Sully',
};

const message = (messageId: number, content: string, role: 'user' | 'assistant' = 'assistant') => ({
    messageId,
    role,
    speakerName: role === 'user' ? '我' : 'Sully',
    timestamp: messageId * 100,
    content,
});

beforeEach(async () => {
    await DB.deleteAsset(TEXT_FAVORITE_COLLECTIONS_INDEX_ASSET_ID);
});

describe('text favorite collections repository', () => {
    it('uses a canonical id and keeps selected messages in chat order', () => {
        expect(makeTextFavoriteCollectionId('chat', 'char-1', [3, 1, 2]))
            .toBe(makeTextFavoriteCollectionId('chat', 'char-1', [2, 3, 1]));
        expect(makeTextFavoriteCollectionId('chat', 'char-1', [1, 2]))
            .not.toBe(makeTextFavoriteCollectionId('chat', 'char-1', [1, 3]));

        const normalized = normalizeTextFavoriteCollectionMessages([
            message(3, '第三句'),
            message(1, '第一句'),
            message(2, '第二句'),
            message(2, '重复的第二句'),
            message(4, '<语音>不应出现在文字收藏</语音>'),
        ]);
        expect(normalized.map(item => item.messageId)).toEqual([1, 2, 3]);
        expect(normalized.map(item => item.content)).toEqual(['第一句', '第二句', '第三句']);
    });

    it('upserts one immutable group without changing its original save time', async () => {
        const first = await upsertTextFavoriteCollection({
            ...base,
            favoritedAt: 10,
            messages: [message(2, '后一句'), message(1, '前一句', 'user')],
        });
        expect(first.created).toBe(true);
        expect(first.collection.messages.map(item => item.messageId)).toEqual([1, 2]);

        const second = await upsertTextFavoriteCollection({
            ...base,
            favoritedAt: 20,
            messages: [message(1, '前一句', 'user'), message(2, '后一句')],
        });
        expect(second.created).toBe(false);

        const collections = await listTextFavoriteCollections();
        expect(collections).toHaveLength(1);
        expect(collections[0].favoritedAt).toBe(10);
        expect(collections[0].messages.map(item => item.content)).toEqual(['前一句', '后一句']);
    });

    it('rejects a group with no readable text and leaves the index untouched', async () => {
        await expect(upsertTextFavoriteCollection({
            ...base,
            messages: [message(1, '<语音>只有协议内容</语音>')],
        })).rejects.toThrow('没有可收藏的文字消息');
        expect(await listTextFavoriteCollections()).toEqual([]);
    });

    it('removes a whole group as one favorite', async () => {
        const { collection } = await upsertTextFavoriteCollection({ ...base, messages: [message(1, '第一句'), message(2, '第二句')] });
        expect(await removeTextFavoriteCollection(collection.id)).toBe(true);
        expect(await listTextFavoriteCollections()).toEqual([]);
        expect(await removeTextFavoriteCollection(collection.id)).toBe(false);
    });

    it('skips malformed persisted groups but keeps valid groups', async () => {
        const { collection } = await upsertTextFavoriteCollection({ ...base, messages: [message(1, '保留这组')] });
        await DB.saveAssetRaw(TEXT_FAVORITE_COLLECTIONS_INDEX_ASSET_ID, {
            version: 1,
            items: [
                { id: 'bad', schemaVersion: 1, source: 'chat', charId: 'char-1', charName: '坏数据', favoritedAt: 1, messages: [] },
                collection,
            ],
        });
        expect((await listTextFavoriteCollections()).map(item => item.id)).toEqual([collection.id]);
    });
});
