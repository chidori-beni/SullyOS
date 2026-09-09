import { DB } from './db';
import {
    cleanTextForFavorite,
    makeTextFavoriteId,
    type TextFavoriteRole,
    type TextFavoriteSource,
} from './textFavorites';

/**
 * Mixed message collections deliberately live beside, rather than inside, the
 * old text-only index. Older PWAs can therefore keep reading/writing v1 data
 * without stripping media fields they do not understand.
 */
export const MESSAGE_FAVORITE_COLLECTIONS_INDEX_ASSET_ID = 'message_favorite_collections_index_v2';
export const MESSAGE_FAVORITE_COLLECTIONS_CHANGED_EVENT = 'sully:message-favorite-collections-changed';
export const MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION = 2 as const;
export const MESSAGE_FAVORITE_COLLECTION_MEDIA_PREFIX = 'message_favorite_collection_media_';

export type MessageFavoriteCollectionMessageKind = 'text' | 'voice' | 'emoji' | 'image';

export interface MessageFavoriteCollectionMediaRef {
    /** A stable IndexedDB asset key. Never a short-lived blob: URL. */
    assetKey?: string;
    /** Only safe http(s) URLs are accepted as a remote fallback. */
    remoteUrl?: string;
    mimeType?: string;
}

export interface MessageFavoriteCollectionMessageInput {
    messageId: number;
    role: TextFavoriteRole;
    speakerName: string;
    timestamp: number;
    kind: MessageFavoriteCollectionMessageKind;
    /** Readable fallback text for media, or the message text for kind=text. */
    content: string;
    media?: MessageFavoriteCollectionMediaRef;
    spokenText?: string;
    lang?: string;
}

export interface MessageFavoriteCollectionMessage extends MessageFavoriteCollectionMessageInput {
    media?: MessageFavoriteCollectionMediaRef;
}

export interface MessageFavoriteCollection {
    schemaVersion: typeof MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION;
    id: string;
    source: TextFavoriteSource;
    charId: string;
    charName: string;
    favoritedAt: number;
    messages: MessageFavoriteCollectionMessage[];
}

export interface UpsertMessageFavoriteCollectionInput {
    source: TextFavoriteSource;
    charId: string;
    charName: string;
    messages: MessageFavoriteCollectionMessageInput[];
    favoritedAt?: number;
    /** Optional only for tests/imports; normal chat saves use the deterministic id. */
    id?: string;
}

export interface UpsertMessageFavoriteCollectionResult {
    collection: MessageFavoriteCollection;
    created: boolean;
}

interface MessageFavoriteCollectionIndex {
    version: typeof MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION;
    items: MessageFavoriteCollection[];
}

interface MessageFavoriteCollectionMediaAsset {
    blob: Blob;
    mimeType: string;
    savedAt: number;
}

const MAX_MESSAGE_FAVORITE_COLLECTION_MESSAGES = 200;
const MAX_MESSAGE_FAVORITE_COLLECTION_CHARS = 240_000;
const MAX_MESSAGE_FAVORITE_COLLECTIONS = 200;
export const MESSAGE_FAVORITE_COLLECTION_COLLAPSE_THRESHOLD = 5;
export const MESSAGE_FAVORITE_COLLECTION_PREVIEW_COUNT = 3;

export const getMessageFavoriteCollectionVisibleMessages = <T>(
    messages: readonly T[],
    expanded: boolean,
): T[] => messages.length > MESSAGE_FAVORITE_COLLECTION_COLLAPSE_THRESHOLD && !expanded
    ? [...messages].slice(0, MESSAGE_FAVORITE_COLLECTION_PREVIEW_COUNT)
    : [...messages];

let writeQueue: Promise<unknown> = Promise.resolve();

const withWriteLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(work, work);
    writeQueue = next.catch(() => undefined);
    return next;
};

const isSource = (value: unknown): value is TextFavoriteSource => value === 'chat';
const isRole = (value: unknown): value is TextFavoriteRole => value === 'user' || value === 'assistant';
const isKind = (value: unknown): value is MessageFavoriteCollectionMessageKind => (
    value === 'text' || value === 'voice' || value === 'emoji' || value === 'image'
);

const normalizeTimestamp = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const normalizeMessageId = (value: unknown): number | null => (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
);

