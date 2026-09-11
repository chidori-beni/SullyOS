import type { GalleryAlbum, GalleryCategoryOrder, GalleryImage } from '../types';

export const GALLERY_ALBUM_NAME_MAX_LENGTH = 40;
/** UI 筛选用的虚拟 id；不会写进 GalleryImage.albumId。 */
export const GALLERY_ALL_ID = '__gallery_all__';
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

/** 从备份或旧版本数据中取出安全的角色相册分类顺序记录。 */
export function normalizeGalleryCategoryOrderRecord(value: unknown): GalleryCategoryOrder | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<GalleryCategoryOrder>;
    if (typeof row.charId !== 'string' || !row.charId.trim()) return null;
    if (!Array.isArray(row.categoryIds)) return null;
    const categoryIds = row.categoryIds
        .filter((id): id is string => typeof id === 'string' && !!id.trim())
        .map(id => id.trim());
    const updatedAt = typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : Date.now();
    return { charId: row.charId.trim(), categoryIds, updatedAt };
}

/**
 * 对角色相册顺序做一次幂等 reconciliation：保留有效的已存顺序，
 * 自动补齐两个虚拟分类和新增的实体相册，并丢弃失效/重复 id。
 */
export function reconcileGalleryCategoryOrder(
    savedIds: readonly string[] | null | undefined,
    albums: readonly GalleryAlbum[],
): string[] {
    const validAlbumIds = new Set(albums.map(album => album.id));
    const orderedAlbums = [...albums].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const result: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
        if (seen.has(id)) return;
        if (id !== GALLERY_ALL_ID && id !== GALLERY_UNFILED_ID && !validAlbumIds.has(id)) return;
        seen.add(id);
        result.push(id);
    };

    for (const id of savedIds || []) {
        if (typeof id === 'string') add(id.trim());
    }
    add(GALLERY_ALL_ID);
    add(GALLERY_UNFILED_ID);
    for (const album of orderedAlbums) add(album.id);
    return result;
}

export function galleryCategoryIdToActiveAlbumId(categoryId: string): string | null {
    return categoryId === GALLERY_ALL_ID ? null : categoryId;
}

export function withoutGalleryImageAlbum(image: GalleryImage): GalleryImage {
    const next = { ...image };
    delete next.albumId;
    return next;
}
