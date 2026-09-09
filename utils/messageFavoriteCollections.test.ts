import { beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import {
    MESSAGE_FAVORITE_COLLECTIONS_INDEX_ASSET_ID,
    MESSAGE_FAVORITE_COLLECTION_COLLAPSE_THRESHOLD,
    MESSAGE_FAVORITE_COLLECTION_PREVIEW_COUNT,
    getMessageFavoriteCollectionVisibleMessages,
    makeMessageFavoriteCollectionId,
    messageFavoriteCollectionMediaAssetId,
    normalizeMessageFavoriteCollectionMessages,
    getMessageFavoriteCollectionMediaBlob,
    listMessageFavoriteCollections,
    removeMessageFavoriteCollection,
    saveMessageFavoriteCollectionMedia,
    upsertMessageFavoriteCollection,
} from './messageFavoriteCollections';

const base = {
    source: 'chat' as const,
    charId: 'char-media-1',
    charName: 'Sully',
};

const message = (
    messageId: number,
    kind: 'text' | 'voice' | 'emoji' | 'image',
    content: string,
    role: 'user' | 'assistant' = 'assistant',
) => ({
    messageId,
    role,
    speakerName: role === 'user' ? '我' : 'Sully',
    timestamp: messageId * 100,
    kind,
    content,
});

const cleanupMedia = async () => {
    const ids = [
        makeMessageFavoriteCollectionId('chat', base.charId, [1, 2, 3]),
        makeMessageFavoriteCollectionId('chat', base.charId, [1]),
    ];
    const assetPromises = ids.flatMap(id => [1, 2, 3].flatMap(messageId => (
        (['voice', 'emoji', 'image'] as const).map(kind => (
            DB.deleteAsset(messageFavoriteCollectionMediaAssetId(id, messageId, kind))
        ))
    )));
    await Promise.all(assetPromises);
};

beforeEach(async () => {
    await DB.deleteAsset(MESSAGE_FAVORITE_COLLECTIONS_INDEX_ASSET_ID);
    await cleanupMedia();
});

describe('message favorite collections repository', () => {
    it('collapses only groups longer than five messages to the first three previews', () => {
        expect(MESSAGE_FAVORITE_COLLECTION_COLLAPSE_THRESHOLD).toBe(5);
        expect(MESSAGE_FAVORITE_COLLECTION_PREVIEW_COUNT).toBe(3);
        expect(getMessageFavoriteCollectionVisibleMessages([1, 2, 3, 4, 5], false)).toEqual([1, 2, 3, 4, 5]);
        expect(getMessageFavoriteCollectionVisibleMessages([1, 2, 3, 4, 5, 6], false)).toEqual([1, 2, 3]);
        expect(getMessageFavoriteCollectionVisibleMessages([1, 2, 3, 4, 5, 6], true)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('normalizes mixed messages in chat order and keeps media fallback labels readable', () => {
        const normalized = normalizeMessageFavoriteCollectionMessages([
            message(3, 'emoji', 'data:image/png;base64,AAAA'),
            message(1, 'text', '第一句', 'user'),
            message(2, 'voice', '<语音>音频协议</语音>'),
            message(2, 'voice', '重复语音'),
        ]);
        expect(normalized.map(item => item.messageId)).toEqual([1, 2, 3]);
        expect(normalized.map(item => item.kind)).toEqual(['text', 'voice', 'emoji']);
        expect(normalized[1].content).toBe('（语音消息）');
        expect(normalized[2].content).toBe('（表情包）');
    });

    it('persists an audio asset and upserts the same mixed group idempotently', async () => {
        const id = makeMessageFavoriteCollectionId('chat', base.charId, [1, 2, 3]);
        const audioKey = messageFavoriteCollectionMediaAssetId(id, 2, 'voice');
        const audio = new Blob(['audio'], { type: 'audio/wav' });
        await saveMessageFavoriteCollectionMedia(audioKey, audio);

        const first = await upsertMessageFavoriteCollection({
            ...base,
            favoritedAt: 10,
            id,
            messages: [
                { ...message(3, 'emoji', '表情'), media: { remoteUrl: 'https://example.com/emoji.png' } },
                { ...message(2, 'voice', '语音转写'), media: { assetKey: audioKey, mimeType: 'audio/wav' } },
                message(1, 'text', '第一句', 'user'),
            ],
        });
        expect(first.created).toBe(true);
        expect(first.collection.messages.map(item => item.messageId)).toEqual([1, 2, 3]);
        expect(await getMessageFavoriteCollectionMediaBlob(audioKey)).toBeInstanceOf(Blob);

        const second = await upsertMessageFavoriteCollection({
            ...base,
            favoritedAt: 20,
            id,
            messages: [message(1, 'text', '更新后的第一句', 'user'), message(2, 'voice', '语音转写', 'assistant')],
        });
        expect(second.created).toBe(false);
        expect((await listMessageFavoriteCollections())).toHaveLength(1);
        expect((await listMessageFavoriteCollections())[0].favoritedAt).toBe(10);
        expect(await getMessageFavoriteCollectionMediaBlob(audioKey)).toBeNull();
    });

    it('removes the collection and its media asset as one favorite', async () => {
        const id = makeMessageFavoriteCollectionId('chat', base.charId, [1]);
        const imageKey = messageFavoriteCollectionMediaAssetId(id, 1, 'image');
        await saveMessageFavoriteCollectionMedia(imageKey, new Blob(['image'], { type: 'image/png' }));
        await upsertMessageFavoriteCollection({
            ...base,
            id,
            messages: [{ ...message(1, 'image', '图片'), media: { assetKey: imageKey } }],
        });

        expect(await removeMessageFavoriteCollection(id)).toBe(true);
        expect(await listMessageFavoriteCollections()).toEqual([]);
        expect(await getMessageFavoriteCollectionMediaBlob(imageKey)).toBeNull();
        expect(await removeMessageFavoriteCollection(id)).toBe(false);
    });

    it('skips malformed v2 groups while keeping valid records readable', async () => {
        const id = makeMessageFavoriteCollectionId('chat', base.charId, [1]);
        await upsertMessageFavoriteCollection({ ...base, id, messages: [message(1, 'text', '保留这组')] });
        await DB.saveAssetRaw(MESSAGE_FAVORITE_COLLECTIONS_INDEX_ASSET_ID, {
            version: 2,
            items: [
                { id: 'bad', schemaVersion: 2, source: 'chat', charId: base.charId, charName: '坏数据', favoritedAt: 1, messages: [] },
                { id, schemaVersion: 2, source: 'chat', charId: base.charId, charName: 'Sully', favoritedAt: 2, messages: [{ ...message(1, 'text', '保留这组') }] },
            ],
        });
        expect((await listMessageFavoriteCollections()).map(item => item.id)).toEqual([id]);
    });
});
