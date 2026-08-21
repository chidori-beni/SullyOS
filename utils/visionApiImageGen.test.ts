/**
 * 钉住一条规矩：**角色自己画的图，永远不送识图 API。**
 *
 * 现实里踩过的坑：生成图是原尺寸大图，识图模型可能直接拒掉，而那会让整轮回复挂掉
 * （「回复处理失败: 识图 API 没有返回图片描述」）。而我们手上本来就有当初那句提示词。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { materializeVisionDescriptions, VISION_DESCRIPTION_METADATA_KEY } from './visionApi';
import type { Message } from '../types';
import { DB } from './db';

const cfg = { enabled: true, baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' } as any;

const imageMsg = (over: Partial<Message> = {}): Message => ({
    id: 1, charId: 'c1', role: 'assistant', type: 'image',
    content: 'data:image/jpeg;base64,AAAA', timestamp: 1, ...over,
} as Message);

beforeEach(() => {
    vi.restoreAllMocks();
    // 任何真的发出去的网络请求都算失败——这些用例里就不该有网络。
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('不该调识图 API'))));
});

describe('生成图不走识图 API', () => {
    it('带 imageGen.prompt 的图 → 直接用提示词当描述，一次网络都不发', async () => {
        const out = await materializeVisionDescriptions(
            [imageMsg({ metadata: { imageGen: { status: 'generated', prompt: '1boy, silver hair' } } })],
            cfg,
        );
        expect(out[0].metadata[VISION_DESCRIPTION_METADATA_KEY]).toContain('1boy, silver hair');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('装新版之前生成的老图（没写过描述）也能就地自愈', async () => {
        const out = await materializeVisionDescriptions(
            [imageMsg({ id: 7, metadata: { imageGen: { status: 'generated', prompt: 'ramen, no humans' } } })],
            cfg,
        );
        expect(out[0].metadata[VISION_DESCRIPTION_METADATA_KEY]).toContain('ramen');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('已经有描述的照旧走缓存，不被新逻辑影响', async () => {
        const out = await materializeVisionDescriptions(
            [imageMsg({ metadata: { [VISION_DESCRIPTION_METADATA_KEY]: '一只猫' } })],
            cfg,
        );
        expect(out[0].metadata[VISION_DESCRIPTION_METADATA_KEY]).toBe('一只猫');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('识图总开关关着时整个函数原样返回（这条本来就成立，一并钉住）', async () => {
        const msgs = [imageMsg()];
        expect(await materializeVisionDescriptions(msgs, { ...cfg, enabled: false })).toBe(msgs);
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('一张图认不出来，不能把整轮回复带走', () => {
    it('识图报错 → 用占位描述顶上，函数正常返回而不是抛出', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('payload too large'))));
        const out = await materializeVisionDescriptions([imageMsg({ id: 11 })], cfg);
        expect(out).toHaveLength(1);
        expect(out[0].metadata[VISION_DESCRIPTION_METADATA_KEY]).toContain('没能识别');
    });

    it('识别失败的结果不写回数据库 —— 否则换个模型也永远没机会重试', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
        const spy = vi.spyOn(DB, 'updateMessageMetadata');
        await materializeVisionDescriptions([imageMsg({ id: 12 })], cfg);
        expect(spy).not.toHaveBeenCalled();
    });

    it('一张坏图不影响同一批里的其它消息', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
        const out = await materializeVisionDescriptions([
            { id: 20, charId: 'c1', role: 'user', type: 'text', content: '在吗', timestamp: 1 } as any,
            imageMsg({ id: 21 }),
            { id: 22, charId: 'c1', role: 'assistant', type: 'text', content: '在', timestamp: 2 } as any,
        ], cfg);
        expect(out.map(m => m.id)).toEqual([20, 21, 22]);
        expect(out[2].content).toBe('在');
    });
});
