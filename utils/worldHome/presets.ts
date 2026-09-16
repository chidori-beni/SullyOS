/**
 * 小镇设置的两套一键预设（阶段 4.2）。
 *
 * ## 为什么需要它
 *
 * 铁律④「一切争议点都是开关，不许写死默认」的代价是：**开关会越堆越多**。
 * 到这一批为止，跟着世界走的设置已经有存在感档位、住不住进来、文风、人称、
 * 进不进记忆、时间模式、地点表、节日、关系转折点……
 * 新用户打开设置页会被吓到，而这正是交接说明里点名要避免的
 * （「为避免设置页吓人，应提供『观察者』『代入者』两套预设，一键切好一整套，想细调再展开」）。
 *
 * ## ⛔ 预设不是默认值
 *
 * 预设**只在用户点下去的那一刻**改东西，且**只改自己声明的那几项**。
 * 它不是新的缺省行为，也不会在建镇时自动套用 —— 那就变成写死默认了。
 *
 * ## ⛔ 点之前必须让用户看见会改什么
 *
 * 两位使用者的偏好几乎条条相反，任何一套预设对另一个人都是「把我的设置改坏了」。
 * 所以界面必须逐条列出 **从什么变成什么**（`describePresetChanges`），
 * 用户看完再决定点不点。**别做成点完才知道改了啥。**
 *
 * ## ⛔ 刻意不碰的东西
 *
 * - **时间模式**（真实/模拟）：建镇时定的，改了等于换一个世界（剧情时钟、章节归档全跟着变）。
 * - **关系锁**：锁哪几对是**逐对**的个人偏好（用户 B 原话「到时候我自己来开关」），
 *   一键批量锁/解锁只会帮倒忙。
 * - **地点表 / 节日 / 关系转折点**：那是这个世界的内容，不是「怎么玩」的偏好。
 */

import type { WorldProfile, WorldHomeMode, WorldHostPresence } from '../../types';

/** 预设会改的那几项 —— 刻意收得很窄，理由见文件头。 */
export type WorldPresetPatch = {
    mode: WorldHomeMode;
    hostPresence: WorldHostPresence;
    injectToChat: boolean;
};

export interface WorldPreset {
    id: 'observer' | 'immersive';
    name: string;
    /** 一句话：这套预设是给什么样的玩法用的 */
    blurb: string;
    patch: WorldPresetPatch;
}

export const WORLD_PRESETS: WorldPreset[] = [
    {
        id: 'observer',
        name: '观察者',
        blurb: '你在画外看着他们过日子。镇上的人把你当普通一员，不会围着你转。',
        patch: {
            hostPresence: 'absent',
            mode: 'medium',
            injectToChat: true,
        },
    },
    {
        id: 'immersive',
        name: '代入者',
        blurb: '你住进去当主角。每半天写一句自己在干嘛，他们会看见、会反应。',
        patch: {
            hostPresence: 'outline',
            mode: 'light',
            injectToChat: true,
        },
    },
];

const MODE_LABELS: Record<WorldHomeMode, string> = {
    light: '轻度（你是最重要的人）',
    medium: '中度（你是普通一员）',
    heavy: '重度（这个世界里没有你）',
    distant: '远方（你不住这儿，但你们是网友）',
};

const PRESENCE_LABELS: Record<WorldHostPresence, string> = {
    absent: '不住（你在画外）',
    silent: '静默（人在但不动）',
    outline: '写大纲（你写这半天在干嘛）',
    ghostwrite: 'AI 代笔',
};

/**
 * 点下去会改什么 —— 逐条「从 → 到」，**只列真的会变的**。
 *
 * 返回空数组 = 这个世界当前设置已经和这套预设一样了，按钮可以显示成「已是这套」。
 */
export function describePresetChanges(
    world: Pick<WorldProfile, 'mode' | 'hostPresence' | 'injectToChat'>,
    preset: WorldPreset,
): { label: string; from: string; to: string }[] {
    const out: { label: string; from: string; to: string }[] = [];
    const curPresence = world.hostPresence || 'absent';
    if (curPresence !== preset.patch.hostPresence) {
        out.push({
            label: '你住不住在镇上',
            from: PRESENCE_LABELS[curPresence],
            to: PRESENCE_LABELS[preset.patch.hostPresence],
        });
    }
    if (world.mode !== preset.patch.mode) {
        out.push({
            label: '你在他们心里的分量',
            from: MODE_LABELS[world.mode],
            to: MODE_LABELS[preset.patch.mode],
        });
    }
    // injectToChat 缺省是 true（旧世界没这字段时按开启处理）
    const curInject = world.injectToChat !== false;
    if (curInject !== preset.patch.injectToChat) {
        out.push({
            label: '小镇的事进不进角色记忆',
            from: curInject ? '进' : '不进',
            to: preset.patch.injectToChat ? '进' : '不进',
        });
    }
    return out;
}

/**
 * 把预设套上去，返回**只含要改的那几项**的补丁。
 *
 * ⛔ 返回补丁而不是整个世界：调用方用 `upd(patch)` 合并，
 * 这样绝不会顺手把别处正在编辑的字段覆盖掉。
 */
export function applyPreset(preset: WorldPreset): Partial<WorldProfile> {
    return { ...preset.patch };
}
