/**
 * Local retention policy for reproducible speech and chat voice recordings.
 *
 * Messages and their audio live in different IndexedDB records. This module
 * only ever deletes rows from `assets`; it must never delete or rewrite a
 * message, its transcript, or memory data.
 */
import { DB } from './db';
import { TTS_CACHE_ASSET_PREFIX } from './ttsCache';
import { listVoiceFavorites } from './voiceFavorites';
import { VOICE_MESSAGE_ASSET_PREFIX } from './voiceMessageBackup';

export const TEMP_AUDIO_TTL_MS = 24 * 60 * 60 * 1000;
export const AUDIO_RETENTION_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const AUDIO_ASSETS_CLEANED_EVENT = 'sully:audio-assets-cleaned';

export interface AudioRetentionStats {
    scanned: number;
    deleted: number;
    keptFavorited: number;
    skippedUnknownTime: number;
    errors: number;
    deletedAssetIds: string[];
}

export interface AudioRetentionOptions {
    /** Injectable clock for tests; production callers can omit it. */
    now?: number;
    /** Injectable TTL for tests; production uses the 24-hour policy. */
    ttlMs?: number;
}

const emptyStats = (): AudioRetentionStats => ({
    scanned: 0,
    deleted: 0,
    keptFavorited: 0,
    skippedUnknownTime: 0,
    errors: 0,
    deletedAssetIds: [],
});

const coerceTimestamp = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const isExpired = (timestamp: number | null, now: number, ttlMs: number): boolean => (
    timestamp !== null && timestamp <= now - ttlMs
);

const readCreatedAt = (data: unknown): number | null => {
    if (!data || typeof data !== 'object') return null;
    const entry = data as Record<string, unknown>;
    // `savedAt` is accepted only as a compatibility fallback for old voice
    // rows that used that name. TTS cache rows are checked against createdAt
    // explicitly below so a touch timestamp can never extend their lifetime.
    return coerceTimestamp(entry.createdAt) ?? coerceTimestamp(entry.savedAt);
};

const readTtsCreatedAt = (data: unknown): number | null => {
    if (!data || typeof data !== 'object') return null;
    return coerceTimestamp((data as Record<string, unknown>).createdAt);
};

