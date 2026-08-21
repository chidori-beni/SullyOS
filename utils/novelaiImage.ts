/**
 * novelaiImage.ts —— 角色生图（NovelAI）
 *
 * 链路：角色在回复里写 `[[SEND_IMAGE: 提示词]]` → 这里把提示词组装成 NovelAI 的请求体
 * → 发给用户自己部署的中转 Worker → NovelAI 返回一个 **zip** → 解出里面的 PNG
 * → 压成 data URL 落成一条 `type:'image'` 的消息。
 *
 * 为什么要中转：NovelAI 一个跨域头都不返回，浏览器直连必被拦。中转 Worker 只做转发，
 * 不存 token、不存图（源码见部署包里的 novelai-relay.js）。
 *
 * 为什么自己解 zip 而不用 JSZip：解一个单文件 zip 只要读一遍中央目录，
 * 加上浏览器原生的 DecompressionStream 就够了；为此把 JSZip 拉进聊天主包不划算
 * （它现在只在备份那条懒加载的路上）。存储/deflate 两种压缩方式都实测过。
 *
 * 落库形态跟"用户自己发图"完全一致（压缩后的 data URL 存 content），所以渲染、备份、
 * 记忆宫殿剥图那些既有逻辑一行都不用改。
 */

import { DB } from './db';
import { processImage } from './file';

const LS_KEY = 'sullyos_imagegen_config_v1';

/** 落库前把原图压一压：NovelAI 出的图 1~2MB，原样进 IndexedDB 几十张就上百兆了。
 *  比用户上传那条路（600px / 0.6）宽松些——这是角色的"作品"，值得留清楚一点。 */
const STORE_MAX_WIDTH = 832;
const STORE_QUALITY = 0.85;

export interface ImageGenConfig {
    /** 总开关。关掉时角色的 [[SEND_IMAGE:]] 会降级成一句文字，不发请求、不花额度。 */
    enabled: boolean;
    /** 你自己部署的 novelai-relay Worker 地址 */
    relayUrl: string;
    /** NovelAI 持久 Token（Account → Get Persistent API Token） */
    token: string;
    model: string;
    width: number;
    height: number;
    steps: number;
    scale: number;
    /** 每张图都会追加的画质词，省得每次让模型自己写 */
    qualityTags: string;
    negativePrompt: string;
    /** 高级：一段 JSON，合并进 parameters 覆盖默认值。留空即不覆盖。 */
    extraParams: string;
}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
    enabled: false,
    relayUrl: '',
    token: '',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5,
    qualityTags: 'best quality, amazing quality',
    negativePrompt: 'lowres, bad anatomy, bad hands, worst quality, watermark, signature',
    extraParams: '',
};

export function getImageGenConfig(): ImageGenConfig {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return { ...DEFAULT_IMAGE_GEN_CONFIG };
        return { ...DEFAULT_IMAGE_GEN_CONFIG, ...(JSON.parse(raw) as Partial<ImageGenConfig>) };
    } catch {
        return { ...DEFAULT_IMAGE_GEN_CONFIG };
    }
}

export function setImageGenConfig(next: Partial<ImageGenConfig>): ImageGenConfig {
    const merged = { ...getImageGenConfig(), ...next };
    try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch { /* 隐私模式：存不了就这一次会话有效 */ }
    return merged;
}

/** 配置是否齐到能真的发请求。纯函数，方便直测。 */
export function isImageGenReady(cfg: ImageGenConfig | undefined | null): boolean {
    if (!cfg || !cfg.enabled) return false;
    return Boolean(cfg.relayUrl.trim() && cfg.token.trim() && cfg.model.trim());
}

/**
 * 组装 NovelAI 请求体（V4 / V4.5 结构；V3 也能吃，多出来的 v4_* 字段会被忽略）。
 * 已在真实接口上验证通过。
 */
