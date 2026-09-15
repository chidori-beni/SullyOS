import { describe, it, expect } from 'vitest';
import {
    readVRPactMode, saveVRPactMode, buildVRPactRule,
    VR_PACT_KEY, DEFAULT_VR_PACT_MODE,
} from './pact';

/** 每个用例独立的假 storage，免得互相串味。 */
const mkStorage = (initial?: Record<string, string>) => {
    const map = new Map(Object.entries(initial || {}));
    return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => { map.set(k, v); },
        map,
    };
};

describe('彼方公约 · 开关读写（阶段 2.7）', () => {
    it('⭐ 默认开 —— 它保护的是用户辛苦绑好的 CP，默认关等于默认让它悄悄坏掉', () => {
        expect(DEFAULT_VR_PACT_MODE).toBe('friends_only');
        expect(readVRPactMode(mkStorage())).toBe('friends_only');
    });

    it('存过 off 就读成 off，随时可切', () => {
        const st = mkStorage();
        saveVRPactMode('off', st);
        expect(st.map.get(VR_PACT_KEY)).toBe('off');
        expect(readVRPactMode(st)).toBe('off');
        saveVRPactMode('friends_only', st);
        expect(readVRPactMode(st)).toBe('friends_only');
    });

    it('⛔ 读不出来时按默认（保护）走，不能因为读不到就放开', () => {
        const broken = { getItem: () => { throw new Error('私密模式'); } };
        expect(readVRPactMode(broken as any)).toBe('friends_only');
        expect(readVRPactMode(undefined)).toBe('friends_only');
    });

    it('存不下也不崩（存不下就下次仍按默认）', () => {
        const broken = { setItem: () => { throw new Error('配额满'); } };
        expect(() => saveVRPactMode('off', broken as any)).not.toThrow();
    });

    it('乱七八糟的值一律当默认', () => {
        expect(readVRPactMode(mkStorage({ [VR_PACT_KEY]: '随便什么' }))).toBe('friends_only');
    });
});

describe('彼方公约 · 提示词（阶段 2.7）', () => {
    const peers = [{ id: 'b', name: '阿岚' }, { id: 'c', name: '阿澄' }] as any;

    it('⭐ 开着时说清「止于朋友」', () => {
        const rule = buildVRPactRule('friends_only', {} as any, peers);
        expect(rule).toContain('止于朋友');
        expect(rule).toContain('不往暧昧和恋爱上走');
    });

    it('⛔ 关掉 = 一个字都不注入（旧行为零变化）', () => {
        expect(buildVRPactRule('off', {} as any, peers)).toBe('');
        expect(buildVRPactRule('off', { charBonds: [{ toId: 'b', label: '恋人' }] } as any, peers)).toBe('');
    });

    it('⛔ 没人同场就不注入 —— 没有对象的规矩是废话', () => {
        expect(buildVRPactRule('friends_only', {} as any, [])).toBe('');
        expect(buildVRPactRule('friends_only', {} as any, null)).toBe('');
    });

    it('⭐⛔ 本来就有关系的人自动豁免 —— 否则会把恋人在彼方演成生分的陌生人', () => {
        const char = { charBonds: [{ toId: 'b', toName: '阿岚', label: '恋人' }] } as any;
        const rule = buildVRPactRule('friends_only', char, peers);
        expect(rule).toContain('例外是阿岚');
        expect(rule).toContain('别因为这条底线跟熟人变生分');
        // 没关系的那个不进例外名单
        expect(rule).not.toContain('例外是阿岚、阿澄');
    });

    it('多个熟人一起列进例外', () => {
        const char = { charBonds: [
            { toId: 'b', label: '恋人' },
            { toId: 'c', label: '死对头' },
        ] } as any;
        expect(buildVRPactRule('friends_only', char, peers)).toContain('例外是阿岚、阿澄');
    });

    it('⛔ 只有好感没写关系名的不算「本来就认识」—— 还没处出一个说法来', () => {
        const char = { charBonds: [{ toId: 'b', value: 60 }] } as any;
        expect(buildVRPactRule('friends_only', char, peers)).not.toContain('例外');
    });

    it('一个熟人都没有时不写例外那句，不留半截话', () => {
        const rule = buildVRPactRule('friends_only', {} as any, peers);
        expect(rule).not.toContain('例外');
    });

    it('⛔ 不解释这条规矩的来历 —— 不能提机主、配队对象，也不能说是谁定的', () => {
        const rule = buildVRPactRule('friends_only', { charBonds: [{ toId: 'b', label: '恋人' }] } as any, peers);
        for (const forbidden of ['用户', '机主', '手机', '配队', '系统', '规定你', '设定要求']) {
            expect(rule).not.toContain(forbidden);
        }
        // 反过来，要写成 ta 自己的态度
        expect(rule).toContain('你自己');
    });

    it('⛔ 公约只管角色之间 —— 文案里明写对象是「在这游戏里认识的人」', () => {
        const rule = buildVRPactRule('friends_only', {} as any, peers);
        expect(rule).toContain('在这游戏里认识的人');
    });

    it('没名字的同场者不会拼出空的例外名', () => {
        const char = { charBonds: [{ toId: 'x', label: '恋人' }] } as any;
        const rule = buildVRPactRule('friends_only', char, [{ id: 'x', name: '' }] as any);
        expect(rule).not.toContain('例外');
    });
});
