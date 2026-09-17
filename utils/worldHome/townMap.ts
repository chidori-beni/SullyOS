/**
 * 阶段 6 · 小镇地图底座 —— 把「谁这半天在哪儿」摆成一张图。
 *
 * ## 这一层只算坐标，不画东西
 *
 * 渲染在 `components/worldHome/TownMap.tsx`。这里是纯函数，
 * 因为**站位必须可测**：小人有没有重叠、对不上地点的人去哪儿、
 * 同一批数据两次算出来是不是一样 —— 这些在 DOM 里很难验，在这儿一行断言就够。
 *
 * ## ⛔⭐ 铁律一：地图只读，绝不回写
 *
 * 地图反映 `world.places` 和 `beat.placeId`，**一个字都不写回去**。
 * 它是一面镜子，不是一个编辑器。
 *
 * 为什么要专门立这条：地图一旦能拖小人，下一步必然是「拖过去就算 ta 去了那儿」——
 * 那就成了系统替角色决定行踪，正是 §5 铁律「别把我的角色写崩」要防的。
 * 想改行踪走既有的编辑入口（重演那一段），不走地图。
 *
 * ## ⛔⭐ 铁律二：对不上地点的人不藏也不硬塞
 *
 * `beat.placeId` 对不上（`resolvePlaceId` 宁可放过不硬凑，见阶段 3.1）是**常态**，
 * 不是错误。这种人放进一个明确的「{@link ELSEWHERE_NAME}」槽：
 *
 * - **藏起来**的话，用户会以为角色这半天消失了；
 * - **硬塞进第一个地点**的话，地图就在撒谎 —— 比不画还糟。
 *
 * ## ⭐ 铁律三：站位是确定性的，不能用 Math.random
 *
 * 同一批数据必须每次算出同样的坐标。用随机的话，React 每重渲染一次小人就跳一次，
 * 而且「地图静态化 + 只重绘自身」（交接说明 §阶段 6 性能约束第 1、2 条）
 * 也就无从谈起 —— 位置都不稳定，memo 比较永远不相等。
 */
import type { WorldProfile, WorldCharBeat } from '../../types';

/** 「不在任何已知地点」的那个槽的 id。⛔ 不要和真实 placeId 混用。 */
export const ELSEWHERE_SLOT = '__elsewhere__';
/** 这个槽显示成什么。刻意是模糊的说法 —— 我们确实不知道 ta 在哪儿。 */
export const ELSEWHERE_NAME = '镇上某处';

/** 每行摆几个地点。手机竖屏下 2 列最不挤，宽屏由渲染层自己再排。 */
export const TOWN_COLS = 2;

/** 一个槽里最多显示几个小人，超出的折叠成「+N」。 */
export const FIGURES_PER_SLOT = 6;

export interface TownSlot {
    /** 真实地点 id，或 {@link ELSEWHERE_SLOT} */
    id: string;
    name: string;
    blurb?: string;
    /** 网格坐标（渲染层可以自己换排法，这里只给一个稳定的默认） */
    col: number;
    row: number;
    /** 是不是那个兜底槽 —— 渲染层通常给它另一种（更淡的）样式 */
    isElsewhere: boolean;
}

export interface TownFigure {
    charId: string;
    charName: string;
    /** 落在哪个槽（{@link TownSlot.id}） */
    slotId: string;
    /** 槽内百分比坐标（0~100），渲染层直接当 left/top 用 */
    x: number;
    y: number;
    /** 同槽内的序号，供渲染层做 z-index（靠下的盖住靠上的） */
    index: number;
}

export interface TownScene {
    slots: TownSlot[];
    figures: TownFigure[];
    /** 每个槽里超出 {@link FIGURES_PER_SLOT} 的人数（0 表示没折叠） */
    overflow: Record<string, number>;
}

/**
 * 稳定的小整数散列。只用来给站位加一点点抖动，**不是**安全散列。
 * 必须是纯函数且与运行次数无关 —— 见文件头铁律三。
 */