const parseVoiceMessageId = (assetId: string): number | null => {
    const suffix = assetId.slice(VOICE_MESSAGE_ASSET_PREFIX.length);
    if (!/^\d+$/.test(suffix)) return null;
    const id = Number(suffix);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/**
 * Chat favorites use `${charId}:${messageId}` as their source key. Message
 * ids are IndexedDB auto-increment ids and therefore globally unique; matching
 * the numeric suffix lets the retention sweep protect a favorite without
 * loading the whole message record just to obtain charId.
 */
const favoriteChatMessageIds = (items: Awaited<ReturnType<typeof listVoiceFavorites>>): Set<number> => {
    const ids = new Set<number>();
    for (const item of items) {
        if (item.source !== 'chat') continue;
        const match = item.sourceKey.match(/:(\d+)$/);
        if (!match) continue;
        const id = Number(match[1]);
        if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
    return ids;
};

const notifyCleaned = (assetIds: string[]) => {
    if (!assetIds.length || typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(AUDIO_ASSETS_CLEANED_EVENT, {
        detail: { assetIds },
    }));
};

const batch = <T,>(items: T[], size: number): T[][] => {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }
    return result;
};

const performCleanup = async (options: AudioRetentionOptions = {}): Promise<AudioRetentionStats> => {
    const stats = emptyStats();
    const now = coerceTimestamp(options.now) ?? Date.now();
    const ttlMs = typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs > 0
        ? options.ttlMs
        : TEMP_AUDIO_TTL_MS;

    // A key-only cursor avoids getAllAssets(), which would clone every image,
    // wallpaper, and audio Blob into memory in one go.
    const [voiceKeys, ttsKeys] = await Promise.all([
        DB.getAssetKeysByPrefix(VOICE_MESSAGE_ASSET_PREFIX).catch(error => {
            stats.errors++;
            console.warn('[audio-retention] voice key scan failed', error);
            return [] as string[];
        }),
        DB.getAssetKeysByPrefix(TTS_CACHE_ASSET_PREFIX).catch(error => {
            stats.errors++;
            console.warn('[audio-retention] TTS key scan failed', error);
            return [] as string[];
        }),
    ]);
    stats.scanned = voiceKeys.length + ttsKeys.length;

    const favoriteItems = await listVoiceFavorites().catch(error => {
        // This is normally an empty/missing index on a new install. If an
        // actual read fails, keep all voice_msg rows for this run rather than
        // risk deleting a favorite whose index we could not inspect.
        stats.errors++;
        console.warn('[audio-retention] favorite index read failed', error);
        return null;
    });
    const favoriteIndexUnavailable = favoriteItems === null;
    const favoriteMessageIds = favoriteChatMessageIds(favoriteItems || []);
    const voiceMessageIds = voiceKeys
        .map(parseVoiceMessageId)
        .filter((id): id is number => id !== null);
    let messageTimestamps = new Map<number, number>();
    if (voiceMessageIds.length) {
        try {
            messageTimestamps = await DB.getMessageTimestampsByIds(voiceMessageIds);
        } catch (error) {
            // New rows have createdAt. Only the legacy fallback is unavailable
            // in this case, so unknown-time rows remain protected.
            stats.errors++;
            console.warn('[audio-retention] message timestamp lookup failed', error);
        }
    }

    const protectedVoiceIds = new Set<number>(favoriteMessageIds);
    if (favoriteIndexUnavailable) {
        // listVoiceFavorites normally resolves to [] for a missing index, but
        // a rejected read is different: do not delete any voice_msg row.
        voiceKeys.forEach(assetId => {
            const messageId = parseVoiceMessageId(assetId);
            if (messageId !== null) protectedVoiceIds.add(messageId);
        });
    }
    stats.keptFavorited += protectedVoiceIds.size;

    const deletedIds: string[] = [];
    for (const ids of batch(voiceKeys, 50)) {
        try {
            const deleted = await DB.deleteAssetsIf(ids, (assetId, data) => {
                if (favoriteIndexUnavailable) return false;
                // The legacy per-message marker is still honored until the
                // chat hydration migration can copy it into the archive index.
                if (data && typeof data === 'object' && (data as Record<string, unknown>).favorite === true) return false;
                const messageId = parseVoiceMessageId(assetId);
                if (messageId !== null && protectedVoiceIds.has(messageId)) return false;
                const timestamp = readCreatedAt(data)
                    ?? (messageId !== null ? messageTimestamps.get(messageId) ?? null : null);
                if (timestamp === null) {
                    stats.skippedUnknownTime++;
                    return false;
                }
                return isExpired(timestamp, now, ttlMs);
            });
            deletedIds.push(...deleted);
        } catch (error) {
            stats.errors++;
            console.warn('[audio-retention] voice asset cleanup failed', error);
        }
    }

    for (const ids of batch(ttsKeys, 50)) {
        try {
            const deleted = await DB.deleteAssetsIf(ids, (_assetId, data) => (
                isExpired(readTtsCreatedAt(data), now, ttlMs)
            ));
            deletedIds.push(...deleted);
        } catch (error) {
            stats.errors++;
            console.warn('[audio-retention] TTS cache cleanup failed', error);
        }
    }

    stats.deletedAssetIds = [...new Set(deletedIds)];
    stats.deleted = stats.deletedAssetIds.length;
    notifyCleaned(stats.deletedAssetIds);
    return stats;
};

let cleanupInFlight: Promise<AudioRetentionStats> | null = null;

/**
 * Run one non-blocking, single-flight retention sweep. Callers may invoke this
 * from multiple lifecycle hooks; concurrent calls share the same promise.
 */
export const cleanupExpiredAudioAssets = (options: AudioRetentionOptions = {}): Promise<AudioRetentionStats> => {
    if (cleanupInFlight) return cleanupInFlight;
    const current = performCleanup(options).catch(error => {
        const stats = emptyStats();
        stats.errors = 1;
        console.warn('[audio-retention] cleanup failed', error);
        return stats;
    });
    cleanupInFlight = current;
    void current.finally(() => {
        if (cleanupInFlight === current) cleanupInFlight = null;
    });
    return current;
};
