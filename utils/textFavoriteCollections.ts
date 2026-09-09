import { DB } from './db';
import {
    cleanTextForFavorite,
    makeTextFavoriteId,
    type TextFavoriteRole,
    type TextFavoriteSource,
} from './textFavorites';

export const TEXT_FAVORITE_COLLECTIONS_INDEX_ASSET_ID = 'text_favorite_collections_index_v1';
export const TEXT_FAVORITE_COLLECTIONS_CHANGED_EVENT = 'sully:text-favorite-collections-changed';
export const TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION = 1 as const;

// 这些上限只防止一次误选把 IndexedDB 塞满；超限时整组失败，不截断、不淘汰旧收藏。
export const MAX_TEXT_FAVORITE_COLLECTION_MESSAGES = 200;
export const MAX_TEXT_FAVORITE_COLLECTION_CHARS = 240_000;
export const MAX_TEXT_FAVORITE_COLLECTIONS = 200;

export interface TextFavoriteCollectionMessageInput {
    messageId: number;
    role: TextFavoriteRole;
    speakerName: string;
    timestamp: number;
    content: string;
}

export interface TextFavoriteCollectionMessage {
    messageId: number;
    role: TextFavoriteRole;
    speakerName: string;
    timestamp: number;
    content: string;
}

export interface TextFavoriteCollection {
    schemaVersion: typeof TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION;
    id: string;
    source: TextFavoriteSource;
    charId: string;
    charName: string;
    favoritedAt: number;
    messages: TextFavoriteCollectionMessage[];
}

export interface UpsertTextFavoriteCollectionInput {
    source: TextFavoriteSource;
    charId: string;
    charName: string;
    messages: TextFavoriteCollectionMessageInput[];
    favoritedAt?: number;
    /** Optional only for tests/imports; normal chat saves use the deterministic id. */
    id?: string;
}

export interface UpsertTextFavoriteCollectionResult {
    collection: TextFavoriteCollection;
    created: boolean;
}

interface TextFavoriteCollectionIndex {
    version: typeof TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION;
    items: TextFavoriteCollection[];
}

let writeQueue: Promise<unknown> = Promise.resolve();

const withWriteLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(work, work);
    writeQueue = next.catch(() => undefined);
    return next;
};

const isSource = (value: unknown): value is TextFavoriteSource => value === 'chat';
const isRole = (value: unknown): value is TextFavoriteRole => value === 'user' || value === 'assistant';

const normalizeTimestamp = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const normalizeMessageId = (value: unknown): number | null => (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
);

const sanitizeMessage = (value: unknown, fallbackTimestamp: number): TextFavoriteCollectionMessage | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<TextFavoriteCollectionMessage>;
    const messageId = normalizeMessageId(item.messageId);
    if (messageId == null || !isRole(item.role)) return null;
    if (typeof item.speakerName !== 'string') return null;
    if (typeof item.content !== 'string') return null;
    const content = cleanTextForFavorite(item.content);
    if (!content) return null;
    return {
        messageId,
        role: item.role,
        speakerName: item.speakerName.trim() || (item.role === 'user' ? '我' : '未知角色'),
        timestamp: normalizeTimestamp(item.timestamp, fallbackTimestamp),
        content,
    };
};

const sanitizeCollection = (value: unknown): TextFavoriteCollection | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<TextFavoriteCollection>;
    if (item.schemaVersion !== TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION) return null;
    if (typeof item.id !== 'string' || !item.id.trim()) return null;
    if (!isSource(item.source)) return null;
    if (typeof item.charId !== 'string' || !item.charId.trim()) return null;
    if (typeof item.charName !== 'string') return null;

    const favoritedAt = normalizeTimestamp(item.favoritedAt, Date.now());
    const rawMessages = Array.isArray(item.messages) ? item.messages : [];
    const byMessageId = new Map<number, TextFavoriteCollectionMessage>();
    rawMessages.forEach(raw => {
        const message = sanitizeMessage(raw, favoritedAt);
        if (message && !byMessageId.has(message.messageId)) byMessageId.set(message.messageId, message);
    });
    const messages = [...byMessageId.values()].sort((a, b) => a.messageId - b.messageId);
    if (!messages.length) return null;

    return {
        schemaVersion: TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION,
        id: item.id.trim(),
        source: item.source,
        charId: item.charId.trim(),
        charName: item.charName.trim() || '未知角色',
        favoritedAt,
        messages,
    };
};

const loadIndex = async (): Promise<TextFavoriteCollection[]> => {
    const raw = await DB.getAssetRaw(TEXT_FAVORITE_COLLECTIONS_INDEX_ASSET_ID).catch(() => null) as unknown;
    const items = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as Partial<TextFavoriteCollectionIndex>).items)
            ? (raw as Partial<TextFavoriteCollectionIndex>).items!
            : [];
    return items.map(sanitizeCollection).filter((item): item is TextFavoriteCollection => !!item);
};

