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
import { TOWN_COLS, type TownSlot, type TownFigure, type TownScene } from '../../utils/worldHome/townMap';
import type { CharacterProfile } from '../../types';

/** 家园主视图的昼/夜 token 子集。只取用得上的几个，别把整套拖进来。 */
interface Theme {
    panelSolid: string;
    textMain: string;
    chip: string;
}

/** 单个小人。⛔ memo 到自身 —— 别人换地方时这个不该重绘。 */
const Figure = React.memo<{
    figure: TownFigure;
    char?: CharacterProfile;
    onClick?: (charId: string) => void;
}>(({ figure, char, onClick }) => {
    const chibi = char ? getChibi(char) : null;
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
            {chibi?.img ? (
                <img
                    src={chibi.img}
                    alt={figure.charName}
                    draggable={false}
                    className="w-9 h-9 object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,.25)]"
                    style={{ transform: chibi.flip ? 'scaleX(-1)' : undefined, imageRendering: 'pixelated' }}
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

/** 一个地点的框。⛔ 只依赖地点本身 —— 小人是 children 传进来的，框子不跟着重绘。 */
const Slot = React.memo<{
    slot: TownSlot;
    t: Theme;
    overflow?: number;
    onClick?: (slotId: string) => void;
    children?: React.ReactNode;
}>(({ slot, t, overflow, onClick, children }) => (
    <div
        className={`relative rounded-2xl border overflow-hidden ${slot.isElsewhere ? 'border-dashed opacity-75' : ''} ${t.panelSolid}`}
        style={{ aspectRatio: '1 / 0.82' }}
    >
        <button
            onClick={() => onClick?.(slot.id)}
            disabled={slot.isElsewhere}
            className="absolute inset-x-0 top-0 z-30 px-2 py-1.5 flex items-center gap-1 text-left disabled:cursor-default"
        >
            {slot.isElsewhere
                ? <UsersThree size={10} weight="fill" className="shrink-0 opacity-60" />
                : <MapPin size={10} weight="fill" className="shrink-0 opacity-70" />}
            <span className={`text-[10px] font-black truncate ${t.textMain}`}>{slot.name}</span>
            {overflow ? (
                <span className={`ml-auto shrink-0 text-[9px] font-black px-1 rounded ${t.chip}`}>+{overflow}</span>
            ) : null}
        </button>
        {children}
    </div>
));
Slot.displayName = 'TownMapSlot';

const TownMap: React.FC<{
    scene: TownScene;
    characters: CharacterProfile[];
    t: Theme;
    /** 点小人 —— 通常是打开 ta 的手机/资料 */
    onFigureClick?: (charId: string) => void;
    /** 点地点标题 —— 通常是展开这个地方的介绍 */
    onSlotClick?: (slotId: string) => void;
}> = ({ scene, characters, t, onFigureClick, onSlotClick }) => {
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

    return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${TOWN_COLS}, minmax(0, 1fr))` }}>
            {scene.slots.map(slot => (
                <Slot
                    key={slot.id}
                    slot={slot}
                    t={t}
                    overflow={scene.overflow[slot.id]}
                    onClick={onSlotClick}
                >
                    {(bySlot.get(slot.id) || []).map(f => (
                        <Figure key={f.charId} figure={f} char={charById.get(f.charId)} onClick={onFigureClick} />
                    ))}
                </Slot>
            ))}
        </div>
    );
};

export default React.memo(TownMap);
