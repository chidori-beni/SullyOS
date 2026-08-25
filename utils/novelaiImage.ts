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
import { saveImageToGallery } from './imageSave';
import { VISION_DESCRIPTION_METADATA_KEY } from './visionApi';

const LS_KEY = 'sullyos_imagegen_config_v1';

/** 尺寸下拉。抄自糯叽机那一份——都是 NovelAI 认的标准档。 */
export const SIZE_PRESETS = [
    '512x512', '512x768', '768x512', '768x768',
    '832x1216', '1216x832', '1024x1024', '1024x1536', '1536x1024',
] as const;

/** 模型列表，同样抄自糯叽机。 */
export const MODEL_PRESETS = [
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated',
    'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview',
    'nai-diffusion-3', 'nai-diffusion-furry-3',
] as const;

export const SAMPLER_PRESETS = [
    'k_euler_ancestral', 'k_euler', 'k_dpmpp_2m', 'k_dpmpp_2m_sde',
    'k_dpmpp_2s_ancestral', 'k_dpmpp_sde', 'ddim_v3',
] as const;

export const NOISE_SCHEDULES = ['karras', 'native', 'exponential', 'polyexponential'] as const;

/**
 * Variety+（官网那个开关）实为把 skip_cfg_above_sigma 从 null 换成一个**跟尺寸挂钩**的数，
 * 不是固定值。公式与常数取自 SillyTavern 的实现（PR #4417）：
 *     sqrt(w*h / 1011712) * 魔数      魔数：V4.5 用 58，其余用 19
 * 1011712 = 832×1216，NovelAI 的参考尺寸。
 */
const VARIETY_REFERENCE_PIXELS = 1011712;
export function calcSkipCfgAboveSigma(width: number, height: number, model: string): number {
    const magic = model.includes('nai-diffusion-4-5') ? 58 : 19;
    return Math.sqrt((width * height) / VARIETY_REFERENCE_PIXELS) * magic;
}

