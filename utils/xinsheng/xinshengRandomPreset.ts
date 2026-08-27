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

/** 本轮抽中的预设，按角色存。下一次 prepare 会覆盖它。 */
const roundPresets = new Map<string, XinshengPreset>();

/**
 * 一轮生成开始时调用：随机开关打开就抽一个，抽中的会被后续
 * buildSystemPromptParts（换提示词）和 applyAssistantPostProcessing（存进记录）看到。
 */
export const prepareXinshengRoundPreset = async (char: CharacterProfile): Promise<XinshengPreset | null> => {
    if (!char?.id || !char.xinshengEnabled) return null;
    try {
        if (!(await isPresetRandomEnabled())) {
            roundPresets.delete(char.id);
            return null;
        }
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

/** 读本轮预设（不清除 —— prompt 侧和落库侧都要读一次）。 */
export const peekXinshengRoundPreset = (charId: string): XinshengPreset | null =>
    roundPresets.get(charId) || null;

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
