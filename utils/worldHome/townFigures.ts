/**
 * 小镇地图的**小人形象**与**自定义底图**（阶段 6.2 补，用户 2026-09-17 提的两条）。
 *
 * 这里只有**取舍逻辑**，不碰 DOM、不读 DB —— 那样才测得动。
 * 真正去 IndexedDB 拿图、去 canvas 压图的部分在 `WorldHomeApp`。
 *
 * ## 用户原话
 *
 * > 1. 小镇地图显示的角色不是像素角色，而是彼方用的那个 q 版角色，
 * >    虽然彼方的 chibi 也很可爱，但是**像素角色用到的地方太少了**，希望能用在小镇
 * > 2. 关于地图，我还是想能由玩家**手动上传图片**，可以本地传图片，也可以直接贴图床链接
 *
 * 第一条的关键词是「**用到的地方太少了**」—— 这不是「chibi 不好看」，
 * 是那套像素小人捏完只在小小窝一个角落里出现。所以缺省改成**像素优先**，
 * 但按老规矩 **做成开关**：喜欢 chibi 的随时切回去（`WorldProfile.figureStyle`）。
 */
import type { WorldFigureStyle, WorldMapBg, WorldImageRef, WorldProfile } from '../../types';

/** 角色的像素小人存在资产库的哪个 key。⛔ 必须和像素家园写入时用的一致。 */
export const pixelCharAssetKey = (charId: string) => `pixel_char_${charId}`;

/** 世界自定义底图存在资产库的哪个 key（本地上传的那种）。 */
export const mapBgAssetKey = (worldId: string) => `world_map_bg_${worldId}`;

/**
 * **某个地点**的图存在资产库的哪个 key（2026-09-19）。
 *
 * ⛔ 必须带上 worldId：地点 id 只在世界内唯一，两个世界各有一个 `wp_xxx` 完全可能。
 */
export const placeImgAssetKey = (worldId: string, placeId: string) =>
    `world_place_img_${worldId}_${placeId}`;

/**
 * 本地上传的底图压到多大。
 *
 * ⛔ **必须压** —— 底图和世界是一起存的量级，一张手机直出的 4MB 图
 * 会让每次存世界都拖上几 MB。1280 宽对一张背景图足够了。
 */
export const MAP_BG_MAX_W = 1280;
/** JPEG 质量。0.82 是「看不出来但小一半」的常见甜点。 */
export const MAP_BG_QUALITY = 0.82;

/**
 * 地点图压到多大。
 *
 * ⭐ 比整体底图小得多是**有意的**：地点框在手机上只有一百多像素宽，640 已经是二倍图了。
 * 而且这是 **N 张**（十个地点就是十张），压得不够狠的话，
 * 一个世界能在 IndexedDB 里堆出几十 MB。
 */
export const PLACE_IMG_MAX_W = 640;

/** 缺省的小人形象。⭐ 像素优先 —— 用户 2026-09-17 明确要求。 */
export const DEFAULT_FIGURE_STYLE: WorldFigureStyle = 'pixel';

export function figureStyleOf(world: Pick<Partial<WorldProfileLike>, 'figureStyle'>): WorldFigureStyle {
    return world.figureStyle === 'chibi' ? 'chibi' : DEFAULT_FIGURE_STYLE;
}
type WorldProfileLike = { figureStyle?: WorldFigureStyle };

/** 一个小人最后用哪张图、以及它是打哪儿来的（供渲染层决定要不要 pixelated）。 */
export interface FigureSource {
    img: string;
    kind: 'pixel' | 'chibi';
    /** chibi 那套自带的左右翻转。像素小人没有这个概念。 */
    flip?: boolean;
}

/**
 * 挑这个角色在地图上用哪张图。
 *
 * ⭐ **两档都会互相兜底**：选了像素但这个角色没捏过像素小人，就退回 chibi；
 * 反过来也一样。**绝不因为「你选的那档没有」就让这个人从地图上消失** ——
 * 和 townMap 铁律二（不藏人）同一条原则。
 *
 * 两档都没有时返回 `null`，渲染层画首字圆片。
 *
 * @param pixel  这个角色的像素小人（已渲染成 data URI），没捏过就是 undefined
 * @param chibi  `getChibi` 的结果。注意它自带头像兜底，所以多半不是空的
 */