/** 把 '832x1216' 拆成数字；填了乱七八糟的东西就退回默认档。 */
export function parseSize(size: string): { width: number; height: number } {
    const m = /^(\d+)x(\d+)$/.exec((size || '').trim());
    if (!m) return { width: 832, height: 1216 };
    return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

/** 一套画风预设：换风格时整套一起换，不用一个字段一个字段改。 */
export interface ImageGenPreset {
    id: string;
    name: string;
    qualityTags: string;
    negativePrompt: string;
    size: string;
    steps: number;
    scale: number;
    sampler: string;
    noiseSchedule: string;
    varietyPlus: boolean;
    officialQualityTags: boolean;
}

/** 预设里真正会被套用的那些字段。 */
export const PRESET_FIELDS = [
    'qualityTags', 'negativePrompt', 'size', 'steps', 'scale',
    'sampler', 'noiseSchedule', 'varietyPlus', 'officialQualityTags',
] as const;

export interface ImageGenConfig {
    /** 总开关。关掉时角色的发图指令降级成一句文字，不发请求、不花额度。 */
    enabled: boolean;
    /** 你自己部署的 novelai-relay Worker 地址 */
    relayUrl: string;
    /** NovelAI 持久 Token（Account → Get Persistent API Token） */
    token: string;
    model: string;
    /** 形如 '832x1216'，见 SIZE_PRESETS */
    size: string;
    steps: number;
    scale: number;
    sampler: string;
    noiseSchedule: string;
    /** 固定种子；0 = 每次随机。想复现某张图才填具体数字。 */
    seed: number;
    /** Variety+：构图更多样，对应官网那个开关 */
    varietyPlus: boolean;
    /** 让 NovelAI 自动追加它自己的官方画质词（官网的 Quality Tags 开关） */
    officialQualityTags: boolean;
    /** 你自己的画质词，每张都追加在角色写的提示词后面 */
    qualityTags: string;
    negativePrompt: string;
    /**
     * 落库时缩到多宽；**0 = 原尺寸不缩**。
     * 之前写死 832，导致「画的是 1024，存下来变 832」——那是存储压缩，不是生成限制。
     */
    storeMaxWidth: number;
    /** 存图的 JPEG 质量 0~1 */
    storeQuality: number;
    /** 每个角色自己的外观提示词：画「他自己」时自动拼在最前面。key = charId */
    characterAppearance: Record<string, string>;
    /** 存好的画风预设 */
    presets: ImageGenPreset[];
    /** 当前套用的是哪一套；手改过任何一个预设字段就清空，界面据此显示「已改动」。 */
    activePresetId: string;
    /** 高级：一段 JSON，合并进 parameters，覆盖上面算出来的一切。留空即不覆盖。 */
    extraParams: string;
}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
    enabled: false,
    relayUrl: '',
    token: '',
    model: 'nai-diffusion-4-5-full',
    size: '832x1216',
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seed: 0,
    varietyPlus: false,
    officialQualityTags: true,
    qualityTags: '',
    negativePrompt: 'lowres, bad anatomy, bad hands, worst quality, watermark, signature',
    storeMaxWidth: 0,
    storeQuality: 0.9,
    characterAppearance: {},
    presets: [],
    activePresetId: '',
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

export interface GenerateOptions {
    /**
     * 强制换一个随机种子。
     *
     * 「重画」时必须开：`cfg.seed > 0` 是「锁脸」用的固定种子，同提示词 + 同种子
     * = 同一张图，重画会原地踏步。这跟功能 4 语音重 roll 踩的是同一个坑
     * （缓存 / 种子没变 → 拿回一模一样的东西），那次的教训是「重来就得真的重来」。
     */
    forceReseed?: boolean;
}

/**
 * 组装 NovelAI 请求体（V4 / V4.5 结构；V3 也吃，多出来的 v4_* 字段会被忽略）。
 * 已在真实接口上验证通过。
 */
export function buildNovelAiBody(prompt: string, cfg: ImageGenConfig, opts?: GenerateOptions): any {
    const { width, height } = parseSize(cfg.size);
    const positive = [prompt.trim(), cfg.qualityTags.trim()].filter(Boolean).join(', ');
    const negative = cfg.negativePrompt.trim();

    const parameters: any = {
        params_version: 3,
        width,
        height,
        scale: cfg.scale,
        sampler: cfg.sampler,
        steps: cfg.steps,
        n_samples: 1,
        ucPreset: 0,
        // 官网的 Quality Tags 开关：开着 NovelAI 自己会追加一串官方画质词。
        // 所以你自己的「画质词」是**额外**加的，不是替代——两边都写会重复。
        qualityToggle: cfg.officialQualityTags,
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        add_original_image: true,
        cfg_rescale: 0,
        noise_schedule: cfg.noiseSchedule,
        legacy_v3_extend: false,
        // Variety+ ：关 = null，开 = 按尺寸算出来的那个数（见 calcSkipCfgAboveSigma）
        skip_cfg_above_sigma: cfg.varietyPlus ? calcSkipCfgAboveSigma(width, height, cfg.model) : null,
        use_coords: false,
        seed: cfg.seed > 0 && !opts?.forceReseed ? cfg.seed : Math.floor(Math.random() * 4294967295),
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
 * 画「这个角色自己」时用的提示词：把他的外观提示词拼在最前面。
 * 角色卡里的外观特征每次都让主模型自己写一遍，写出来必然飘——固定在这里最稳。
 */
export function buildSelfiePrompt(charId: string, scene: string, cfg: ImageGenConfig): string {
    const look = (cfg.characterAppearance?.[charId] || '').trim();
    return [look, scene.trim()].filter(Boolean).join(', ');
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
export async function generateImageDataUrl(prompt: string, cfg: ImageGenConfig, genOpts?: GenerateOptions): Promise<string> {
    if (!isImageGenReady(cfg)) throw new Error('生图还没配置好（地址 / Token / 模型）');

    const url = cfg.relayUrl.trim().replace(/\/+$/, '');
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-nai-token': cfg.token.trim() },
        body: JSON.stringify(buildNovelAiBody(prompt, cfg, genOpts)),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`NovelAI 拒绝了这次生图（HTTP ${res.status}）：${detail.slice(0, 500)}`);
    }

    const { bytes } = await unzipFirstFile(await res.arrayBuffer());
    // 用实际视图切片喂给 Blob，避免把整个底层 buffer 带进去。
    const png = new Blob([bytes.slice()], { type: 'image/png' });
    const file = new File([png], 'novelai.png', { type: 'image/png' });
    // storeMaxWidth = 0 → 原尺寸不缩。之前这里写死 832，把 1024 的图存成了 832。
    const opts: { maxWidth?: number; quality?: number; forceJpeg?: boolean } =
        { quality: cfg.storeQuality, forceJpeg: true };
    if (cfg.storeMaxWidth > 0) opts.maxWidth = cfg.storeMaxWidth;
    return processImage(file, opts);
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

/**
 * 把角色画的图也存进「相册」。
 *
 * 上游只在**用户自己发图**那条路上调 saveGalleryImage（见 apps/Chat.tsx 的 handleSendText），
 * 所以角色发的图从来进不了相册 —— 表现为「生图成功了，但收藏不了、相册里找不到」。
 * 既然生图是我加的功能，这一半也该我补齐。
 *
 * best-effort：相册写失败不该影响图片本身已经落进聊天记录这件事。
 */
async function saveToGallery(charId: string | undefined, dataUrl: string, prompt: string): Promise<string | null> {
    if (!charId) return null;
    try {
        // 相册里点开能看到当初那句提示词，比一张没头没脑的图有用得多。
        return await saveImageToGallery(charId, dataUrl, { chatContext: [`${prompt}`], idPrefix: 'img-gen' });
    } catch (e) {
        console.error('[生图] 存进相册失败（图本身已经在聊天记录里了）：', e);
        return null;
    }
}

/** 图片消息回填后广播，聊天页据此重新从库里读一次。 */
export const IMAGE_GEN_UPDATED_EVENT = 'sullyos-imagegen-updated';

export type ImageGenStatus = 'pending' | 'failed' | 'generated';

export interface ImageGenMeta {
    status: ImageGenStatus;
    /** 当初那句提示词。重试和重画全靠它，别丢。 */
    prompt: string;
    error?: string;
    /**
     * 这张图在「相册」App 里那条记录的 id。
     *
     * 存在 = 已经进过相册，看大图时的「存到相册」按钮据此变灰，
     * 不会每点一次就在相册里多堆一张一模一样的。
     * 老消息没有这个字段，第一次手动存会补上。
     */
    galleryImageId?: string;
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
export async function runImageGeneration(messageId: number, prompt: string, charId?: string): Promise<void> {
    const cfg = getImageGenConfig();
    try {
        const dataUrl = await generateImageDataUrl(prompt, cfg);
        await applyGeneratedImage(messageId, dataUrl, prompt, charId);
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
 * 把一张已经画好的图写进那条消息：正文、相册、生图状态、识图缓存，一次搞定。
 *
 * 抽出来是因为现在有两条路会产出图：第一次生成（`runImageGeneration`）和看大图时的
 * 重画确认（`components/chat/ImageViewer.tsx`）。两边必须写一模一样的东西，
 * 尤其是那条识图缓存 —— 漏了它，重画出来的图下一轮会被送去识图 API 认一遍。
 *
 * 不广播事件，由调用方决定什么时候刷新聊天页。
 */
export async function applyGeneratedImage(
    messageId: number,
    dataUrl: string,
    prompt: string,
    charId?: string,
): Promise<void> {
    await DB.updateMessage(messageId, dataUrl);
    const galleryImageId = await saveToGallery(charId, dataUrl, prompt);
    await DB.updateMessageMetadata(messageId, (prev: any) => ({
        ...(prev || {}),
        imageGen: {
            status: 'generated',
            prompt,
            ...(galleryImageId ? { galleryImageId } : {}),
        } as ImageGenMeta,
        // 顺手把「这张图画的是什么」写进识图缓存。
        //
        // 不然下一轮 materializeVisionDescriptions 会把这张图发给识图 API 去认——
        // 又慢、又花钱、还可能因为图太大直接失败（表现为「识图 API 没有返回图片描述」，
        // 整轮回复跟着挂掉）。而这张图本来就是我们按提示词画的，**我们比任何识图模型都更
        // 清楚它画了什么**，没有任何理由再去问一遍。
        [VISION_DESCRIPTION_METADATA_KEY]: `（这是一张刚生成的图，画面内容：${prompt}）`,
        visionRecognizedAt: Date.now(),
        visionModel: 'novelai-prompt',
    }));
}

/**
 * 重画：按提示词再画一张，**只把图片 data URL 交出来，一个字都不写库**。
 *
 * 为什么不直接覆盖那条消息：照糯叽机的做法，重画是「先看看，满意再换」。
 * 一路重画出来的每一张都留在看图界面里可以来回翻，用户挑定哪张、或者干脆退回原图，
 * 都由界面那边决定，最后才调 `applyGeneratedImage` 落库。
 * 直接覆盖的话，第一张重画不满意就再也回不去了。
 *
 * `forceReseed` 恒为 true —— 见 `GenerateOptions.forceReseed` 的注释。
 */
export async function rerollImageOnce(prompt: string): Promise<string> {
    const clean = (prompt || '').trim();
    if (!clean) throw new Error('没有提示词，画不了');
    return generateImageDataUrl(clean, getImageGenConfig(), { forceReseed: true });
}

/** 图片消息被改动后，让聊天页重读一次库。给 ImageViewer 这类库外调用方用。 */
export function notifyImageGenUpdated(): void {
    announceImageGenUpdated();
}

/**
 * 重试一条失败（或卡在 pending）的生图消息。
 *
 * 提示词由调用方（气泡）从 metadata 里读出来传进来——渲染层本来就拿着整条消息，
 * 为此在 db.ts 里加一个「按 id 取单条」反而是多一处要维护的读路径。
 */
export async function retryImageGeneration(messageId: number, prompt: string, charId?: string): Promise<void> {
    const clean = (prompt || '').trim();
    if (!clean) return;

    await DB.updateMessageMetadata(messageId, (prev: any) => ({
        ...(prev || {}),
        imageGen: { status: 'pending', prompt: clean } as ImageGenMeta,
    }));
    announceImageGenUpdated();
    await runImageGeneration(messageId, clean, charId);
}
