import { afterAll, describe, expect, it } from 'vitest';
import type { GalleryImage } from '../types';
import {
    GALLERY_ALBUM_NAME_MAX_LENGTH,
    galleryAlbumNameKey,
    normalizeGalleryAlbumName,
    normalizeGalleryAlbumRecord,
    withoutGalleryImageAlbum,
} from './galleryAlbums';
import { DB } from './db';

const CHAR_ID = '__gallery-album-test-char__';
const OTHER_CHAR_ID = '__gallery-album-test-other-char__';
const imageIds: string[] = [];
const albumIds: string[] = [];

afterAll(async () => {
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

        const backup = JSON.parse(JSON.stringify(await DB.exportFullData()));
        await DB.deleteGalleryAlbum(album.id);
        await DB.deleteGalleryImage(image.id);
        await DB.importFullData(backup as any);

        expect(await DB.getGalleryAlbums(CHAR_ID)).toContainEqual(album);
        expect((await DB.getGalleryImages(CHAR_ID)).find(item => item.id === image.id)?.albumId).toBe(album.id);
    });
});
