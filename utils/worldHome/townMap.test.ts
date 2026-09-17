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