const mediaPlaceholder = (kind: MessageFavoriteCollectionMessageKind): string => {
    if (kind === 'voice') return '（语音消息）';
    if (kind === 'emoji') return '（表情包）';
    if (kind === 'image') return '（图片）';
    return '';
};

const isSafeRemoteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const looksLikeMediaUrl = (value: string): boolean => (
    /^data:image\//i.test(value)
    || /^blob:/i.test(value)
    || isSafeRemoteUrl(value)
    || value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
);

const normalizeMediaRef = (value: unknown): MessageFavoriteCollectionMediaRef | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const item = value as Partial<MessageFavoriteCollectionMediaRef>;
    const assetKey = typeof item.assetKey === 'string'
        && item.assetKey.startsWith(MESSAGE_FAVORITE_COLLECTION_MEDIA_PREFIX)
        && item.assetKey.length <= 300
        ? item.assetKey.trim()
        : undefined;
    const remoteUrl = typeof item.remoteUrl === 'string' && isSafeRemoteUrl(item.remoteUrl.trim())
        ? item.remoteUrl.trim()
        : undefined;
    const mimeType = typeof item.mimeType === 'string' && item.mimeType.trim().length <= 120
        ? item.mimeType.trim() || undefined
        : undefined;
    if (!assetKey && !remoteUrl) return undefined;
    return { assetKey, remoteUrl, mimeType };
};

const normalizeContent = (
    raw: unknown,
    kind: MessageFavoriteCollectionMessageKind,
): string | null => {
    const cleaned = typeof raw === 'string' ? cleanTextForFavorite(raw) : '';
    if (kind === 'text') return cleaned || null;
    return cleaned && !looksLikeMediaUrl(cleaned) ? cleaned : mediaPlaceholder(kind);
};

const sanitizeMessage = (value: unknown, fallbackTimestamp: number): MessageFavoriteCollectionMessage | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<MessageFavoriteCollectionMessage>;
    const messageId = normalizeMessageId(item.messageId);
    if (messageId == null || !isRole(item.role) || !isKind(item.kind)) return null;
    if (typeof item.speakerName !== 'string') return null;
    const content = normalizeContent(item.content, item.kind);
    if (!content) return null;
    const spokenText = item.kind === 'voice' && typeof item.spokenText === 'string'
        ? cleanTextForFavorite(item.spokenText) || undefined
        : undefined;
    const lang = item.kind === 'voice' && typeof item.lang === 'string'
        ? item.lang.trim() || undefined
        : undefined;
    return {
        messageId,
        role: item.role,
        speakerName: item.speakerName.trim() || (item.role === 'user' ? '我' : '未知角色'),
        timestamp: normalizeTimestamp(item.timestamp, fallbackTimestamp),
        kind: item.kind,
        content,
        media: normalizeMediaRef(item.media),
        spokenText,
        lang,
    };
};

const sanitizeCollection = (value: unknown): MessageFavoriteCollection | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<MessageFavoriteCollection>;
    if (item.schemaVersion !== MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION) return null;
    if (typeof item.id !== 'string' || !item.id.trim()) return null;
    if (!isSource(item.source)) return null;
    if (typeof item.charId !== 'string' || !item.charId.trim()) return null;
    if (typeof item.charName !== 'string') return null;

    const favoritedAt = normalizeTimestamp(item.favoritedAt, Date.now());
    const rawMessages = Array.isArray(item.messages) ? item.messages : [];
    const byMessageId = new Map<number, MessageFavoriteCollectionMessage>();
    rawMessages.forEach(raw => {
        const message = sanitizeMessage(raw, favoritedAt);
        if (message && !byMessageId.has(message.messageId)) byMessageId.set(message.messageId, message);
    });
    const messages = [...byMessageId.values()].sort((a, b) => a.messageId - b.messageId);
    if (!messages.length) return null;

    return {
        schemaVersion: MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION,
        id: item.id.trim(),
        source: item.source,
        charId: item.charId.trim(),
        charName: item.charName.trim() || '未知角色',
        favoritedAt,
        messages,
    };
};

