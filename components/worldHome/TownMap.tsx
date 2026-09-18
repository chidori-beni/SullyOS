/**
 * 阶段 6 · 小镇地图 —— 把「这半天谁在哪儿」画出来。
 *
 * 坐标全部由 `utils/worldHome/townMap.ts` 算好（纯函数、可测），
 * 这里只负责画。**这个文件里不要出现任何站位逻辑**，否则就没法测了。
 *
 * ## ⛔ 三条性能规矩（交接说明 §阶段 6 性能约束）
 *
 * 小镇最多十来个角色，家园主视图又是高频重渲染的地方，所以：
 *
 * 1. **每个小人一个独立组件 + memo** —— 一个人换了地方，只重绘那一个；
 * 2. **地点框静态化** —— 框子只跟地点表有关，跟小人无关，所以单独 memo；
 * 3. **位移用 `transform`** —— 走合成层，不触发布局重排。
 *
 * 别为它做过度优化（它比 Live2D 轻几个数量级），但上面三条别做丢。
 *
 * ## ⛔ 地图是只读的
 *
 * 点小人＝看 ta 的资料，点地点＝看这儿是干嘛的。**没有拖拽**。
 * 地图一旦能拖，下一步必然是「拖过去就算 ta 去了那儿」——
 * 那就成了系统替角色决定行踪。见 townMap.ts 文件头铁律一。
 */
import React from 'react';
import { MapPin, UsersThree } from '@phosphor-icons/react';
import { getChibi } from '../../utils/vrWorld/chibi';
import { TERRAINS, mapColsOf, type TownSlot, type TownFigure, type TownScene } from '../../utils/worldHome/townMap';
import { pickFigureSource, figureStyleOf, resolveMapBg, mapBgDimOf, resolveImageRef, placeImgDimOf } from '../../utils/worldHome/townFigures';
import type { CharacterProfile, WorldProfile } from '../../types';

/** 家园主视图的昼/夜 token 子集。只取用得上的几个，别把整套拖进来。 */
interface Theme {
    panelSolid: string;
    textMain: string;
    chip: string;
}

/**
 * 单个小人。⛔ memo 到自身 —— 别人换地方时这个不该重绘。
 *
 * 用哪套形象（像素 / chibi）由 `pickFigureSource` 决定，**两档互相兜底** ——
 * 见 townFigures.ts。这里只负责画出来。
 */
const Figure = React.memo<{
    figure: TownFigure;
    char?: CharacterProfile;
    /** 这个角色的像素小人（已渲染好的 data URI）。没捏过就没有。 */
    pixel?: string;
    style: 'pixel' | 'chibi';
    onClick?: (charId: string) => void;
}>(({ figure, char, pixel, style, onClick }) => {
    const src = pickFigureSource(style, pixel, char ? getChibi(char) : null);
    return (
        <button
            onClick={() => onClick?.(figure.charId)}
            title={figure.charName}
            className="absolute flex flex-col items-center gap-0.5 active:scale-95 transition-transform"
            style={{
                left: `${figure.x}%`,
                top: `${figure.y}%`,
                // ⛔ 用 transform 居中而不是负 margin：走合成层，不触发重排。
                transform: 'translate(-50%, -50%)',
                zIndex: 10 + figure.index,
            }}
        >
            {src ? (
                <img
                    src={src.img}
                    alt={figure.charName}
                    draggable={false}
                    /* 像素小人画大一点：它本来就是 53x56 的小图，
                       和 chibi 同尺寸的话会显得比 chibi 矮一截。 */
                    className={`${src.kind === 'pixel' ? 'w-11 h-11' : 'w-9 h-9'} object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,.25)]`}
                    style={{
                        transform: src.flip ? 'scaleX(-1)' : undefined,
                        // ⛔ 只有像素小人要 pixelated —— 给 chibi 用会把它糊成锯齿。
                        imageRendering: src.kind === 'pixel' ? 'pixelated' : undefined,
                    }}
                />
            ) : (
                // 连头像都没有：画一个首字圆片。⛔ 不能什么都不画 —— 那等于这个人消失了。
                <div className="w-8 h-8 rounded-full bg-white/90 border border-black/10 flex items-center justify-center text-[11px] font-black text-slate-600 shadow-sm">
                    {figure.charName.slice(0, 1)}
                </div>
            )}
            <span className="px-1 rounded bg-black/45 text-white text-[8px] font-bold leading-[1.4] whitespace-nowrap max-w-[56px] truncate">
                {figure.charName}
            </span>
        </button>
    );
});
Figure.displayName = 'TownMapFigure';

