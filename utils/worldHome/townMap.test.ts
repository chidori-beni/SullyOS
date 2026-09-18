import { describe, it, expect } from 'vitest';
import {
    ELSEWHERE_SLOT,
    ELSEWHERE_NAME,
    TOWN_COLS,
    FIGURES_PER_SLOT,
    buildTownSlots,
    scatterInSlot,
    buildTownScene,
    canRenderTownMap,
    TERRAINS,
    MAP_COL_CHOICES,
    mapColsOf,
    guessTerrain,
    movePlace,
} from './townMap';
import type { WorldProfile, WorldCharBeat } from '../../types';

const M = (id: string, name: string) => ({ id, name });
const beat = (charId: string, placeId?: string): WorldCharBeat =>
    ({ charId, charName: charId, placeId } as unknown as WorldCharBeat);

function mkWorld(places: { id: string; name: string; blurb?: string }[] = []): WorldProfile {
    return { id: 'w1', name: '雾岛', memberIds: [], npcs: [], relationships: [], storyClock: 3, places } as unknown as WorldProfile;
}

describe('阶段 6 · 小镇地图底座', () => {
    describe('画不画得了', () => {
        it('没有地点表就不画 —— 只有一个「镇上某处」的图等于告诉用户地图坏了', () => {
            expect(canRenderTownMap(mkWorld())).toBe(false);
            expect(canRenderTownMap({ ...mkWorld(), places: undefined } as WorldProfile)).toBe(false);
        });

        it('有地点就能画', () => {
            expect(canRenderTownMap(mkWorld([{ id: 'p1', name: '面包房' }]))).toBe(true);
        });
    });

    describe('6.2 · 一行放几个', () => {
        it('缺省 2 列 —— 手机竖屏下 3 个就开始挤了', () => {
            expect(mapColsOf({})).toBe(2);
            expect(mapColsOf({ mapCols: undefined })).toBe(2);
        });

        it('设成 3 就是 3', () => {
            expect(mapColsOf({ mapCols: 3 })).toBe(3);
        });

        it('⛔ 存档里的坏值退回缺省，别信存档', () => {
            expect(mapColsOf({ mapCols: 7 as unknown as 3 })).toBe(2);
            expect(mapColsOf({ mapCols: 0 as unknown as 2 })).toBe(2);
        });

        it('只给两档', () => {
            expect(MAP_COL_CHOICES).toEqual([2, 3]);
        });

        it('⭐ 排布跟着列数走', () => {
            const four = [1, 2, 3, 4].map(i => ({ id: `p${i}`, name: `地方${i}` }));
            const two = buildTownSlots({ ...mkWorld(four) }, false);
            expect(two.map(s => [s.col, s.row])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
            const three = buildTownSlots({ ...mkWorld(four), mapCols: 3 } as WorldProfile, false);
            expect(three.map(s => [s.col, s.row])).toEqual([[0, 0], [1, 0], [2, 0], [0, 1]]);
        });
    });

    describe('6.2 · 地貌', () => {
        it('六种地貌都有名字、图标和主色', () => {
            for (const k of Object.keys(TERRAINS) as (keyof typeof TERRAINS)[]) {
                expect(TERRAINS[k].name).toBeTruthy();
                expect(TERRAINS[k].emoji).toBeTruthy();
                expect(TERRAINS[k].tint).toMatch(/^#[0-9a-f]{6}$/i);
            }
        });

        it('地貌原样带到槽上', () => {
            const w = mkWorld([{ id: 'p1', name: '码头' }]);
            (w.places as { terrain?: string }[])[0].terrain = 'water';
            expect(buildTownSlots(w, false)[0].terrain).toBe('water');
        });

        it('⭐ 地点图的引用原样带到槽上（真正取地址是渲染层的事）', () => {
            const w = mkWorld([{ id: 'p1', name: '面包房' }]);
            (w.places as { img?: unknown }[])[0].img = { kind: 'url', url: 'https://img/bakery' };
            expect(buildTownSlots(w, false)[0].img).toEqual({ kind: 'url', url: 'https://img/bakery' });
        });

        it('没配图的地点就是没有，不编一个', () => {
            expect(buildTownSlots(mkWorld([{ id: 'p1', name: '面包房' }]), false)[0].img).toBeUndefined();
        });

        it('⛔ 兜底槽永远没有图 —— 我们根本不知道 ta 在哪儿', () => {
            const slots = buildTownSlots(mkWorld([{ id: 'p1', name: '码头' }]), true);
            expect(slots[slots.length - 1].img).toBeUndefined();
        });

        it('⛔ 兜底槽永远没有地貌 —— 我们本来就不知道 ta 在哪儿', () => {
            const slots = buildTownSlots(mkWorld([{ id: 'p1', name: '码头' }]), true);
            expect(slots[slots.length - 1].terrain).toBeUndefined();
        });

        describe('按名字猜', () => {
            it('认得出常见的几类', () => {
                expect(guessTerrain('码头')).toBe('water');
                expect(guessTerrain('后山')).toBe('height');
                expect(guessTerrain('旧书店')).toBe('indoor');
                expect(guessTerrain('中央广场')).toBe('street');
                expect(guessTerrain('竹林')).toBe('green');
            });

            it('⭐ 越特殊的越先判：「荒废的花园」是僻静，不是草木', () => {
                expect(guessTerrain('荒废的花园')).toBe('quiet');
                expect(guessTerrain('墓园')).toBe('quiet');
            });

            it('⛔⭐ 但「旧」不算僻静的信号 —— 否则「旧书店」「旧市集」会被僻静全吃掉', () => {
                expect(guessTerrain('旧书店')).toBe('indoor');
                expect(guessTerrain('旧市集')).toBe('street');
            });

            it('⛔⭐ 猜不出就返回 undefined，绝不硬猜 —— 乱猜的地貌比留空难看得多', () => {
                expect(guessTerrain('雾')).toBeUndefined();
                expect(guessTerrain('Ω')).toBeUndefined();
                expect(guessTerrain('')).toBeUndefined();
                expect(guessTerrain('   ')).toBeUndefined();
            });
        });
    });

    describe('6.2 · 调顺序', () => {
        const ps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

        it('上移就是和前一个交换', () => {
            expect(movePlace(ps, 'b', -1).map(p => p.id)).toEqual(['b', 'a', 'c']);
        });

        it('下移就是和后一个交换', () => {
            expect(movePlace(ps, 'b', 1).map(p => p.id)).toEqual(['a', 'c', 'b']);
        });

        it('⛔ 不改传进来的数组', () => {
            const before = ps.map(p => p.id);
            movePlace(ps, 'a', 1);
            expect(ps.map(p => p.id)).toEqual(before);
        });

        it('越界不动，也不炸', () => {
            expect(movePlace(ps, 'a', -1).map(p => p.id)).toEqual(['a', 'b', 'c']);
            expect(movePlace(ps, 'c', 1).map(p => p.id)).toEqual(['a', 'b', 'c']);
            expect(movePlace(ps, '不存在', 1).map(p => p.id)).toEqual(['a', 'b', 'c']);
        });

        it('⭐ 地图顺序就是数组顺序 —— 不另存坐标，就不会和地点表对不上', () => {
            const w = mkWorld([{ id: 'p1', name: '码头' }, { id: 'p2', name: '山顶' }]);
            w.places = movePlace(w.places!, 'p2', -1);
            expect(buildTownSlots(w, false).map(s => s.name)).toEqual(['山顶', '码头']);
        });
    });

    describe('地点排布', () => {
        const w = mkWorld([
            { id: 'p1', name: '面包房', blurb: '早上最香' },
            { id: 'p2', name: '书店' },
            { id: 'p3', name: '码头' },
        ]);

        it('按网格排，每行 TOWN_COLS 个', () => {
            const slots = buildTownSlots(w, false);
            expect(slots.map(s => [s.col, s.row])).toEqual([[0, 0], [1, 0], [0, 1]]);
            expect(TOWN_COLS).toBe(2);
        });

        it('地点的名字和介绍原样带过来', () => {
            const s = buildTownSlots(w, false)[0];
            expect(s.name).toBe('面包房');
            expect(s.blurb).toBe('早上最香');
            expect(s.isElsewhere).toBe(false);
        });

        it('⭐ 没人对不上时**不**凭空多一个空框子', () => {
            expect(buildTownSlots(w, false).some(s => s.isElsewhere)).toBe(false);
        });

        it('⭐ 需要时「镇上某处」排在最后，并且标出来', () => {
            const slots = buildTownSlots(w, true);
            const last = slots[slots.length - 1];
            expect(last.id).toBe(ELSEWHERE_SLOT);
            expect(last.name).toBe(ELSEWHERE_NAME);
            expect(last.isElsewhere).toBe(true);
        });
    });

    describe('槽内站位', () => {
        it('⭐⛔ 确定性：同样的输入算两次结果完全一样 —— 用随机的话每次重渲染小人都会跳', () => {
            const a = scatterInSlot(['c1', 'c2', 'c3']);
            const b = scatterInSlot(['c1', 'c2', 'c3']);
            expect(a).toEqual(b);
        });

        it('坐标都落在槽里（留了边距，小人不会贴着框线）', () => {
            for (const f of scatterInSlot(['a', 'b', 'c', 'd', 'e', 'f'])) {
                expect(f.x).toBeGreaterThanOrEqual(6);
                expect(f.x).toBeLessThanOrEqual(94);
                expect(f.y).toBeGreaterThanOrEqual(20);
                expect(f.y).toBeLessThanOrEqual(82);
            }
        });

        it('⭐ 摆成两排，下排靠前 —— 六个人不会叠在一条线上', () => {
            const ys = new Set(scatterInSlot(['a', 'b', 'c', 'd', 'e', 'f']).map(f => Math.round(f.y / 10)));
            expect(ys.size).toBeGreaterThan(1);
        });

        it('一个人居中附近，不会被挤到边上', () => {
            const [only] = scatterInSlot(['solo']);
            expect(only.x).toBeGreaterThan(40);
            expect(only.x).toBeLessThan(60);
        });

        it('index 就是同槽内的次序（渲染层拿它做 z-index）', () => {
            expect(scatterInSlot(['a', 'b', 'c']).map(f => f.index)).toEqual([0, 1, 2]);
        });

        it('空槽返回空数组', () => {
            expect(scatterInSlot([])).toEqual([]);
        });
    });

    describe('整张图', () => {
        const w = mkWorld([{ id: 'p1', name: '面包房' }, { id: 'p2', name: '书店' }]);
        const members = [M('c1', '青野'), M('c2', '林漪'), M('c3', '真昼')];

        it('按 beat.placeId 分到各自的地点', () => {
            const scene = buildTownScene(w, [beat('c1', 'p1'), beat('c2', 'p2'), beat('c3', 'p1')], members);
            const at = (id: string) => scene.figures.find(f => f.charId === id)!.slotId;
            expect(at('c1')).toBe('p1');
            expect(at('c2')).toBe('p2');
            expect(at('c3')).toBe('p1');
        });

        it('⛔⭐ 铁律二：placeId 对不上的人进「镇上某处」，既不藏也不硬塞给第一个地点', () => {
            const scene = buildTownScene(w, [beat('c1'), beat('c2', 'p2')], members);
            expect(scene.figures.find(f => f.charId === 'c1')!.slotId).toBe(ELSEWHERE_SLOT);
            // 没藏：三个人一个都不少
            expect(scene.figures).toHaveLength(3);
            // 没硬塞：p1 这一轮确实空着
            expect(scene.figures.some(f => f.slotId === 'p1')).toBe(false);
        });

        it('⛔ placeId 指向一个已经被删掉的地点，也算对不上 —— 别画到不存在的框里', () => {
            const scene = buildTownScene(w, [beat('c1', '删掉的地点')], [M('c1', '青野')]);
            expect(scene.figures[0].slotId).toBe(ELSEWHERE_SLOT);
        });

        it('这轮没演出来（没有 beat）的成员照样在图上，落在「镇上某处」', () => {
            const scene = buildTownScene(w, [beat('c1', 'p1')], members);
            expect(scene.figures).toHaveLength(3);
            expect(scene.figures.filter(f => f.slotId === ELSEWHERE_SLOT).map(f => f.charId).sort())
                .toEqual(['c2', 'c3']);
        });

        it('全员都对得上时，不出现「镇上某处」这个槽', () => {
            const scene = buildTownScene(w, [beat('c1', 'p1'), beat('c2', 'p2'), beat('c3', 'p2')], members);
            expect(scene.slots.some(s => s.isElsewhere)).toBe(false);
        });

        it('⭐ 站位与成员数组的顺序无关 —— 顺序一变小人就换位会很跳', () => {
            const beats = [beat('c1', 'p1'), beat('c2', 'p1'), beat('c3', 'p1')];
            const a = buildTownScene(w, beats, members).figures;
            const b = buildTownScene(w, beats, [...members].reverse()).figures;
            const key = (fs: typeof a) => fs.slice().sort((x, y) => x.charId < y.charId ? -1 : 1)
                .map(f => `${f.charId}@${f.slotId}:${f.x},${f.y}`);
            expect(key(a)).toEqual(key(b));
        });

        it('⭐ 人太多就折叠，不是挤成一团', () => {
            const many = Array.from({ length: FIGURES_PER_SLOT + 3 }, (_, i) => M(`c${i}`, `角色${i}`));
            const scene = buildTownScene(w, many.map(m => beat(m.id, 'p1')), many);
            expect(scene.figures.filter(f => f.slotId === 'p1')).toHaveLength(FIGURES_PER_SLOT);
            expect(scene.overflow['p1']).toBe(3);
        });

        it('没折叠时 overflow 是空的（渲染层据此省掉「+N」角标）', () => {
            const scene = buildTownScene(w, [beat('c1', 'p1')], [M('c1', '青野')]);
            expect(scene.overflow).toEqual({});
        });

        it('⛔⭐ 铁律一：算一遍图不改 world 一个字', () => {
            const before = JSON.stringify(w);
            buildTownScene(w, [beat('c1', 'p1'), beat('c2')], members);
            expect(JSON.stringify(w)).toBe(before);
        });

        it('没有成员时给一张空图，不炸', () => {
            const scene = buildTownScene(w, [], []);
            expect(scene.figures).toEqual([]);
            expect(scene.slots).toHaveLength(2);
        });
    });
});