const loadIndex = async (): Promise<MessageFavoriteCollection[]> => {
    const raw = await DB.getAssetRaw(MESSAGE_FAVORITE_COLLECTIONS_INDEX_ASSET_ID).catch(() => null) as unknown;
    const items = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as Partial<MessageFavoriteCollectionIndex>).items)
            ? (raw as Partial<MessageFavoriteCollectionIndex>).items!
            : [];
    return items.map(sanitizeCollection).filter((item): item is MessageFavoriteCollection => !!item);
};

const saveIndex = async (items: MessageFavoriteCollection[]): Promise<void> => {
    await DB.saveAssetRaw(MESSAGE_FAVORITE_COLLECTIONS_INDEX_ASSET_ID, {
        version: MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION,
        items,
    } satisfies MessageFavoriteCollectionIndex);
};

const notifyChanged = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MESSAGE_FAVORITE_COLLECTIONS_CHANGED_EVENT));
};

/** A stable id makes pressing「收藏为一组」twice an upsert, not a duplicate. */
export const makeMessageFavoriteCollectionId = (
    source: TextFavoriteSource,
    charId: string,
    messageIds: number[],
): string => {
    const canonicalIds = [...new Set((messageIds || []).filter(id => Number.isSafeInteger(id) && id > 0))]
        .sort((a, b) => a - b);
    return `message_collection_${makeTextFavoriteId(source, `${charId}\u0000${canonicalIds.join(',')}`)}`;
};

export const messageFavoriteCollectionMediaAssetId = (
    collectionId: string,
    messageId: number,
    kind: Exclude<MessageFavoriteCollectionMessageKind, 'text'>,
): string => `${MESSAGE_FAVORITE_COLLECTION_MEDIA_PREFIX}${collectionId}_${kind}_${messageId}`;

export const isMessageFavoriteCollectionMediaAssetId = (value: unknown): value is string => (
    typeof value === 'string'
    && value.startsWith(MESSAGE_FAVORITE_COLLECTION_MEDIA_PREFIX)
    && value.length <= 300
);

export const normalizeMessageFavoriteCollectionMessages = (
    messages: MessageFavoriteCollectionMessageInput[],
): MessageFavoriteCollectionMessage[] => {
    const byMessageId = new Map<number, MessageFavoriteCollectionMessage>();
    for (const message of messages || []) {
        const messageId = normalizeMessageId(message?.messageId);
        if (messageId == null || !isRole(message?.role) || !isKind(message?.kind)) continue;
        const content = normalizeContent(message.content, message.kind);
        if (!content || byMessageId.has(messageId)) continue;
        const spokenText = message.kind === 'voice' && typeof message.spokenText === 'string'
            ? cleanTextForFavorite(message.spokenText) || undefined
            : undefined;
        const lang = message.kind === 'voice' && typeof message.lang === 'string'
            ? message.lang.trim() || undefined
            : undefined;
        byMessageId.set(messageId, {
            messageId,
            role: message.role,
            speakerName: typeof message.speakerName === 'string' && message.speakerName.trim()
                ? message.speakerName.trim()
                : message.role === 'user' ? '我' : '未知角色',
            timestamp: normalizeTimestamp(message.timestamp, Date.now()),
            kind: message.kind,
            content,
            media: normalizeMediaRef(message.media),
            spokenText,
            lang,
        });
    }
    return [...byMessageId.values()].sort((a, b) => a.messageId - b.messageId);
};

export const sortMessageFavoriteCollections = (items: MessageFavoriteCollection[]): MessageFavoriteCollection[] => (
    [...items].sort((a, b) => b.favoritedAt - a.favoritedAt || b.id.localeCompare(a.id))
);

export const listMessageFavoriteCollections = async (): Promise<MessageFavoriteCollection[]> => (
    sortMessageFavoriteCollections(await loadIndex())
);

export const getMessageFavoriteCollection = async (collectionId: string): Promise<MessageFavoriteCollection | null> => (
    (await loadIndex()).find(item => item.id === collectionId) || null
);

const mediaAssetKeysOf = (collection: MessageFavoriteCollection | null | undefined): string[] => (
    collection?.messages
        .map(message => message.media?.assetKey)
        .filter((key): key is string => isMessageFavoriteCollectionMediaAssetId(key)) || []
);

export const messageFavoriteCollectionMediaAssetKeys = mediaAssetKeysOf;