export function buildNovelAiBody(prompt: string, cfg: ImageGenConfig): any {
    const positive = [prompt.trim(), cfg.qualityTags.trim()].filter(Boolean).join(', ');
    const negative = cfg.negativePrompt.trim();

    const parameters: any = {
        params_version: 3,
        width: cfg.width,
        height: cfg.height,
        scale: cfg.scale,
        sampler: 'k_euler_ancestral',
        steps: cfg.steps,
        n_samples: 1,
        ucPreset: 0,
        qualityToggle: true,
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: true,
        cfg_rescale: 0,
        noise_schedule: 'karras',
        legacy_v3_extend: false,
        skip_cfg_above_sigma: null,
        use_coords: false,
        seed: Math.floor(Math.random() * 4294967295),
        negative_prompt: negative,
        v4_prompt: {
            caption: { base_caption: positive, char_captions: [] },
            use_coords: false,
            use_order: true,
        },
        v4_negative_prompt: {
            caption: { base_caption: negative, char_captions: [] },
        },
    };

    // 高级覆盖：坏 JSON 不该让整次生图失败，忽略并留一条 console 线索即可。
    if (cfg.extraParams.trim()) {
        try {
            Object.assign(parameters, JSON.parse(cfg.extraParams));
        } catch (e) {
            console.error('[生图] 高级参数不是合法 JSON，已忽略这段覆盖：', e);
        }
    }

    return { input: positive, model: cfg.model.trim(), action: 'generate', parameters };
}

/**
 * 从 zip 里取出第一个文件。走中央目录定位，支持「存储」(0) 与 deflate (8)。
 * NovelAI 的响应就是一个只装着 image_0.png 的 zip。
 */
export async function unzipFirstFile(buf: ArrayBuffer): Promise<{ name: string; bytes: Uint8Array }> {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);

    // 从尾部倒着找 End of Central Directory（PK\x05\x06）
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 65558; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('返回的不是 zip（找不到目录结尾）');

    const count = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    if (!count) throw new Error('zip 里一个文件都没有');
    if (dv.getUint32(cdOff, true) !== 0x02014b50) throw new Error('zip 目录格式无法解析');

    const method = dv.getUint16(cdOff + 10, true);
    const compSize = dv.getUint32(cdOff + 20, true);
    const nameLen = dv.getUint16(cdOff + 28, true);
    const localOff = dv.getUint32(cdOff + 42, true);
    const name = new TextDecoder().decode(u8.subarray(cdOff + 46, cdOff + 46 + nameLen));

    if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('zip 文件头无法解析');
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(dataOff, dataOff + compSize);

    if (method === 0) return { name, bytes: data };
    if (method === 8) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('这个浏览器不支持解压 deflate');
        }
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        return { name, bytes };
    }
    throw new Error(`zip 用了不认识的压缩方式：${method}`);
}

/** 中转站的健康检查。用于设置页的「测试连接」，不花额度。 */
export async function pingRelay(relayUrl: string): Promise<{ ok: boolean; message: string }> {
    const url = relayUrl.trim().replace(/\/+$/, '');
    if (!url) return { ok: false, message: '还没填中转站地址' };
    try {
        const res = await fetch(url, { method: 'GET' });
        const text = await res.text();
        if (res.ok && text.includes('"relay":"novelai"')) return { ok: true, message: '中转站正常' };
        return { ok: false, message: `地址通了，但里面装的不是生图中转站（HTTP ${res.status}）` };
    } catch (e: any) {
        return { ok: false, message: `连不上：${e?.message || e}` };
    }
}

/**
 * 生成一张图，返回可直接落进 message.content 的 data URL。
 *
 * 失败时抛出的 Error 里带着 **NovelAI 的原话**——中转站不吞错误正文，
 * 这是排错唯一的线索，调用方应该原样显示给用户，不要改写成"生成失败"。
 */
