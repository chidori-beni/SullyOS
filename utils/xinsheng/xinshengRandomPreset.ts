// 「每次生成随机套一个预设」的本轮override。
//
// 糯叽机的做法是：抽中预设后**直接写回角色档案**（CSS/布局/提示词全覆盖）。
// 这里没照抄，有两个理由：
//   1. Sully 的角色档案是「读内存 → 合并 → 整条写回」的，生成过程中插一次写角色
//      很容易和情绪 buff、日程改写那几条并发写回互相抹掉（OSContext 里已经为这个
//      踩过坑并留了注释）。
//   2. 写回档案会让**历史里的旧卡**也跟着变成新预设的样子 —— 昨天那条心声突然换了
//      一身皮，看不出当时是什么样。
//
// 改成：抽中的预设只作用于**这一轮**，随心声一起存进那条记录（entry._preset）。
// 卡片渲染时优先用记录自带的预设，所以每条历史永远保持它生成时的样子。

import type { CharacterProfile } from '../../types';
import { isPresetRandomEnabled, pickRandomPreset, type XinshengPreset } from './xinshengStore';

/**
 * 本轮抽中的预设，按角色存。**未被消费**（`peekXinshengRoundPreset` 还没读走）之前
 * 视为"这一轮还在进行中"，见下面 `prepareXinshengRoundPreset` 为什么不无脑重新抽。
 */
const roundPresets = new Map<string, XinshengPreset>();

/**
 * 一轮生成开始时调用：随机开关打开就抽一个，抽中的会被后续
 * buildSystemPromptParts（换提示词）和 applyAssistantPostProcessing（存进记录）看到。
 *
 * ⚠️ 不能无脑「每调一次就重新抽一次」——`buildSystemPromptParts` 在**同一轮回复**里可能
 * 被调用不止一次（典型场景：模型这轮触发了 RECALL/SEARCH 之类「二轮 LLM」，第二次要
 * 重新拼一份完整 system prompt 才能继续生成）。如果每次都重抽，第一次抽中 A、把 A 的
 * 字段指令写进了发给模型的 prompt，第二次却抽中 B、把 Map 里的 A 覆盖成了 B——模型
 * 实际是照着 A 生成的内容，落库时 `peekXinshengRoundPreset` 却读到 B，字段名对不上，
 * 渲染出来整张空白。这是用户用「随机套预设」实测直接命中的真实故障。
 *
 * 改成：**还没被消费的**那次抽取视为"这一轮的抽取还没完成"，直接复用，不重抽；
 * 只有上一次的抽取已经被 `peekXinshengRoundPreset` 读走（那一轮已经落库完毕）之后，
 * 才代表这是一轮全新的生成，可以重新抽。
 */
export const prepareXinshengRoundPreset = async (char: CharacterProfile): Promise<XinshengPreset | null> => {
    if (!char?.id || !char.xinshengEnabled) return null;
    try {
        if (!(await isPresetRandomEnabled())) {
            roundPresets.delete(char.id);
            return null;
        }
        // 上一次抽的还没被消费 —— 大概率是同一轮的二轮 LLM 重新拼 prompt，复用同一份，
        // 不然模型这轮实际收到的指令会在两次 prompt 之间不一致。
        const pending = roundPresets.get(char.id);
        if (pending) return pending;
        const picked = await pickRandomPreset();
        if (picked) roundPresets.set(char.id, picked);
        else roundPresets.delete(char.id);
        return picked;
    } catch (e) {
        console.warn('[xinsheng] 随机预设准备失败:', e);
        roundPresets.delete(char.id);
        return null;
    }
};

/**
 * 落库时调用：读走本轮预设**并清空**，标志这一轮正式结束——下一次
 * `prepareXinshengRoundPreset` 才会重新抽，而不是继续复用这一轮用过的。
 *
 * 之前是"只读不清"（peek），生成失败、没落成心声的轮次会让同一个预设一直挂在 Map
 * 里，直到哪天真的抽中新的才会替换——不算错，但也不是本意；改成读了就清，语义更准确：
 * 「这一轮」结束了，不管它有没有真的产出一条心声。
 */
export const takeXinshengRoundPreset = (charId: string): XinshengPreset | null => {
    const preset = roundPresets.get(charId) || null;
    roundPresets.delete(charId);
    return preset;
};

/** 记录里存的预设快照：够渲染那张卡就行，不存提示词。 */
export interface XinshengEntryPreset {
    name: string;
    displayMode: 'planner' | 'layout';
    layout: string;
    customCss: string;
}

export const toEntryPreset = (p: XinshengPreset): XinshengEntryPreset => ({
    name: p.name,
    displayMode: p.displayMode,
    layout: p.layout,
    customCss: p.customCss,
});

/** 测试用：清干净所有角色的本轮预设。 */
export const resetXinshengRoundPresets = (): void => { roundPresets.clear(); };