export const saveMessageFavoriteCollectionMedia = async (assetKey: string, blob: Blob): Promise<void> => {
    if (!isMessageFavoriteCollectionMediaAssetId(assetKey)) throw new Error('收藏媒体资产无效');
    if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('收藏媒体文件为空');
    await DB.saveAssetRaw(assetKey, {
        blob,
        mimeType: blob.type || 'application/octet-stream',
        savedAt: Date.now(),
    } satisfies MessageFavoriteCollectionMediaAsset);
};

export const getMessageFavoriteCollectionMediaBlob = async (assetKey: string): Promise<Blob | null> => {
    if (!isMessageFavoriteCollectionMediaAssetId(assetKey)) return null;
    const raw = await DB.getAssetRaw(assetKey).catch(() => null) as MessageFavoriteCollectionMediaAsset | Blob | null;
    if (typeof Blob !== 'undefined' && raw instanceof Blob) return raw;
    const asset = raw && typeof raw === 'object' && 'blob' in raw
        ? raw as MessageFavoriteCollectionMediaAsset
        : null;
    if (asset && typeof Blob !== 'undefined' && asset.blob instanceof Blob) return asset.blob;
    return null;
};

export const upsertMessageFavoriteCollection = async (
    input: UpsertMessageFavoriteCollectionInput,
): Promise<UpsertMessageFavoriteCollectionResult> => withWriteLock(async () => {
    if (!isSource(input.source)) throw new Error('不支持的收藏来源');
    if (typeof input.charId !== 'string' || !input.charId.trim()) throw new Error('收藏角色不存在');

    const messages = normalizeMessageFavoriteCollectionMessages(input.messages);
    if (!messages.length) throw new Error('没有可收藏的消息');
    if (messages.length > MAX_MESSAGE_FAVORITE_COLLECTION_MESSAGES) {
        throw new Error(`一次最多收藏 ${MAX_MESSAGE_FAVORITE_COLLECTION_MESSAGES} 条消息`);
    }
    const totalChars = messages.reduce((total, message) => total + message.content.length, 0);
    if (totalChars > MAX_MESSAGE_FAVORITE_COLLECTION_CHARS) {
        throw new Error('这组消息太长，请分成两组收藏');
    }

    const current = await loadIndex();
    const id = input.id?.trim() || makeMessageFavoriteCollectionId(
        input.source,
        input.charId.trim(),
        messages.map(message => message.messageId),
    );
    const existing = current.find(item => item.id === id);
    if (!existing && current.length >= MAX_MESSAGE_FAVORITE_COLLECTIONS) {
        throw new Error('消息收藏组已达到上限，请先删除旧收藏');
    }

    const collection: MessageFavoriteCollection = {
        schemaVersion: MESSAGE_FAVORITE_COLLECTION_SCHEMA_VERSION,
        id,
        source: input.source,
        charId: input.charId.trim(),
        charName: typeof input.charName === 'string' && input.charName.trim() ? input.charName.trim() : '未知角色',
        favoritedAt: existing?.favoritedAt || normalizeTimestamp(input.favoritedAt, Date.now()),
        messages,
    };
    await saveIndex([collection, ...current.filter(item => item.id !== id)]);

    // The index is authoritative. If a later upsert removed a media item,
    // clean the now-unreferenced asset after the index commit. An orphan is
    // safer than deleting an asset still referenced by the new snapshot.
    const nextKeys = new Set(mediaAssetKeysOf(collection));
    for (const oldKey of mediaAssetKeysOf(existing)) {
        if (!nextKeys.has(oldKey)) await DB.deleteAsset(oldKey).catch(() => undefined);
    }
    notifyChanged();
    return { collection, created: !existing };
});

export const removeMessageFavoriteCollection = async (collectionId: string): Promise<boolean> => withWriteLock(async () => {
    const current = await loadIndex();
    const existing = current.find(item => item.id === collectionId);
    if (!existing) return false;
    // Remove the index entry first. A failed cleanup may leave an orphan asset,
    // but it can never leave a visible collection pointing at a deleted asset.
    await saveIndex(current.filter(item => item.id !== collectionId));
    for (const assetKey of mediaAssetKeysOf(existing)) {
        await DB.deleteAsset(assetKey).catch(() => undefined);
    }
    notifyChanged();
    return true;
});