/**
 * 一个地点的框。⛔ 只依赖地点本身 —— 小人是 children 传进来的，框子不跟着重绘。
 *
 * ## 有图和没图是两套画法
 *
 * **没图**：地貌（6.2）给一层从下往上的淡色底纹 + 描边。
 * 不改文字色 —— 底色一深一浅的话，昼夜两套主题里总有一套的字会看不清。
 *
 * **有图**（2026-09-19）：图铺满整个框，地貌**退成一圈描边就好**。
 * 地貌本来就是「没有美术时的替代品」，真有图了还往上糊一层色只会把图弄脏。
 *
 * ⛔ 有图时地点名底下**必须垫一条深色渐变**：照片是什么颜色都可能，
 * 白字压在浅色天空上会直接消失，而地点名是这张图唯一的功能性内容。
 */
const Slot = React.memo<{
    slot: TownSlot;
    t: Theme;
    /** 这个地点的图（已解析好的地址）。没有就走地貌那套。 */
    img?: string | null;
    /** 图上压多重的遮罩（整个世界共用一个值） */
    imgDim?: number;
    overflow?: number;
    onClick?: (slotId: string) => void;
    children?: React.ReactNode;
}>(({ slot, t, img, imgDim = 0.3, overflow, onClick, children }) => {
    const terrain = slot.terrain ? TERRAINS[slot.terrain] : null;
    return (
    <div
        className={`relative rounded-2xl border overflow-hidden ${slot.isElsewhere ? 'border-dashed opacity-75' : ''} ${img ? 'bg-black' : t.panelSolid}`}
        style={{
            aspectRatio: '1 / 0.82',
            ...(terrain ? { borderColor: `${terrain.tint}66` } : null),
            // ⛔ 有图时不再叠地貌色：地貌是「没美术时的替代品」，真有图了叠上去只会把图弄脏。
            ...(terrain && !img ? {
                // 从下往上的一层淡色 —— 像地面的颜色透上来，而不是整块染色。
                backgroundImage: `linear-gradient(to top, ${terrain.tint}38, ${terrain.tint}10 55%, transparent)`,
            } : null),
        }}
    >
        {img ? (
            <>
                {/* ⛔ 用 background 而不是 <img>：图挂了就是没图，不会在框里留个破图图标。 */}
                <div className="absolute inset-0 bg-center bg-cover"
                    style={{ backgroundImage: `url(${JSON.stringify(img).slice(1, -1)})` }} />
                <div className="absolute inset-0 bg-black" style={{ opacity: imgDim }} />
                {/* 顶部那条渐变专门给地点名垫底 —— 照片顶部可能是任何颜色。 */}
                <div className="absolute inset-x-0 top-0 h-9 z-20 pointer-events-none"
                    style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.55), transparent)' }} />
            </>
        ) : null}
        <button
            onClick={() => onClick?.(slot.id)}
            disabled={slot.isElsewhere}
            className="absolute inset-x-0 top-0 z-30 px-2 py-1.5 flex items-center gap-1 text-left disabled:cursor-default"
        >
            {slot.isElsewhere
                ? <UsersThree size={10} weight="fill" className={`shrink-0 ${img ? 'text-white/80' : 'opacity-60'}`} />
                : <MapPin size={10} weight="fill" className={`shrink-0 ${img ? 'text-white/85' : 'opacity-70'}`} />}
            {/* 有图时一律白字 + 描边阴影：底下是照片，主题色在这儿不作数。 */}
            <span
                className={`text-[10px] font-black truncate ${img ? 'text-white' : t.textMain}`}
                style={img ? { textShadow: '0 1px 3px rgba(0,0,0,.85)' } : undefined}
            >{slot.name}</span>
            {terrain ? <span className="shrink-0 text-[9px] leading-none opacity-80" title={terrain.name}>{terrain.emoji}</span> : null}
            {overflow ? (
                <span className={`ml-auto shrink-0 text-[9px] font-black px-1 rounded ${img ? 'bg-black/55 text-white' : t.chip}`}>+{overflow}</span>
            ) : null}
        </button>
        {children}
    </div>
    );
});
Slot.displayName = 'TownMapSlot';

