import { describe, it, expect } from 'vitest';
import { ChatParser } from './chatParser';
import {
    buildNovelAiBody,
    isImageGenReady,
    readImageGenMeta,
    buildSelfiePrompt,
    DEFAULT_IMAGE_GEN_CONFIG,
    type ImageGenConfig,
} from './novelaiImage';

const cfg = (over: Partial<ImageGenConfig> = {}): ImageGenConfig => ({
    ...DEFAULT_IMAGE_GEN_CONFIG,
    enabled: true,
    relayUrl: 'https://relay.example.workers.dev',
    token: 'pst-xxx',
    ...over,
});

describe('isImageGenReady', () => {
    it('开关关着 / 三件套缺一 → 都不算就绪', () => {
        expect(isImageGenReady(cfg({ enabled: false }))).toBe(false);
        expect(isImageGenReady(cfg({ relayUrl: '' }))).toBe(false);
        expect(isImageGenReady(cfg({ token: '' }))).toBe(false);
        expect(isImageGenReady(cfg({ model: '  ' }))).toBe(false);
        expect(isImageGenReady(undefined)).toBe(false);
    });
    it('齐了才就绪', () => {
        expect(isImageGenReady(cfg())).toBe(true);
    });
});

describe('buildNovelAiBody', () => {
    it('画质词自动追加，正负提示词同步进 v4_prompt', () => {
        const body = buildNovelAiBody('1girl, silver hair', cfg({ qualityTags: 'best quality' }));
        expect(body.input).toBe('1girl, silver hair, best quality');
        expect(body.action).toBe('generate');
        expect(body.model).toBe('nai-diffusion-4-5-full');
        expect(body.parameters.v4_prompt.caption.base_caption).toBe('1girl, silver hair, best quality');
        expect(body.parameters.v4_negative_prompt.caption.base_caption)
            .toBe(body.parameters.negative_prompt);
    });

    it('尺寸 / 步数 / scale / 采样器跟着配置走', () => {
        const body = buildNovelAiBody('x', cfg({ size: '512x768', steps: 20, scale: 6, sampler: 'k_dpmpp_2m' }));
        expect(body.parameters.width).toBe(512);
        expect(body.parameters.height).toBe(768);
        expect(body.parameters.steps).toBe(20);
        expect(body.parameters.scale).toBe(6);
        expect(body.parameters.sampler).toBe('k_dpmpp_2m');
    });

    it('尺寸填坏了退回默认档，不至于把请求发成 NaN', () => {
        const body = buildNovelAiBody('x', cfg({ size: '乱写的' }));
        expect(body.parameters.width).toBe(832);
        expect(body.parameters.height).toBe(1216);
    });

    it('Variety+ 关着是 null，开着是按尺寸算的数（V4.5 魔数 58）', () => {
        expect(buildNovelAiBody('x', cfg({ varietyPlus: false })).parameters.skip_cfg_above_sigma).toBeNull();
        // 832x1216 正好是参考尺寸 → 比值 1 → 直接等于魔数
        const on = buildNovelAiBody('x', cfg({ varietyPlus: true, size: '832x1216' }));
        expect(on.parameters.skip_cfg_above_sigma).toBeCloseTo(58, 5);
        // 尺寸小一半 → 开方后变小
        const small = buildNovelAiBody('x', cfg({ varietyPlus: true, size: '512x512' }));
        expect(small.parameters.skip_cfg_above_sigma).toBeLessThan(58);
    });

    it('V3 用魔数 19', () => {
        const b = buildNovelAiBody('x', cfg({ varietyPlus: true, size: '832x1216', model: 'nai-diffusion-3' }));
        expect(b.parameters.skip_cfg_above_sigma).toBeCloseTo(19, 5);
    });

    it('官方画质词开关直通 qualityToggle', () => {
        expect(buildNovelAiBody('x', cfg({ officialQualityTags: false })).parameters.qualityToggle).toBe(false);
        expect(buildNovelAiBody('x', cfg({ officialQualityTags: true })).parameters.qualityToggle).toBe(true);
    });

    it('种子填了就固定，填 0 才随机', () => {
        expect(buildNovelAiBody('x', cfg({ seed: 12345 })).parameters.seed).toBe(12345);
        expect(buildNovelAiBody('x', cfg({ seed: 12345 })).parameters.seed).toBe(12345);
    });

    it('每次种子都随机（不然同一句提示词永远出同一张图）', () => {
        const a = buildNovelAiBody('x', cfg()).parameters.seed;
        const b = buildNovelAiBody('x', cfg()).parameters.seed;
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a === b).toBe(false);
    });

    it('高级参数能覆盖默认值', () => {
        const body = buildNovelAiBody('x', cfg({ extraParams: '{"sampler":"k_dpmpp_2m","steps":35}' }));
        expect(body.parameters.sampler).toBe('k_dpmpp_2m');
        expect(body.parameters.steps).toBe(35);
    });

    it('高级参数是坏 JSON 时忽略，不能让整次生图崩掉', () => {
        const body = buildNovelAiBody('x', cfg({ extraParams: '{这不是JSON' }));
        expect(body.parameters.sampler).toBe('k_euler_ancestral');
    });
});

