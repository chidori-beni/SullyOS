import type { GalleryAlbum, GalleryImage } from '../types';

export const GALLERY_ALBUM_NAME_MAX_LENGTH = 40;
/** UI 筛选用的虚拟 id，不会写进 GalleryImage.albumId。 */
export const GALLERY_UNFILED_ID = '__gallery_unfiled__';

export function normalizeGalleryAlbumName(input: string): string {
    const name = input.normalize('NFKC').trim();
    if (!name) throw new Error('子相册名称不能为空');
    if (name.length > GALLERY_ALBUM_NAME_MAX_LENGTH) {
        throw new Error(`子相册名称不能超过 ${GALLERY_ALBUM_NAME_MAX_LENGTH} 个字符`);
    }
    return name;
}

export function galleryAlbumNameKey(input: string): string {
    return normalizeGalleryAlbumName(input).toLocaleLowerCase();
}

/** 从备份或旧版本数据中取出安全、可写入索引的相册元数据。 */
export function normalizeGalleryAlbumRecord(value: unknown): GalleryAlbum | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<GalleryAlbum>;
    if (typeof row.id !== 'string' || !row.id.trim()) return null;
    if (typeof row.charId !== 'string' || !row.charId.trim()) return null;
    if (typeof row.name !== 'string') return null;

    let name: string;
    try {
        name = normalizeGalleryAlbumName(row.name);
    } catch {
        return null;
    }

    const createdAt = typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
        ? row.createdAt
        : Date.now();
    const updatedAt = typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : createdAt;
    return {
        id: row.id.trim(),
        charId: row.charId.trim(),
        name,
        nameKey: galleryAlbumNameKey(name),
        createdAt,
        updatedAt,
    };
}

export function withoutGalleryImageAlbum(image: GalleryImage): GalleryImage {
    const next = { ...image };
    delete next.albumId;
    return next;
}
