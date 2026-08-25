/**
 * imageReroll.test.ts —— 生图重画 + 存图的纯函数测试
 *
 * 单开一个文件而不是往 `novelaiImage.test.ts` 里塞：那个文件是上游热点周边，
 * 合并上游时冲突概率高，新增的东西放旁边省事。
 */

import { describe, it, expect } from 'vitest';
import {
    buildNovelAiBody,
    readImageGenMeta,
    DEFAULT_IMAGE_GEN_CONFIG,
    type ImageGenConfig,
} from './novelaiImage';
import { dataUrlMime, dataUrlToBlobSync, extensionForMime } from './imageSave';

const cfg = (over: Partial<ImageGenConfig> = {}): ImageGenConfig => ({
    ...DEFAULT_IMAGE_GEN_CONFIG,
    enabled: true,
    relayUrl: 'https://relay.example.workers.dev',
    token: 'pst-xxx',
    ...over,
});

describe('重画时的种子', () => {
    it('锁了种子的情况下，不加 forceReseed 每次都是同一个数', () => {
        const a = buildNovelAiBody('1girl', cfg({ seed: 12345 }));
        const b = buildNovelAiBody('1girl', cfg({ seed: 12345 }));
        expect(a.parameters.seed).toBe(12345);
        expect(b.parameters.seed).toBe(12345);
    });

    it('forceReseed 会绕开锁定的种子——否则「重画」画出来是同一张', () => {
        const seeds = new Set<number>();
        for (let i = 0; i < 12; i++) {
            seeds.add(buildNovelAiBody('1girl', cfg({ seed: 12345 }), { forceReseed: true }).parameters.seed);
        }
        expect(seeds.has(12345)).toBe(false);
        // 12 次全撞成同一个随机数的概率可以忽略；只要不是恒定值就说明真的换了
        expect(seeds.size).toBeGreaterThan(1);
    });

    it('本来就没锁种子时，forceReseed 不改变行为（照旧随机）', () => {
        const body = buildNovelAiBody('1girl', cfg({ seed: 0 }), { forceReseed: true });
        expect(typeof body.parameters.seed).toBe('number');
        expect(body.parameters.seed).toBeGreaterThanOrEqual(0);
    });

    it('重画只换种子，画质词 / 负面词 / 尺寸这些一个都不动', () => {
        const base = cfg({ seed: 777, qualityTags: 'best quality', size: '1024x1536' });
        const normal = buildNovelAiBody('1girl', base);
        const reroll = buildNovelAiBody('1girl', base, { forceReseed: true });
        expect(reroll.input).toBe(normal.input);
        expect(reroll.parameters.width).toBe(normal.parameters.width);
        expect(reroll.parameters.height).toBe(normal.parameters.height);
        expect(reroll.parameters.negative_prompt).toBe(normal.parameters.negative_prompt);
        expect(reroll.parameters.steps).toBe(normal.parameters.steps);
    });
});

describe('相册去重标记', () => {
    it('生图 metadata 能带上相册记录 id，界面据此把「存到相册」变灰', () => {
        const meta = readImageGenMeta({ imageGen: { status: 'generated', prompt: '1girl', galleryImageId: 'img-gen-1' } });
        expect(meta?.galleryImageId).toBe('img-gen-1');
    });

    it('老消息没有这个字段也读得出来，不会当成坏数据', () => {
        const meta = readImageGenMeta({ imageGen: { status: 'generated', prompt: '1girl' } });
        expect(meta?.status).toBe('generated');
        expect(meta?.galleryImageId).toBeUndefined();
    });
});

describe('存到手机 · data URL 解析', () => {
    it('认得出 MIME，认不出就按 png 算', () => {
        expect(dataUrlMime('data:image/jpeg;base64,AAAA')).toBe('image/jpeg');
        expect(dataUrlMime('data:image/png;base64,AAAA')).toBe('image/png');
        expect(dataUrlMime('说好的 data URL 呢')).toBe('image/png');
    });

    it('扩展名跟着 MIME 走', () => {
        expect(extensionForMime('image/jpeg')).toBe('jpg');
        expect(extensionForMime('image/webp')).toBe('webp');
        expect(extensionForMime('image/gif')).toBe('gif');
        expect(extensionForMime('image/png')).toBe('png');
        expect(extensionForMime('什么都不是')).toBe('png');
    });

    it('base64 → Blob 是同步的（iOS 的分享手势等不了一个 await）', () => {
        // "hi" 的 base64 是 aGk=
        const blob = dataUrlToBlobSync('data:image/png;base64,aGk=');
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('image/png');
        expect(blob.size).toBe(2);
    });

    it('非 base64 的 data URL 也能解', () => {
        const blob = dataUrlToBlobSync('data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E');
        expect(blob.type).toBe('image/svg+xml');
        expect(blob.size).toBeGreaterThan(0);
    });

    it('压根不是 data URL 就直接抛，让调用方退到「新标签页打开」那条兜底路', () => {
        expect(() => dataUrlToBlobSync('https://example.com/a.png')).toThrow();
    });
});
