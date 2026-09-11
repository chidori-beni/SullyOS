import { afterAll, describe, expect, it } from 'vitest';
import type { GalleryAlbum, GalleryImage } from '../types';
import {
    GALLERY_ALBUM_NAME_MAX_LENGTH,
    GALLERY_ALL_ID,
    GALLERY_UNFILED_ID,
    galleryAlbumNameKey,
    normalizeGalleryCategoryOrderRecord,
    normalizeGalleryAlbumName,
    normalizeGalleryAlbumRecord,
    reconcileGalleryCategoryOrder,
    withoutGalleryImageAlbum,
} from './galleryAlbums';
import { DB } from './db';

const CHAR_ID = '__gallery-album-test-char__';
const OTHER_CHAR_ID = '__gallery-album-test-other-char__';
const imageIds: string[] = [];
const albumIds: string[] = [];

afterAll(async () => {
    await DB.deleteGalleryCategoryOrder(CHAR_ID).catch(() => {});
    await DB.deleteGalleryCategoryOrder(OTHER_CHAR_ID).catch(() => {});
    for (const id of albumIds) await DB.deleteGalleryAlbum(id).catch(() => {});
    for (const id of imageIds) await DB.deleteGalleryImage(id).catch(() => {});
});

describe('角色相册子相册', () => {
    it('规范化名称、备份记录，并移除未分类照片的 albumId', () => {
        expect(normalizeGalleryAlbumName('  Ｃａｆｅ  ')).toBe('Cafe');
        expect(galleryAlbumNameKey('  Ｃａａｆｅ  ')).toBe('caafe');
        expect(() => normalizeGalleryAlbumName('   ')).toThrow('不能为空');
        expect(() => normalizeGalleryAlbumName('a'.repeat(GALLERY_ALBUM_NAME_MAX_LENGTH + 1))).toThrow('不能超过');

        expect(normalizeGalleryAlbumRecord({
            id: ' album-1 ',
            charId: ' char-1 ',
            name: '  日常  ',
            createdAt: 100,
            updatedAt: 200,
        })).toMatchObject({
            id: 'album-1',
            charId: 'char-1',
            name: '日常',
            nameKey: '日常',
            createdAt: 100,
            updatedAt: 200,
        });
        expect(normalizeGalleryAlbumRecord({ id: 'bad', charId: 'char-1', name: '' })).toBeNull();

        const image: GalleryImage = {
            id: 'image-helper-test',
            charId: CHAR_ID,
            url: 'data:image/png;base64,test',
            timestamp: 1,
            albumId: 'album-1',
        };
        const unfiled = { ...image };
        delete unfiled.albumId;
        expect(withoutGalleryImageAlbum(image)).toEqual(unfiled);
        expect(withoutGalleryImageAlbum(image)).not.toBe(image);

        const albums: GalleryAlbum[] = [
            { id: 'album-a', charId: CHAR_ID, name: 'A', nameKey: 'a', createdAt: 10, updatedAt: 10 },
            { id: 'album-b', charId: CHAR_ID, name: 'B', nameKey: 'b', createdAt: 20, updatedAt: 20 },
        ];
        expect(reconcileGalleryCategoryOrder(['album-b', 'missing', 'album-b', GALLERY_UNFILED_ID], albums)).toEqual([
            'album-b',
            GALLERY_UNFILED_ID,
            GALLERY_ALL_ID,
            'album-a',
        ]);
        expect(normalizeGalleryCategoryOrderRecord({ charId: ' char-1 ', categoryIds: [' album-a ', 1], updatedAt: 3 })).toEqual({
            charId: 'char-1',
            categoryIds: ['album-a'],
            updatedAt: 3,
        });
    });

    it('同一角色可自定义多个子相册，照片可移动且删除分类不删除照片', async () => {
        const travel = await DB.createGalleryAlbum(CHAR_ID, '旅行');
        const daily = await DB.createGalleryAlbum(CHAR_ID, '日常');
        const otherCharAlbum = await DB.createGalleryAlbum(OTHER_CHAR_ID, '旅行');
        albumIds.push(travel.id, daily.id, otherCharAlbum.id);

        expect((await DB.getGalleryAlbums(CHAR_ID)).map(album => album.name)).toEqual(expect.arrayContaining(['旅行', '日常']));
        await expect(DB.createGalleryAlbum(CHAR_ID, ' 旅行 ')).rejects.toMatchObject({ name: 'ConstraintError' });
        await expect(DB.renameGalleryAlbum(daily.id, '旅行')).rejects.toMatchObject({ name: 'ConstraintError' });
        expect((await DB.getGalleryAlbums(CHAR_ID)).find(album => album.id === daily.id)?.name).toBe('日常');

        const image: GalleryImage = {
            id: 'gallery-album-image-test',
            charId: CHAR_ID,
            url: 'data:image/png;base64,test',
            timestamp: 1,
        };
        imageIds.push(image.id);
        await DB.saveGalleryImage(image);
        await DB.updateGalleryImageAlbum(image.id, travel.id);
        expect((await DB.getGalleryImages(CHAR_ID)).find(item => item.id === image.id)?.albumId).toBe(travel.id);
        await DB.saveGalleryImage({ ...image, url: 'data:image/png;base64,updated-by-sync' });
        expect((await DB.getGalleryImages(CHAR_ID)).find(item => item.id === image.id)?.albumId).toBe(travel.id);

        await expect(DB.updateGalleryImageAlbum(image.id, otherCharAlbum.id)).rejects.toThrow('别的角色');
        expect((await DB.getGalleryImages(CHAR_ID)).find(item => item.id === image.id)?.albumId).toBe(travel.id);

        const reviewed = await DB.updateGalleryImageReview(image.id, '带着海风的照片');
        expect(reviewed).toMatchObject({ id: image.id, albumId: travel.id, review: '带着海风的照片' });

        await DB.deleteGalleryAlbum(travel.id);
        const restoredToUnfiled = (await DB.getGalleryImages(CHAR_ID)).find(item => item.id === image.id);
        expect(restoredToUnfiled).toBeDefined();
        expect(restoredToUnfiled?.albumId).toBeUndefined();
        expect(await DB.getGalleryAlbums(CHAR_ID)).not.toContainEqual(travel);

        const backup = await DB.exportFullData();
        expect(backup.galleryAlbums).toEqual(expect.arrayContaining([daily, otherCharAlbum]));
        expect(backup.galleryImages).toEqual(expect.arrayContaining([expect.objectContaining({ id: image.id })]));
    });

    it('批量移动照片使用单事务并保存包含全部/未分类的角色分类顺序', async () => {
        const batchAlbum = await DB.createGalleryAlbum(CHAR_ID, '批量归类');
        albumIds.push(batchAlbum.id);
        const first: GalleryImage = {
            id: 'gallery-batch-image-1',
            charId: CHAR_ID,
            url: 'data:image/png;base64,batch-1',
            timestamp: 3,
            review: '保留原有点评',
        };
        const second: GalleryImage = {
            id: 'gallery-batch-image-2',
            charId: CHAR_ID,
            url: 'data:image/png;base64,batch-2',
            timestamp: 4,
        };
        const otherCharImage: GalleryImage = {
            id: 'gallery-batch-other-char-image',
            charId: OTHER_CHAR_ID,
            url: 'data:image/png;base64,batch-other',
            timestamp: 5,
        };
        imageIds.push(first.id, second.id, otherCharImage.id);
        await Promise.all([DB.saveGalleryImage(first), DB.saveGalleryImage(second), DB.saveGalleryImage(otherCharImage)]);

        await expect(DB.updateGalleryImagesAlbum(CHAR_ID, [first.id, second.id, first.id], batchAlbum.id)).resolves.toBe(2);
        expect((await DB.getGalleryImages(CHAR_ID)).filter(image => image.id === first.id || image.id === second.id)).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: first.id, albumId: batchAlbum.id, review: first.review }),
            expect.objectContaining({ id: second.id, albumId: batchAlbum.id }),
        ]));

        await DB.updateGalleryImagesAlbum(CHAR_ID, [first.id, second.id], GALLERY_UNFILED_ID);
        expect((await DB.getGalleryImages(CHAR_ID)).filter(image => image.id === first.id || image.id === second.id).every(image => !image.albumId)).toBe(true);

        await expect(DB.updateGalleryImagesAlbum(CHAR_ID, [first.id, 'missing-image'], batchAlbum.id)).rejects.toThrow('照片不存在');
        expect((await DB.getGalleryImages(CHAR_ID)).find(image => image.id === first.id)?.albumId).toBeUndefined();
        await expect(DB.updateGalleryImagesAlbum(CHAR_ID, [first.id, otherCharImage.id], batchAlbum.id)).rejects.toThrow('当前角色');
        expect((await DB.getGalleryImages(CHAR_ID)).find(image => image.id === first.id)?.albumId).toBeUndefined();

        await DB.saveGalleryCategoryOrder(CHAR_ID, [batchAlbum.id, GALLERY_ALL_ID, GALLERY_UNFILED_ID]);
        const savedOrder = await DB.getGalleryCategoryOrder(CHAR_ID);
        expect(savedOrder?.categoryIds.slice(0, 3)).toEqual([batchAlbum.id, GALLERY_ALL_ID, GALLERY_UNFILED_ID]);
        expect(normalizeGalleryCategoryOrderRecord(savedOrder)).toEqual(savedOrder);
        const backup = await DB.exportFullData();
        expect(backup.galleryCategoryOrders).toEqual(expect.arrayContaining([expect.objectContaining({ charId: CHAR_ID, categoryIds: savedOrder?.categoryIds })]));

        await DB.deleteGalleryAlbum(batchAlbum.id);
        expect((await DB.getGalleryCategoryOrder(CHAR_ID))?.categoryIds).not.toContain(batchAlbum.id);
    });

    it('完整备份 round-trip 会恢复子相册定义和照片归属', async () => {
        const album = await DB.createGalleryAlbum(CHAR_ID, '备份分类');
        albumIds.push(album.id);
        const image: GalleryImage = {
            id: 'gallery-album-roundtrip-image-test',
            charId: CHAR_ID,
            url: 'data:image/png;base64,roundtrip',
            timestamp: 2,
        };
        imageIds.push(image.id);
        await DB.saveGalleryImage(image);
        await DB.updateGalleryImageAlbum(image.id, album.id);
        await DB.saveGalleryCategoryOrder(CHAR_ID, [album.id, GALLERY_ALL_ID, GALLERY_UNFILED_ID]);

        const backup = JSON.parse(JSON.stringify(await DB.exportFullData()));
        await DB.deleteGalleryAlbum(album.id);
        await DB.deleteGalleryImage(image.id);
        await DB.deleteGalleryCategoryOrder(CHAR_ID);
        await DB.importFullData(backup as any);

        expect(await DB.getGalleryAlbums(CHAR_ID)).toContainEqual(album);
        expect((await DB.getGalleryImages(CHAR_ID)).find(item => item.id === image.id)?.albumId).toBe(album.id);
        expect((await DB.getGalleryCategoryOrder(CHAR_ID))?.categoryIds[0]).toBe(album.id);
    });
});