const saveIndex = async (items: TextFavoriteCollection[]): Promise<void> => {
    await DB.saveAssetRaw(TEXT_FAVORITE_COLLECTIONS_INDEX_ASSET_ID, {
        version: TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION,
        items,
    } satisfies TextFavoriteCollectionIndex);
};

/**
 * The chat selection UI supplies messages in display order. Re-normalize here so
 * callers cannot accidentally save a Set's iteration order or duplicate a message.
 */
export const normalizeTextFavoriteCollectionMessages = (
    messages: TextFavoriteCollectionMessageInput[],
): TextFavoriteCollectionMessage[] => {
    const byMessageId = new Map<number, TextFavoriteCollectionMessage>();
    for (const message of messages || []) {
        const messageId = normalizeMessageId(message?.messageId);
        if (messageId == null || !isRole(message?.role) || typeof message?.content !== 'string') continue;
        const content = cleanTextForFavorite(message.content);
        if (!content || byMessageId.has(messageId)) continue;
        byMessageId.set(messageId, {
            messageId,
            role: message.role,
            speakerName: typeof message.speakerName === 'string' && message.speakerName.trim()
                ? message.speakerName.trim()
                : message.role === 'user' ? '我' : '未知角色',
            timestamp: normalizeTimestamp(message.timestamp, Date.now()),
            content,
        });
    }
    return [...byMessageId.values()].sort((a, b) => a.messageId - b.messageId);
};

/** A stable id makes pressing「收藏为一组」twice an upsert, not a duplicate. */
export const makeTextFavoriteCollectionId = (
    source: TextFavoriteSource,
    charId: string,
    messageIds: number[],
): string => {
    const canonicalIds = [...new Set((messageIds || []).filter(id => Number.isSafeInteger(id) && id > 0))]
        .sort((a, b) => a - b);
    return `text_collection_${makeTextFavoriteId(source, `${charId}\u0000${canonicalIds.join(',')}`)}`;
};

export const sortTextFavoriteCollections = (items: TextFavoriteCollection[]): TextFavoriteCollection[] => (
    [...items].sort((a, b) => b.favoritedAt - a.favoritedAt || b.id.localeCompare(a.id))
);

export const listTextFavoriteCollections = async (): Promise<TextFavoriteCollection[]> => (
    sortTextFavoriteCollections(await loadIndex())
);

export const upsertTextFavoriteCollection = async (
    input: UpsertTextFavoriteCollectionInput,
): Promise<UpsertTextFavoriteCollectionResult> => withWriteLock(async () => {
    if (!isSource(input.source)) throw new Error('不支持的收藏来源');
    if (typeof input.charId !== 'string' || !input.charId.trim()) throw new Error('收藏角色不存在');

    const messages = normalizeTextFavoriteCollectionMessages(input.messages);
    if (!messages.length) throw new Error('没有可收藏的文字消息');
    if (messages.length > MAX_TEXT_FAVORITE_COLLECTION_MESSAGES) {
        throw new Error(`一次最多收藏 ${MAX_TEXT_FAVORITE_COLLECTION_MESSAGES} 条文字消息`);
    }
    const totalChars = messages.reduce((total, message) => total + message.content.length, 0);
    if (totalChars > MAX_TEXT_FAVORITE_COLLECTION_CHARS) {
        throw new Error('这组文字太长，请分成两组收藏');
    }

    const current = await loadIndex();
    const id = input.id?.trim() || makeTextFavoriteCollectionId(input.source, input.charId.trim(), messages.map(message => message.messageId));
    const existing = current.find(item => item.id === id);
    if (!existing && current.length >= MAX_TEXT_FAVORITE_COLLECTIONS) {
        throw new Error('文字收藏组已达到上限，请先删除旧收藏');
    }

    const collection: TextFavoriteCollection = {
        schemaVersion: TEXT_FAVORITE_COLLECTION_SCHEMA_VERSION,
        id,
        source: input.source,
        charId: input.charId.trim(),
        charName: typeof input.charName === 'string' && input.charName.trim() ? input.charName.trim() : '未知角色',
        favoritedAt: existing?.favoritedAt || normalizeTimestamp(input.favoritedAt, Date.now()),
        messages,
    };
    await saveIndex([collection, ...current.filter(item => item.id !== id)]);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TEXT_FAVORITE_COLLECTIONS_CHANGED_EVENT));
    return { collection, created: !existing };
});

export const removeTextFavoriteCollection = async (collectionId: string): Promise<boolean> => withWriteLock(async () => {
    const current = await loadIndex();
    if (!current.some(item => item.id === collectionId)) return false;
    await saveIndex(current.filter(item => item.id !== collectionId));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TEXT_FAVORITE_COLLECTIONS_CHANGED_EVENT));
    return true;
});