function hashId(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

/**
 * 把地点排成网格。
 *
 * ⭐ 「镇上某处」**永远排在最后**，而且只在真有人落进去时才出现 ——
 * 没人对不上的时候凭空多一个空框子，用户会以为哪儿出错了。
 */
export function buildTownSlots(world: WorldProfile, needElsewhere: boolean): TownSlot[] {
    const places = world.places || [];
    const slots: TownSlot[] = places.map((p, i) => ({
        id: p.id,
        name: p.name,
        blurb: p.blurb,
        col: i % TOWN_COLS,
        row: Math.floor(i / TOWN_COLS),
        isElsewhere: false,
    }));
    if (needElsewhere) {
        const i = places.length;
        slots.push({
            id: ELSEWHERE_SLOT,
            name: ELSEWHERE_NAME,
            col: i % TOWN_COLS,
            row: Math.floor(i / TOWN_COLS),
            isElsewhere: true,
        });
    }
    return slots;
}

/**
 * 在一个槽里摆 n 个小人：两排交错，下排稍微靠前。
 *
 * 返回的坐标是槽内百分比。**同样的输入永远得到同样的输出**（铁律三）。
 */
export function scatterInSlot(ids: string[]): { id: string; x: number; y: number; index: number }[] {
    const n = ids.length;
    if (n === 0) return [];
    return ids.map((id, i) => {
        // 两排：前 ceil(n/2) 个在后排，其余在前排。人少的时候自然就是一排。
        const perRow = Math.ceil(n / 2);
        const row = i < perRow ? 0 : 1;
        const inRow = row === 0 ? i : i - perRow;
        const rowCount = row === 0 ? perRow : n - perRow;
        // 均分这一排的宽度，两端各留半格 —— 不然最边上的小人会贴着框线。
        const x = rowCount > 0 ? ((inRow + 0.5) / rowCount) * 100 : 50;
        const y = row === 0 ? 42 : 64;
        // 一点点确定性抖动，免得站得像列队。幅度刻意很小（±4%），不会造成重叠。
        const jx = (hashId(id) % 9) - 4;
        const jy = (hashId(id + '|y') % 7) - 3;
        return {
            id,
            x: Math.max(6, Math.min(94, x + jx)),
            y: Math.max(20, Math.min(82, y + jy)),
            index: i,
        };
    });
}

/**
 * 这一轮每个成员在哪儿。
 *
 * @param beats 最近一轮的各角色演绎片段。没有 beat 的成员（这轮没演出来）
 *              落进「镇上某处」—— **不是错误**，见铁律二。
 */
export function buildTownScene(
    world: WorldProfile,
    beats: WorldCharBeat[],
    members: { id: string; name: string }[],
): TownScene {
    const placeIds = new Set((world.places || []).map(p => p.id));
    const beatOf = new Map(beats.map(b => [b.charId, b]));

    // 先分组：charId → 槽
    const bucket = new Map<string, { id: string; name: string }[]>();
    for (const m of members) {
        const pid = beatOf.get(m.id)?.placeId;
        // ⛔ placeId 存在但已经被用户删掉了那个地点 —— 也算「对不上」，别画到不存在的框里
        const slotId = pid && placeIds.has(pid) ? pid : ELSEWHERE_SLOT;
        const list = bucket.get(slotId) || [];
        list.push(m);
        bucket.set(slotId, list);
    }

    const needElsewhere = (bucket.get(ELSEWHERE_SLOT)?.length || 0) > 0;
    const slots = buildTownSlots(world, needElsewhere);

    const figures: TownFigure[] = [];
    const overflow: Record<string, number> = {};
    for (const slot of slots) {
        const all = bucket.get(slot.id) || [];
        // 排序按 id，保证站位与成员数组的顺序无关 —— 顺序一变小人就换位会很跳。
        const sorted = all.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const shown = sorted.slice(0, FIGURES_PER_SLOT);
        const hidden = sorted.length - shown.length;
        if (hidden > 0) overflow[slot.id] = hidden;
        for (const s of scatterInSlot(shown.map(c => c.id))) {
            const c = shown.find(x => x.id === s.id)!;
            figures.push({ charId: c.id, charName: c.name, slotId: slot.id, x: s.x, y: s.y, index: s.index });
        }
    }
    return { slots, figures, overflow };
}

/**
 * 这张图能不能画。
 *
 * ⭐ 没有地点表就画不了 —— 这时渲染层应该引导用户去加地点，
 * 而不是画一张只有「镇上某处」一个框的图（那等于告诉用户「地图坏了」）。
 */
export function canRenderTownMap(world: WorldProfile): boolean {
    return (world.places || []).length > 0;
}
