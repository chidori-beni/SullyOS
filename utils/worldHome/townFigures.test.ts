import { describe, it, expect } from 'vitest';
import {
    pixelCharAssetKey,
    mapBgAssetKey,
    DEFAULT_FIGURE_STYLE,
    figureStyleOf,
    pickFigureSource,
    resolveMapBg,
    mapBgDimOf,
    DEFAULT_MAP_BG_DIM,
    looksLikeImageUrl,
    MAP_BG_MAX_W,
} from './townFigures';

describe('小镇地图 · 小人形象', () => {
    describe('开关', () => {
        it('⭐ 缺省像素 —— 用户原话「像素角色用到的地方太少了」', () => {
            expect(DEFAULT_FIGURE_STYLE).toBe('pixel');
            expect(figureStyleOf({})).toBe('pixel');
            expect(figureStyleOf({ figureStyle: undefined })).toBe('pixel');
        });

        it('能切回 chibi —— 仍然是开关，不是写死', () => {
            expect(figureStyleOf({ figureStyle: 'chibi' })).toBe('chibi');
        });

        it('⛔ 存档里的坏值退回缺省', () => {
            expect(figureStyleOf({ figureStyle: 'q版' as unknown as 'pixel' })).toBe('pixel');
        });
    });

    describe('挑图', () => {
        const PX = 'data:image/png;base64,PIXEL';
        const CH = { img: 'data:image/png;base64,CHIBI', flip: true };

        it('选像素、也捏过像素 → 用像素', () => {
            expect(pickFigureSource('pixel', PX, CH)).toEqual({ img: PX, kind: 'pixel' });
        });

        it('选 chibi → 用 chibi，并带上左右翻转', () => {
            expect(pickFigureSource('chibi', PX, CH)).toEqual({ img: CH.img, kind: 'chibi', flip: true });
        });

        it('⭐⛔ 选了像素但没捏过 → 退回 chibi，**不能让这个人从地图上消失**', () => {
            expect(pickFigureSource('pixel', undefined, CH)).toEqual({ img: CH.img, kind: 'chibi', flip: true });
        });

        it('⭐⛔ 反过来也兜底：选了 chibi 但连头像都没有 → 用像素', () => {
            expect(pickFigureSource('chibi', PX, null)).toEqual({ img: PX, kind: 'pixel' });
            expect(pickFigureSource('chibi', PX, { img: '' })).toEqual({ img: PX, kind: 'pixel' });
        });

        it('两档都没有 → null（渲染层画首字圆片）', () => {
            expect(pickFigureSource('pixel', undefined, null)).toBeNull();
            expect(pickFigureSource('chibi', undefined, undefined)).toBeNull();
        });

        it('像素小人没有左右翻转这个概念', () => {
            expect(pickFigureSource('pixel', PX, CH)?.flip).toBeUndefined();
        });
    });

    describe('存哪儿', () => {
        it('⛔ 像素小人的 key 必须和像素家园写入时用的一致，否则读不到', () => {
            expect(pixelCharAssetKey('c_abc')).toBe('pixel_char_c_abc');
        });

        it('底图按世界分开存', () => {
            expect(mapBgAssetKey('w1')).toBe('world_map_bg_w1');
            expect(mapBgAssetKey('w2')).not.toBe(mapBgAssetKey('w1'));
        });
    });
});

describe('小镇地图 · 自定义底图', () => {
    describe('取地址', () => {
        it('贴的图床链接原样用', () => {
            expect(resolveMapBg({ kind: 'url', url: 'https://img.example/x' }, null)).toBe('https://img.example/x');
        });

        it('本地上传的用资产库里那份', () => {
            expect(resolveMapBg({ kind: 'asset' }, 'data:image/jpeg;base64,AAA')).toBe('data:image/jpeg;base64,AAA');
        });

        it('⛔ 取不到就返回 null —— 宁可没底图，也别显示破图', () => {
            expect(resolveMapBg({ kind: 'asset' }, null)).toBeNull();
            expect(resolveMapBg({ kind: 'url', url: '   ' }, null)).toBeNull();
            expect(resolveMapBg({ kind: 'url' }, 'data:image/png;base64,X')).toBeNull();
            expect(resolveMapBg(undefined, 'data:image/png;base64,X')).toBeNull();
        });

        it('⭐ url 档不会误用资产库那份 —— 两档互不串味', () => {
            expect(resolveMapBg({ kind: 'url', url: 'https://a/b' }, 'data:image/png;base64,OTHER')).toBe('https://a/b');
        });
    });

    describe('遮罩', () => {
        it('不设就是缺省', () => {
            expect(mapBgDimOf(undefined)).toBe(DEFAULT_MAP_BG_DIM);
            expect(mapBgDimOf({ kind: 'asset' })).toBe(DEFAULT_MAP_BG_DIM);
        });

        it('⛔⭐ 不允许 0 —— 花哨的底图会让地名和人名彻底看不清，而那是这张图唯一的功能性内容', () => {
            expect(mapBgDimOf({ kind: 'asset', dim: 0 })).toBe(0.1);
            expect(mapBgDimOf({ kind: 'asset', dim: -5 })).toBe(0.1);
        });

        it('上限 0.8 —— 再高就等于没贴图', () => {
            expect(mapBgDimOf({ kind: 'asset', dim: 1 })).toBe(0.8);
        });

        it('范围内原样用', () => {
            expect(mapBgDimOf({ kind: 'asset', dim: 0.5 })).toBe(0.5);
        });

        it('坏值退回缺省', () => {
            expect(mapBgDimOf({ kind: 'asset', dim: NaN })).toBe(DEFAULT_MAP_BG_DIM);
            expect(mapBgDimOf({ kind: 'asset', dim: '0.5' as unknown as number })).toBe(DEFAULT_MAP_BG_DIM);
        });
    });

    describe('链接长得像不像图', () => {
        it('http(s) 和 data: 都认', () => {
            expect(looksLikeImageUrl('https://img.example/abc123')).toBe(true);
            expect(looksLikeImageUrl('http://a.b/c.png')).toBe(true);
            expect(looksLikeImageUrl('data:image/png;base64,AAA')).toBe(true);
        });

        it('⭐ 刻意宽松：图床链接常常没有扩展名，不能因为「不像图」就拦', () => {
            expect(looksLikeImageUrl('https://sm.ms/2026/09/17/xYz')).toBe(true);
            expect(looksLikeImageUrl('https://i.imgur.com/aBcDeF')).toBe(true);
        });

        it('只拦明显不是链接的', () => {
            expect(looksLikeImageUrl('我想要一张海边的图')).toBe(false);
            expect(looksLikeImageUrl('')).toBe(false);
            expect(looksLikeImageUrl('   ')).toBe(false);
            expect(looksLikeImageUrl('ftp://a/b')).toBe(false);
        });
    });

    it('⛔ 本地图必须压 —— 一张手机直出的 4MB 图会让每次存世界都拖着它写', () => {
        expect(MAP_BG_MAX_W).toBeLessThanOrEqual(1600);
        expect(MAP_BG_MAX_W).toBeGreaterThanOrEqual(800);
    });
});
