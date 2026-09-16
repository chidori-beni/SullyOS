import { describe, it, expect } from 'vitest';
import { WORLD_PRESETS, describePresetChanges, applyPreset } from './presets';

const world = (over: any = {}) => ({
    id: 'w1', name: '小镇', mode: 'medium', relationships: [], ...over,
} as any);

const byId = (id: 'observer' | 'immersive') => WORLD_PRESETS.find(p => p.id === id)!;

describe('小镇一键预设（阶段 4.2）', () => {
    it('两套都在，各有一句说明', () => {
        expect(WORLD_PRESETS).toHaveLength(2);
        for (const p of WORLD_PRESETS) {
            expect(p.name).toBeTruthy();
            expect(p.blurb.length).toBeGreaterThan(8);
        }
    });

    it('⭐ 两位使用者的核心差别落在「住不住进来」上', () => {
        expect(byId('observer').patch.hostPresence).toBe('absent');
        expect(byId('immersive').patch.hostPresence).toBe('outline');
    });

    it('⭐ 代入者住进去当主角 → 轻度；观察者在画外 → 中度（不特殊）', () => {
        expect(byId('immersive').patch.mode).toBe('light');
        expect(byId('observer').patch.mode).toBe('medium');
    });

    it('⛔⭐ 代入者不会被配成「重度/远方」—— 那两档说的是「你不在这个世界里」，和住进来矛盾', () => {
        expect(['heavy', 'distant']).not.toContain(byId('immersive').patch.mode);
    });

    describe('describePresetChanges —— 点之前先让用户看见', () => {
        it('⭐ 逐条给出「从 → 到」', () => {
            const changes = describePresetChanges(world({ mode: 'heavy', hostPresence: 'absent' }), byId('immersive'));
            const labels = changes.map(c => c.label);
            expect(labels).toContain('你住不住在镇上');
            expect(labels).toContain('你在他们心里的分量');
            const presence = changes.find(c => c.label === '你住不住在镇上')!;
            expect(presence.from).toContain('不住');
            expect(presence.to).toContain('写大纲');
        });

        it('⛔⭐ 只列真的会变的 —— 没变的项不该吓唬用户', () => {
            const w = world({ mode: 'medium', hostPresence: 'absent', injectToChat: true });
            expect(describePresetChanges(w, byId('observer'))).toHaveLength(0);
        });

        it('已经是这套 → 空数组（界面据此显示「已是这套」）', () => {
            const w = world({ mode: 'light', hostPresence: 'outline', injectToChat: true });
            expect(describePresetChanges(w, byId('immersive'))).toHaveLength(0);
        });

        it('⛔ 旧世界没有 hostPresence / injectToChat 时按缺省处理，不会误报', () => {
            const w = world({ mode: 'medium' });   // 缺省 absent + injectToChat 视为 true
            expect(describePresetChanges(w, byId('observer'))).toHaveLength(0);
        });

        it('关掉过「进记忆」的世界，套预设时会明确告诉你这一项要变回去', () => {
            const w = world({ mode: 'medium', hostPresence: 'absent', injectToChat: false });
            const changes = describePresetChanges(w, byId('observer'));
            expect(changes).toHaveLength(1);
            expect(changes[0]).toMatchObject({ label: '小镇的事进不进角色记忆', from: '不进', to: '进' });
        });
    });

    describe('applyPreset —— 只返回要改的那几项', () => {
        it('⛔⭐ 返回补丁而不是整个世界 —— 绝不能顺手覆盖别处正在编辑的字段', () => {
            const patch = applyPreset(byId('observer'));
            expect(Object.keys(patch).sort()).toEqual(['hostPresence', 'injectToChat', 'mode']);
        });

        it('⛔ 刻意不碰时间模式 —— 改了等于换一个世界', () => {
            for (const p of WORLD_PRESETS) {
                expect(applyPreset(p)).not.toHaveProperty('timeMode');
                expect(applyPreset(p)).not.toHaveProperty('simStartDate');
            }
        });

        it('⛔ 刻意不碰关系锁 / 地点 / 节日 / 转折点', () => {
            for (const p of WORLD_PRESETS) {
                const patch = applyPreset(p) as any;
                for (const k of ['relationships', 'places', 'festivals', 'thresholds', 'pendings']) {
                    expect(patch).not.toHaveProperty(k);
                }
            }
        });

        it('⛔ 每次返回新对象，改了不会污染预设本身', () => {
            const a = applyPreset(byId('observer')) as any;
            a.mode = 'heavy';
            expect(byId('observer').patch.mode).toBe('medium');
        });
    });
});