export async function generateImageDataUrl(prompt: string, cfg: ImageGenConfig): Promise<string> {
    if (!isImageGenReady(cfg)) throw new Error('生图还没配置好（地址 / Token / 模型）');

    const url = cfg.relayUrl.trim().replace(/\/+$/, '');
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-nai-token': cfg.token.trim() },
        body: JSON.stringify(buildNovelAiBody(prompt, cfg)),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`NovelAI 拒绝了这次生图（HTTP ${res.status}）：${detail.slice(0, 500)}`);
    }

    const { bytes } = await unzipFirstFile(await res.arrayBuffer());
    // 用 Uint8Array 的实际视图切片喂给 Blob，避免把整个底层 buffer 带进去。
    const png = new Blob([bytes.slice()], { type: 'image/png' });
    const file = new File([png], 'novelai.png', { type: 'image/png' });
    return processImage(file, { maxWidth: STORE_MAX_WIDTH, quality: STORE_QUALITY, forceJpeg: true });
}


// ─────────────────────────────────────────────────────────────
//  异步生成 · 待生成气泡 / 失败重试
//
//  为什么不直接 await 到画完：一张图十几到几十秒，卡在回复的落库循环里，角色后面
//  那几句话要一起陪着等。改成「先落一条空的图片消息、立刻显示『正在画』，画完再回填」，
//  聊天节奏一点都不受影响。这个做法是从另一个开源小手机 float
//  （xiaolongbao0709/ai-virtual-phone）借鉴的，它的 imageGenerationStatus 三态
//  （pending / failed / generated）+ 可重试，比一次性阻塞成熟得多。
//
//  代价是要处理「画到一半页面被关了」——那条消息会永远停在 pending。所以 pending
//  和 failed 都给重试入口，而不是只有 failed 才给。
// ─────────────────────────────────────────────────────────────

/** 图片消息回填后广播，聊天页据此重新从库里读一次。 */
export const IMAGE_GEN_UPDATED_EVENT = 'sullyos-imagegen-updated';

export type ImageGenStatus = 'pending' | 'failed' | 'generated';

export interface ImageGenMeta {
    status: ImageGenStatus;
    /** 当初那句提示词。重试全靠它，别丢。 */
    prompt: string;
    error?: string;
}

function announceImageGenUpdated(): void {
    try {
        window.dispatchEvent(new CustomEvent(IMAGE_GEN_UPDATED_EVENT));
    } catch { /* SSR / 测试环境没有 window */ }
}

/** 从一条消息的 metadata 里读生图状态；不是生图消息返回 null。 */
export function readImageGenMeta(metadata: any): ImageGenMeta | null {
    const raw = metadata?.imageGen;
    if (!raw || typeof raw !== 'object' || !raw.status) return null;
    return raw as ImageGenMeta;
}

/**
 * 真正去画，然后把结果回填到那条已经落库的图片消息上。
 * **不抛异常**——失败也是一种要写回库、要让用户看见的结果，不是调用方需要接的错。
 */
export async function runImageGeneration(messageId: number, prompt: string): Promise<void> {
    const cfg = getImageGenConfig();
    try {
        const dataUrl = await generateImageDataUrl(prompt, cfg);
        await DB.updateMessage(messageId, dataUrl);
        await DB.updateMessageMetadata(messageId, (prev: any) => ({
            ...(prev || {}),
            imageGen: { status: 'generated', prompt } as ImageGenMeta,
        }));
    } catch (e: any) {
        const error = e?.message || String(e);
        console.error('[生图] 失败', e);
        await DB.updateMessageMetadata(messageId, (prev: any) => ({
            ...(prev || {}),
            imageGen: { status: 'failed', prompt, error } as ImageGenMeta,
        })).catch(() => { /* 库都写不进去就只能算了，至少别再抛一层 */ });
    }
    announceImageGenUpdated();
}

/**
 * 重试一条失败（或卡在 pending）的生图消息。
 *
 * 提示词由调用方（气泡）从 metadata 里读出来传进来——渲染层本来就拿着整条消息，
 * 为此在 db.ts 里加一个「按 id 取单条」反而是多一处要维护的读路径。
 */
export async function retryImageGeneration(messageId: number, prompt: string): Promise<void> {
    const clean = (prompt || '').trim();
    if (!clean) return;

    await DB.updateMessageMetadata(messageId, (prev: any) => ({
        ...(prev || {}),
        imageGen: { status: 'pending', prompt: clean } as ImageGenMeta,
    }));
    announceImageGenUpdated();
    await runImageGeneration(messageId, clean);
}
