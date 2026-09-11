import { afterEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import {
    cleanupExpiredAudioAssets,
    TEMP_AUDIO_TTL_MS,
} from './audioRetention';
import {
    removeVoiceFavorite,
    saveVoiceFavorite,
    getVoiceFavoriteBlob,
    voiceFavoriteAudioAssetId,
} from './voiceFavorites';

const TEST_CHAR_ID = `audio-retention-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ownedAssetIds = new Set<string>();
const ownedFavoriteIds = new Set<string>();

const saveVoiceMessage = async (timestamp: number, data: Record<string, unknown>, charId = TEST_CHAR_ID) => {
    const messageId = await DB.saveMessage({
        charId,
        role: 'user',
        type: 'voice',
        content: '这段转写文字必须保留',
        timestamp,
    });
    const assetId = `voice_msg_${messageId}`;
    ownedAssetIds.add(assetId);
    await DB.saveAssetRaw(assetId, data);
    return messageId;
};

afterEach(async () => {
    await Promise.all([...ownedFavoriteIds].map(async favoriteId => {
        await removeVoiceFavorite('chat', favoriteId).catch(() => undefined);
        await DB.deleteAsset(voiceFavoriteAudioAssetId(favoriteId)).catch(() => undefined);
    }));
    ownedFavoriteIds.clear();
    await Promise.all([...ownedAssetIds].map(assetId => DB.deleteAsset(assetId).catch(() => undefined)));
    ownedAssetIds.clear();
});

describe('audio retention', () => {
    it('deletes expired voice/TTS assets but keeps the message text', async () => {
        const now = 4_000_000_000_000;
        const old = now - TEMP_AUDIO_TTL_MS - 1;
        const messageId = await saveVoiceMessage(old, {
            blob: new Blob(['recording'], { type: 'audio/webm' }),
            originalText: '这段转写文字必须保留',
        });
        const ttsId = `tts_audio-retention-old-${Date.now()}`;
        ownedAssetIds.add(ttsId);
        await DB.saveAssetRaw(ttsId, {
            blob: new Blob(['tts'], { type: 'audio/mpeg' }),
            createdAt: old,
            // Touching a cache entry must not extend its 24-hour lifetime.
            lastUsedAt: now,
        });

        const stats = await cleanupExpiredAudioAssets({ now });

        expect(stats.deletedAssetIds).toEqual(expect.arrayContaining([`voice_msg_${messageId}`, ttsId]));
        expect(await DB.getAssetRaw(`voice_msg_${messageId}`)).toBeNull();
        expect(await DB.getAssetRaw(ttsId)).toBeNull();
        const message = (await DB.getMessagesByCharId(TEST_CHAR_ID, true)).find(item => item.id === messageId);
        expect(message?.content).toBe('这段转写文字必须保留');
    });

    it('keeps fresh and favorited audio, and does not touch companion preset audio', async () => {
        const now = 4_000_000_000_000;
        const fresh = now - TEMP_AUDIO_TTL_MS + 1;
        const old = now - TEMP_AUDIO_TTL_MS - 1;
        const freshId = await saveVoiceMessage(fresh, {
            blob: new Blob(['fresh']),
            originalText: 'fresh',
            createdAt: fresh,
        });
        const favoriteMessageId = await saveVoiceMessage(old, {
            blob: new Blob(['favorite']),
            originalText: 'favorite',
            createdAt: old,
        });
        const favoriteSourceKey = `${TEST_CHAR_ID}:${favoriteMessageId}`;
        const favorite = await saveVoiceFavorite({
            source: 'chat',
            sourceKey: favoriteSourceKey,
            charId: TEST_CHAR_ID,
            charName: 'Retention Test',
            sourceTimestamp: old,
            originalText: 'favorite',
            blob: new Blob(['favorite-copy'], { type: 'audio/mpeg' }),
        });
        ownedFavoriteIds.add(favoriteSourceKey);

        const companionId = `companion-startup-voice:${TEST_CHAR_ID}:retention-test`;
        ownedAssetIds.add(companionId);
        await DB.saveAssetRaw(companionId, {
            blob: new Blob(['preset']),
            savedAt: old,
        });

        await cleanupExpiredAudioAssets({ now });

        expect(await DB.getAssetRaw(`voice_msg_${freshId}`)).not.toBeNull();
        expect(await DB.getAssetRaw(`voice_msg_${favoriteMessageId}`)).not.toBeNull();
        expect(await getVoiceFavoriteBlob(favorite.id)).not.toBeNull();
        expect(await DB.getAssetRaw(companionId)).not.toBeNull();
    });

    it('uses legacy message time and conservatively keeps unknown-time voice rows', async () => {
        const now = 4_000_000_000_000;
        const old = now - TEMP_AUDIO_TTL_MS - 1;
        const legacyId = await saveVoiceMessage(old, { blob: new Blob(['legacy']) });
        const unknownId = 987654321;
        const unknownAssetId = `voice_msg_${unknownId}`;
        ownedAssetIds.add(unknownAssetId);
        await DB.saveAssetRaw(unknownAssetId, { blob: new Blob(['unknown']) });

        const stats = await cleanupExpiredAudioAssets({ now });

        expect(await DB.getAssetRaw(`voice_msg_${legacyId}`)).toBeNull();
        expect(await DB.getAssetRaw(unknownAssetId)).not.toBeNull();
        expect(stats.skippedUnknownTime).toBeGreaterThanOrEqual(1);
    });
});

