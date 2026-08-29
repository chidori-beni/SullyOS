import { DB } from './db';
import { stripFishCuesForDisplay } from './fishAudioTts';
import { stripMessageReactionTags } from './messageReactions';
import { cleanVoiceMarkupForDisplay } from './minimaxTts';
import { stripFaceToFacePhoneSourceTags } from './sanitize';

export const TEXT_FAVORITES_INDEX_ASSET_ID = 'text_favorites_index_v1';
export const TEXT_FAVORITES_CHANGED_EVENT = 'sully:text-favorites-changed';

export type TextFavoriteSource = 'chat';
export type TextFavoriteRole = 'user' | 'assistant';

export interface TextFavorite {
    id: string;
    source: TextFavoriteSource;
    /** Stable identity inside the source app (currently a chat character + message id). */
    sourceKey: string;
    messageId: number;
    charId: string;
    charName: string;
    role: TextFavoriteRole;
    sourceTimestamp: number;
    favoritedAt: number;
    /** Readable snapshot of the message at the time it was favorited. */
    content: string;
}

export interface SaveTextFavoriteInput extends Omit<TextFavorite, 'id' | 'favoritedAt'> {
    favoritedAt?: number;
}

interface TextFavoriteIndex {
    version: 1;
    items: TextFavorite[];
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

const sanitizeFavorite = (value: unknown): TextFavorite | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<TextFavorite>;
    if (typeof item.id !== 'string' || !item.id) return null;
    if (!isSource(item.source)) return null;
    if (typeof item.sourceKey !== 'string' || !item.sourceKey) return null;
    if (typeof item.messageId !== 'number' || !Number.isFinite(item.messageId) || item.messageId <= 0) return null;
    if (typeof item.charId !== 'string' || !item.charId) return null;
    if (typeof item.charName !== 'string') return null;
    if (!isRole(item.role)) return null;
    if (typeof item.content !== 'string' || !item.content.trim()) return null;
    const now = Date.now();
    return {
        id: item.id,
        source: item.source,
        sourceKey: item.sourceKey,
        messageId: item.messageId,
        charId: item.charId,
        charName: item.charName || '未知角色',
        role: item.role,
        sourceTimestamp: normalizeTimestamp(item.sourceTimestamp, now),
        favoritedAt: normalizeTimestamp(item.favoritedAt, now),
        content: item.content.trim(),
    };
};

const loadIndex = async (): Promise<TextFavorite[]> => {
    const raw = await DB.getAssetRaw(TEXT_FAVORITES_INDEX_ASSET_ID).catch(() => null) as Partial<TextFavoriteIndex> | TextFavorite[] | null;
    const items = Array.isArray(raw) ? raw : raw?.items;
    if (!Array.isArray(items)) return [];
    return items.map(sanitizeFavorite).filter((item): item is TextFavorite => !!item);
};

const saveIndex = async (items: TextFavorite[]): Promise<void> => {
    await DB.saveAssetRaw(TEXT_FAVORITES_INDEX_ASSET_ID, { version: 1, items } satisfies TextFavoriteIndex);
};

const notifyChanged = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TEXT_FAVORITES_CHANGED_EVENT));
};

/** A compact deterministic id avoids putting message text or character names in the asset key. */
export const makeTextFavoriteId = (source: TextFavoriteSource, sourceKey: string): string => {
    const input = `${source}\u0000${sourceKey}`;
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x85ebca6b);
    }
    return `text_${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
};

export const makeTextFavoriteSourceKey = (charId: string, messageId: number): string => `${charId}:${messageId}`;

export const sortTextFavorites = (items: TextFavorite[]): TextFavorite[] => (
    [...items].sort((a, b) => b.sourceTimestamp - a.sourceTimestamp || b.favoritedAt - a.favoritedAt || b.id.localeCompare(a.id))
);

/**
 * The chat bubble hides transport markup before rendering. Keep the archive equally
 * readable when a user favorites a message that contains voice / translation / reaction
 * markers. This intentionally only removes known protocol markers; ordinary brackets and
 * parentheses remain valid user text.
 */
export const cleanTextForFavorite = (raw: string): string => {
    const cleaned = (raw || '')
        .replace(/%%TRANS%%[\s\S]*$/gi, '')
        .replace(/%%BILINGUAL%%/gi, '\n')
        .replace(/<字幕>([\s\S]*?)<\/字幕>/gi, '$1')
        .replace(/<\/?字幕>/gi, '')
        .replace(/<[语語]音[^>]*>[\s\S]*?<\/\s*[语語]音\s*>/giu, ' ')
        .replace(/<[语語]音[^>]*>[\s\S]*$/giu, ' ')
        .replace(/<\/\s*[语語]音\s*>/giu, ' ')
        .replace(/\[\[(?:ACTION|RECALL|SEARCH|DIARY|READ_DIARY|FS_DIARY|FS_READ_DIARY|SEND_EMOJI|SEND_IMAGE|SEND_SELFIE|DIARY_START|DIARY_END|FS_DIARY_START|FS_DIARY_END)(?::|\s)[\s\S]*?\]\]/gi, '')
        .replace(/\[schedule_message[^\]]*\]/gi, '');

    return stripFaceToFacePhoneSourceTags(
        stripMessageReactionTags(
            stripFishCuesForDisplay(
                cleanVoiceMarkupForDisplay(cleaned),
            ),
        ),
    )
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

/** Reads metadata only; the text snapshot already lives in the small index asset. */
export const listTextFavorites = async (): Promise<TextFavorite[]> => sortTextFavorites(await loadIndex());

export const getTextFavorite = async (source: TextFavoriteSource, sourceKey: string): Promise<TextFavorite | null> => {
    const id = makeTextFavoriteId(source, sourceKey);
    return (await loadIndex()).find(item => item.id === id) || null;
};

export const saveTextFavorite = async (input: SaveTextFavoriteInput): Promise<TextFavorite> => withWriteLock(async () => {
    if (!isSource(input.source)) throw new Error('不支持的收藏来源');
    if (!isRole(input.role)) throw new Error('不支持的消息角色');
    const content = cleanTextForFavorite(input.content);
    if (!content) throw new Error('文字内容为空');

    const id = makeTextFavoriteId(input.source, input.sourceKey);
    const now = Date.now();
    const current = await loadIndex();
    const existing = current.find(item => item.id === id);
    const favorite: TextFavorite = {
        id,
        source: input.source,
        sourceKey: input.sourceKey,
        messageId: input.messageId,
        charId: input.charId,
        charName: input.charName || '未知角色',
        role: input.role,
        sourceTimestamp: normalizeTimestamp(input.sourceTimestamp, now),
        favoritedAt: normalizeTimestamp(input.favoritedAt, existing?.favoritedAt || now),
        content,
    };

    await saveIndex([favorite, ...current.filter(item => item.id !== id)]);
    notifyChanged();
    return favorite;
});

export const removeTextFavorite = async (source: TextFavoriteSource, sourceKey: string): Promise<boolean> => (
    removeTextFavoriteById(makeTextFavoriteId(source, sourceKey))
);

export const removeTextFavoriteById = async (favoriteId: string): Promise<boolean> => withWriteLock(async () => {
    const current = await loadIndex();
    if (!current.some(item => item.id === favoriteId)) return false;
    await saveIndex(current.filter(item => item.id !== favoriteId));
    notifyChanged();
    return true;
});

export const textFavoriteSourceLabel = (source: TextFavoriteSource): string => ({
    chat: '聊天',
}[source]);