export function pickFigureSource(
    style: WorldFigureStyle,
    pixel: string | undefined,
    chibi: { img: string; flip?: boolean } | null | undefined,
): FigureSource | null {
    const chibiSrc: FigureSource | null = chibi?.img
        ? { img: chibi.img, kind: 'chibi', flip: !!chibi.flip }
        : null;
    const pixelSrc: FigureSource | null = pixel ? { img: pixel, kind: 'pixel' } : null;
    // 先按偏好，拿不到就退另一档。
    return style === 'pixel' ? (pixelSrc || chibiSrc) : (chibiSrc || pixelSrc);
}

/**
 * 一张图最终该用哪个地址。底图和地点图共用这一个 —— 两边规则完全一样。
 *
 * - `kind: 'url'` → 直接用用户贴的图床链接（⛔ 我们不去下载它，也不代理它）
 * - `kind: 'asset'` → 用调用方从资产库读出来的那份 data URI
 *
 * 取不到就返回 `null` —— 渲染层退回没有图的样子，**不要显示破图**。
 */
export function resolveImageRef(
    ref: WorldImageRef | undefined,
    assetDataUrl: string | null | undefined,
): string | null {
    if (!ref) return null;
    if (ref.kind === 'url') {
        const u = (ref.url || '').trim();
        return u ? u : null;
    }
    return assetDataUrl || null;
}

/** 底图那一路的旧名字。保留是因为它的语义更具体，读代码时一眼知道在说底图。 */
export const resolveMapBg = (
    bg: WorldMapBg | undefined,
    assetDataUrl: string | null | undefined,
): string | null => resolveImageRef(bg, assetDataUrl);

/** 底图上压多重的一层遮罩（0~0.8）。缺省 0.35。 */
export const DEFAULT_MAP_BG_DIM = 0.35;

/**
 * 遮罩浓度。
 *
 * ⛔ **不能允许 0** —— 一张花哨的底图会让地点名和小人名字彻底看不清，
 * 而那两样是这张图唯一的功能性内容。下限 0.1 是「几乎看不出遮罩但字还读得出」。
 * 上限 0.8 是「基本只剩个氛围」，再高就等于没贴图。
 */
export function mapBgDimOf(bg: WorldMapBg | undefined): number {
    const d = bg?.dim;
    if (typeof d !== 'number' || Number.isNaN(d)) return DEFAULT_MAP_BG_DIM;
    return Math.max(0.1, Math.min(0.8, d));
}

/** 压在每张地点图上的遮罩浓度。缺省 0.3 —— 比整体底图轻一点，因为地点图本来就该看清。 */
export const DEFAULT_PLACE_IMG_DIM = 0.3;

/**
 * 地点图的遮罩浓度。整个世界共用一个值。
 *
 * ⛔ 和底图同理**不允许 0**：地点名和站在里面的角色名要读得出来。
 * ⭐ 不做成每个地点一个 —— 一张图一个浓度，整张地图会花得没法看。
 */
export function placeImgDimOf(world: Pick<WorldProfile, 'placeImgDim'> | null | undefined): number {
    const d = world?.placeImgDim;
    if (typeof d !== 'number' || Number.isNaN(d)) return DEFAULT_PLACE_IMG_DIM;
    return Math.max(0.1, Math.min(0.8, d));
}

/**
 * 粗判一个字符串像不像图片地址。
 *
 * ⭐ 刻意**很宽松**：图床的链接常常没有扩展名（`.../abc123` 就是张图）。
 * 这里只拦明显不是链接的输入，**宁可放过不硬拦** —— 拦错了用户会以为功能坏了。
 */
export function looksLikeImageUrl(s: string): boolean {
    const u = (s || '').trim();
    if (!u) return false;
    return /^https?:\/\/\S+$/i.test(u) || u.startsWith('data:image/');
}