describe('splitResponse 认得 [[SEND_IMAGE:]]', () => {
    it('图片按写的位置插在两句话中间，顺序不能被打乱', () => {
        const parts = ChatParser.splitResponse('你看\n[[SEND_IMAGE: 1girl, smiling]]\n好看吧？');
        expect(parts.map(p => p.type)).toEqual(['text', 'image', 'text']);
        expect(parts[1].content).toBe('1girl, smiling');
        expect(parts[2].content).toBe('好看吧？');
    });

    it('和表情包混在一起时，各自归位', () => {
        const parts = ChatParser.splitResponse('[[SEND_EMOJI: 呆猫]]中间[[SEND_IMAGE: cat]]');
        expect(parts.map(p => p.type)).toEqual(['emoji', 'text', 'image']);
        expect(parts[0].content).toBe('呆猫');
        expect(parts[2].content).toBe('cat');
    });

    it('提示词里有换行也能整条吃下（模型爱换行排版）', () => {
        const parts = ChatParser.splitResponse('[[SEND_IMAGE: 1girl,\n  silver hair]]');
        expect(parts[0].type).toBe('image');
        expect(parts[0].content).toContain('silver hair');
    });

    it('没有指令时行为不变', () => {
        const parts = ChatParser.splitResponse('就是一句普通的话');
        expect(parts).toEqual([{ type: 'text', content: '就是一句普通的话' }]);
    });
});

describe('readImageGenMeta', () => {
    it('普通图片消息（用户自己发的）不会被误认成生图消息', () => {
        expect(readImageGenMeta(undefined)).toBeNull();
        expect(readImageGenMeta({})).toBeNull();
        expect(readImageGenMeta({ imageGen: {} })).toBeNull();     // 没 status 不算
        expect(readImageGenMeta({ caption: '图' })).toBeNull();
    });

    it('三态都能读出来，提示词一路带着（重试全靠它）', () => {
        const pending = readImageGenMeta({ imageGen: { status: 'pending', prompt: '1girl' } });
        expect(pending?.status).toBe('pending');
        expect(pending?.prompt).toBe('1girl');

        const failed = readImageGenMeta({ imageGen: { status: 'failed', prompt: 'cat', error: 'HTTP 401' } });
        expect(failed?.status).toBe('failed');
        expect(failed?.error).toBe('HTTP 401');
        expect(failed?.prompt).toBe('cat');   // 失败也要留住提示词，否则没法重画

        expect(readImageGenMeta({ imageGen: { status: 'generated', prompt: 'x' } })?.status).toBe('generated');
    });
});

describe('buildSelfiePrompt', () => {
    const base = cfg({ characterAppearance: { c1: '1boy, silver hair, red eyes, skull necklace' } });

    it('自拍：角色外观拼在最前面，场景跟在后面', () => {
        expect(buildSelfiePrompt('c1', 'in garage, holding wrench', base))
            .toBe('1boy, silver hair, red eyes, skull necklace, in garage, holding wrench');
    });

    it('没给这个角色写外观 → 只用场景，不报错', () => {
        expect(buildSelfiePrompt('c2', 'in garage', base)).toBe('in garage');
    });

    it('场景为空 → 只剩外观（他只想发张脸也行）', () => {
        expect(buildSelfiePrompt('c1', '', base)).toBe('1boy, silver hair, red eyes, skull necklace');
    });
});

describe('splitResponse 区分自拍和拍别的', () => {
    it('SELFIE 和 IMAGE 各归各的类型', () => {
        const parts = ChatParser.splitResponse('[[SEND_SELFIE: in garage]]和[[SEND_IMAGE: ramen, no humans]]');
        expect(parts.map(p => p.type)).toEqual(['selfie', 'text', 'image']);
        expect(parts[0].content).toBe('in garage');
        expect(parts[2].content).toBe('ramen, no humans');
    });
});
