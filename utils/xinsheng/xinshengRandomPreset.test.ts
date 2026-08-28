import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CharacterProfile } from '../../types';

// ─── 真实故障复现：随机套预设 + 二轮 LLM，文字和样式来自两个不同预设 ──────────
//
// 用户实测反馈：开着「随机套预设」，点开心声发现整张空白；点「全文」一看，实际生成的
// 字段是按预设 A 的指令来的，但渲染用的却是预设 B 的布局——字段名对不上，自然空白。
//
// 根因：buildSystemPromptParts 在**同一轮回复**里可能被调用不止一次（模型这轮触发了
// RECALL/SEARCH 之类"二轮 LLM"，第二次要重新拼一份完整 system prompt 才能继续生成）。
// 旧实现每次调用 prepareXinshengRoundPreset 都无脑重新抽一次：第一次抽中 A、把 A 的
// 字段指令写进发给模型的 prompt，第二次却抽中 B、把 Map 里的 A 覆盖成了 B——模型实际
// 是照着 A 生成的内容，落库时读到的却是 B。

let isPresetRandomEnabled: any;
let pickRandomPreset: any;

vi.mock('./xinshengStore', () => ({
    isPresetRandomEnabled: vi.fn(),
    pickRandomPreset: vi.fn(),
}));

const {
    prepareXinshengRoundPreset,
    takeXinshengRoundPreset,
    resetXinshengRoundPresets,
} = await import('./xinshengRandomPreset');

const store = await import('./xinshengStore');
isPresetRandomEnabled = store.isPresetRandomEnabled as any;
pickRandomPreset = store.pickRandomPreset as any;

const CHAR: CharacterProfile = { id: 'c1', name: '萧逸', avatar: '', xinshengEnabled: true } as any;

const presetA = { id: 'xp_a', name: 'A', customCss: '', customPrompt: 'A的指令', layout: '', displayMode: 'layout', aiVisibleFields: '', createdAt: 0 };
const presetB = { id: 'xp_b', name: 'B', customCss: '', customPrompt: 'B的指令', layout: '', displayMode: 'layout', aiVisibleFields: '', createdAt: 0 };

beforeEach(() => {
    resetXinshengRoundPresets();
    isPresetRandomEnabled.mockReset();
    pickRandomPreset.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('prepareXinshengRoundPreset', () => {
    it('心声没开、或没有 char.id，直接返回 null，不碰抽取', async () => {
        expect(await prepareXinshengRoundPreset({ id: 'c1', xinshengEnabled: false } as any)).toBeNull();
        expect(await prepareXinshengRoundPreset({ xinshengEnabled: true } as any)).toBeNull();
        expect(pickRandomPreset).not.toHaveBeenCalled();
    });

    it('随机开关关着，返回 null，也不留下待消费的抽取结果', async () => {
        isPresetRandomEnabled.mockResolvedValue(false);
        expect(await prepareXinshengRoundPreset(CHAR)).toBeNull();
        expect(pickRandomPreset).not.toHaveBeenCalled();
    });

    it('真实故障场景：同一轮里第二次调用（二轮 LLM 重拼 prompt）复用第一次抽中的，不重抽', async () => {
        isPresetRandomEnabled.mockResolvedValue(true);
        pickRandomPreset.mockResolvedValue(presetA);

        const first = await prepareXinshengRoundPreset(CHAR);
        expect(first).toEqual(presetA);

        // 模拟二轮 LLM：即使 pickRandomPreset 这次会抽中不同的 B，也不该被用上
        pickRandomPreset.mockResolvedValue(presetB);
        const second = await prepareXinshengRoundPreset(CHAR);

        expect(second).toEqual(presetA); // 复用第一次的，不是新抽的 B
        expect(pickRandomPreset).toHaveBeenCalledTimes(1); // 只真正抽取了一次
    });

    it('上一轮被 take 消费掉之后，下一轮才会重新抽', async () => {
        isPresetRandomEnabled.mockResolvedValue(true);
        pickRandomPreset.mockResolvedValue(presetA);
        await prepareXinshengRoundPreset(CHAR);
        takeXinshengRoundPreset(CHAR.id); // 心声落库，消费掉这一轮

        pickRandomPreset.mockResolvedValue(presetB);
        const next = await prepareXinshengRoundPreset(CHAR);
        expect(next).toEqual(presetB); // 新一轮，重新抽中了 B
        expect(pickRandomPreset).toHaveBeenCalledTimes(2);
    });

    it('不同角色的待消费抽取互不干扰', async () => {
        isPresetRandomEnabled.mockResolvedValue(true);
        pickRandomPreset.mockResolvedValueOnce(presetA).mockResolvedValueOnce(presetB);
        const a = await prepareXinshengRoundPreset({ id: 'c1', xinshengEnabled: true } as any);
        const b = await prepareXinshengRoundPreset({ id: 'c2', xinshengEnabled: true } as any);
        expect(a).toEqual(presetA);
        expect(b).toEqual(presetB);
    });
});

describe('takeXinshengRoundPreset', () => {
    it('读走并清空——同一轮不会被读两次都拿到东西', async () => {
        isPresetRandomEnabled.mockResolvedValue(true);
        pickRandomPreset.mockResolvedValue(presetA);
        await prepareXinshengRoundPreset(CHAR);

        expect(takeXinshengRoundPreset(CHAR.id)).toEqual(presetA);
        expect(takeXinshengRoundPreset(CHAR.id)).toBeNull(); // 已经被消费，第二次读到空
    });

    it('没有待消费的抽取时返回 null，不抛异常', () => {
        expect(takeXinshengRoundPreset('从没抽过的角色')).toBeNull();
    });

    it('生成失败没落成心声的轮次：没被 take 就一直挂着，下一轮 prepare 会复用它', async () => {
        isPresetRandomEnabled.mockResolvedValue(true);
        pickRandomPreset.mockResolvedValue(presetA);
        await prepareXinshengRoundPreset(CHAR);
        // 这一轮没有调 take（比如模型没吐出心声 JSON，applyAssistantPostProcessing 没进入落库分支）

        pickRandomPreset.mockResolvedValue(presetB);
        const next = await prepareXinshengRoundPreset(CHAR);
        expect(next).toEqual(presetA); // 还是复用没被消费的 A，不是新抽的 B
    });
});