const TownMap: React.FC<{
    scene: TownScene;
    characters: CharacterProfile[];
    /** 只为读列数 / 小人形象 / 底图。⛔ 组件不碰 world 的别的东西，更不写回去。 */
    world: Pick<WorldProfile, 'mapCols' | 'figureStyle' | 'mapBg' | 'placeImgDim'>;
    /** charId → 像素小人 data URI。调用方异步备好，没备到的自动退 chibi。 */
    pixelSprites?: Record<string, string>;
    /** 本地上传那档底图的 data URI（调用方从资产库读）。贴链接那档用不上。 */
    bgAssetUrl?: string | null;
    /** placeId → 本地上传那档地点图的 data URI。贴链接那档用不上。 */
    placeImgAssets?: Record<string, string>;
    t: Theme;
    /** 点小人 —— 通常是打开 ta 的手机/资料 */
    onFigureClick?: (charId: string) => void;
    /** 点地点标题 —— 通常是展开这个地方的介绍 */
    onSlotClick?: (slotId: string) => void;
}> = ({ scene, characters, world, pixelSprites, bgAssetUrl, placeImgAssets, t, onFigureClick, onSlotClick }) => {
    // 按槽分组一次，免得每个槽都把整个 figures 数组过一遍。
    const bySlot = React.useMemo(() => {
        const m = new Map<string, TownFigure[]>();
        for (const f of scene.figures) {
            const list = m.get(f.slotId) || [];
            list.push(f);
            m.set(f.slotId, list);
        }
        return m;
    }, [scene.figures]);

    const charById = React.useMemo(
        () => new Map(characters.map(c => [c.id, c])),
        [characters],
    );

    const style = figureStyleOf(world);
    const bg = resolveMapBg(world.mapBg, bgAssetUrl);
    const dim = mapBgDimOf(world.mapBg);
    const placeDim = placeImgDimOf(world);

    const grid = (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${mapColsOf(world)}, minmax(0, 1fr))` }}>
            {scene.slots.map(slot => (
                <Slot
                    key={slot.id}
                    slot={slot}
                    t={t}
                    img={resolveImageRef(slot.img, placeImgAssets?.[slot.id])}
                    imgDim={placeDim}
                    overflow={scene.overflow[slot.id]}
                    onClick={onSlotClick}
                >
                    {(bySlot.get(slot.id) || []).map(f => (
                        <Figure
                            key={f.charId}
                            figure={f}
                            char={charById.get(f.charId)}
                            pixel={pixelSprites?.[f.charId]}
                            style={style}
                            onClick={onFigureClick}
                        />
                    ))}
                </Slot>
            ))}
        </div>
    );

    if (!bg) return grid;
    return (
        <div className="relative rounded-2xl overflow-hidden">
            {/* 底图铺在最底下。⛔ 用 background 而不是 <img>：图挂了就是没底图，
                不会在地图中间留一个破图图标。 */}
            <div
                className="absolute inset-0 bg-center bg-cover"
                style={{ backgroundImage: `url(${JSON.stringify(bg).slice(1, -1)})` }}
            />
            {/* ⛔ 遮罩是**必须的**，不是装饰：地点名和小人名字是这张图唯一的功能性内容，
                一张花哨的底图会让它们彻底读不出来。浓度可调但有下限，见 mapBgDimOf。 */}
            <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />
            <div className="relative p-2">{grid}</div>
        </div>
    );
};

export default React.memo(TownMap);
