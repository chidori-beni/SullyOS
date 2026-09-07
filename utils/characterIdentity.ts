/**
 * 双层角色世界 · 身份归属（见 `交接说明-双层角色世界.md`）。
 *
 * 解决的问题：SullyOS 只有一个 UserProfile（机主）。用户把 SillyTavern 里精心捏的
 * 一批 user 与 char **全部作为 CharacterProfile** 搬进来之后，酒馆 char 卡里的
 * `{{user}}` 本意指 ta 在酒馆配队的那个 user，却会被展开成机主的名字——
 * 而当机主与那个 user **同名**时（用户的真实情况：两边都叫「颜千夜」），
 * 这个错误在文本上完全看不出来，角色会静悄悄地把机主当成恋人。
 *
 * 这里只做**纯函数**：不碰 IndexedDB、不碰 React，方便直接跑测试。
 */

import type { CharacterProfile, UserProfile } from '../types';

/** 缺省语义：旧角色没有这些字段时，行为必须与改造前完全一致。 */
export const DEFAULT_HOST_RELATION = 'partner' as const;
export const DEFAULT_NARRATIVE_LAYER = 'real' as const;

export type HostRelation = NonNullable<CharacterProfile['hostRelation']>;
export type NarrativeLayer = NonNullable<CharacterProfile['narrativeLayer']>;

/** 角色与机主的关系；缺省 partner，保持旧角色现状。 */
export const hostRelationOf = (char?: Pick<CharacterProfile, 'hostRelation'> | null): HostRelation =>
    char?.hostRelation || DEFAULT_HOST_RELATION;

/** 角色所在叙事层；缺省 real，保持旧角色现状。 */
export const narrativeLayerOf = (char?: Pick<CharacterProfile, 'narrativeLayer'> | null): NarrativeLayer =>
    char?.narrativeLayer || DEFAULT_NARRATIVE_LAYER;

/** ta 认不认识机主。stranger 之外都算认识。 */
export const knowsHost = (char?: Pick<CharacterProfile, 'hostRelation'> | null): boolean =>
    hostRelationOf(char) !== 'stranger';

/**
 * `{{user}}` 在这个角色身上应该展开成谁的名字。
 *
 * - 缺省 / `{kind:'host'}` / `{kind:'unset'}` → 机主档案名（改造前的唯一行为）
 * - `{kind:'character'}`                     → 该 CharacterProfile 的名字（酒馆配队的 user）
 *
 * `unset`（导入时选「暂不指定」）之所以也回退机主：正文里的 `{{user}}` 此时尚未定稿，
 * 若用户始终没回来指定，行为必须与从前一致——**不允许存在"半成品状态"**。
 *
 * 取名优先级：角色表里的当前名字 → 落库冗余的 `target.name` → 机主。
 * `characters` 省略时（如 `ContextBuilder.buildCoreContext` 拿不到完整角色表）直接吃冗余名。
 * 指向的角色被删除、或指向自己形成自环时，**回退机主**并保持可用——
 * 宁可退回旧行为，也不要因为一个悬空 id 让整段提示词塌掉。
 */
export const resolveUserMacroName = (
    char: Pick<CharacterProfile, 'id' | 'userMacroTarget'> | null | undefined,
    userProfile: Pick<UserProfile, 'name'> | null | undefined,
    characters?: readonly Pick<CharacterProfile, 'id' | 'name'>[],
): string => {
    const hostName = (userProfile?.name || '').trim();
    const target = char?.userMacroTarget;
    if (!target || target.kind === 'host' || target.kind === 'unset') return hostName;
    // 自环：ta 的 {{user}} 指向 ta 自己，语义上无意义，按未设置处理
    if (char && target.id === char.id) return hostName;
    const live = characters?.find(c => c.id === target.id)?.name?.trim();
    return live || target.name?.trim() || hostName;
};

/** 正文里可能残留的宏：`{{char}}` / `{{user}}` / `<BOT>` / `<USER>`。 */
const BODY_MACRO_PROBE = /\{\{|<BOT>|<USER>/;

/**
 * 展开角色**正文**（描述 / 核心指令 / 世界观）里残留的 `{{user}}` `{{char}}`。
 *
 * 背景：从酒馆导入时，这些宏本来在那一刻就被烤进正文了。但**双向配队**有个死结——
 * 先导入的角色选不到还不存在的搭档，正文一旦烤死就再也改不回来。
 * 所以导入弹窗提供「暂不指定」：那一档**不展开** `{{user}}`，留到这里每次构建提示词时
 * 按 `userMacroTarget` 现场展开。于是之后在角色资料页改指向可以**反复改、立刻生效**，
 * 既不必存一份原文，也不用什么"兑现"动作。
 *
 * **对既有角色是纯空操作**：他们正文里的宏早在导入时就没了，探针一测即原样返回。
 * 世界书不走这里——它本来就保留宏，由 `expandWorldbookMacros` 负责。
 */
export const expandCharBodyMacros = (
    text: string | null | undefined,
    char: Pick<CharacterProfile, 'id' | 'name' | 'userMacroTarget'> | null | undefined,
    userProfile: Pick<UserProfile, 'name'> | null | undefined,
    characters?: readonly Pick<CharacterProfile, 'id' | 'name'>[],
): string => {
    const src = text || '';
    if (!src || !BODY_MACRO_PROBE.test(src)) return src;
    const charName = (char?.name || '').trim();
    const userName = resolveUserMacroName(char, userProfile, characters);
    let out = src;
    if (charName) out = out.replace(/\{\{\s*char\s*\}\}/gi, charName).replace(/<BOT>/g, charName);
    if (userName) out = out.replace(/\{\{\s*user\s*\}\}/gi, userName).replace(/<USER>/g, userName);
    return out;
};

/**
 * 私聊 / 见面 / 通话都必须回答的那个问题：**正在跟你说话的这个人，是谁？**
 *
 * 用户实测踩到的坑（2026-09-07）：给「游霄」设了 `{{user}}` = 凌葵羽、且「不认识机主」，
 * 结果私聊里他照样把机主当前任。原因是提示词里同时摆着两样东西却没有一句话把它们分开：
 *
 * ```
 * 卡片正文：你和「凌葵羽」是前任            ← 来自 userMacroTarget
 * 用户画像：颜千夜（机主档案）              ← 来自 UserProfile
 * ```
 *
 * 模型只能把两者合并成一个人——它没做错，是我们没说。
 * 这段就是那句缺失的话。
 *
 * **只陈述「是谁 / 不是谁」，绝不描述任何关系**（铁律 ①：配队 ≠ 恋人，
 * `{{user}}` 指向谁纯属身份归属，不蕴含亲密度）。关系标签仍由 `buildIdentityNote` 负责。
 *
 * 缺省角色（`partner` 且没指过 `userMacroTarget`）**返回空串**，旧角色零变化。
 */
export const buildChatPartnerNote = (
    char: Pick<CharacterProfile, 'hostRelation' | 'userMacroTarget'> | null | undefined,
    hostName: string | null | undefined,
    counterpartName?: string | null,
): string => {
    const host = (hostName || '').trim();
    const counterpart = (counterpartName || '').trim();
    const relation = hostRelationOf(char);
    // 指向机主本人 / 没指过时，卡里的 {{user}} 就是对面这位，无需区分。
    const needsSplit = !!counterpart && !!host && counterpart !== host
        && char?.userMacroTarget?.kind === 'character';
    if (relation === 'partner' && !needsSplit) return '';

    const lines: string[] = [];
    lines.push(host ? `- 对面是这台手机的机主「${host}」。` : '- 对面是这台手机的机主。');
    if (relation === 'stranger') {
        lines.push('- 你不认识 ta，此前从未与 ta 说过话。');
    } else if (relation === 'friend') {
        lines.push('- 你和 ta 是朋友，关系止于朋友。');
    }
    if (needsSplit) {
        lines.push(
            `- 你的设定里出现的「${counterpart}」是**另一个人**，不是对面这位。`
            + `不要把两人混为一谈，也不要把设定中对「${counterpart}」的称呼、往事与情绪套到对面这位身上。`
        );
    }
    return `【正在和你说话的人】\n${lines.join('\n')}`;
};

/**
 * 群聊提示词里那段「先认清 U」。
 *
 * 原文（`apps/GroupChat.tsx`）是写死的"群里的用户就是你一直在私聊的那个人"，
 * 对陪伴角色完全正确——防止角色在公开场合装作不认识机主。
 * 但对 `stranger`（搬进来的酒馆角色）是错的：会强制 ta 认领一段并不存在的关系。
 *
 * @param hostName 机主在群里的显示名，用于 stranger 文案里指代"那位"。
 */
export const buildGroupHostAwarenessLine = (
    char: Pick<CharacterProfile, 'hostRelation'> | null | undefined,
    hostName = '',
): string => {
    const who = hostName.trim() ? `「${hostName.trim()}」` : '群里那位机主';
    switch (hostRelationOf(char)) {
        case 'stranger':
            return `- **先认清 ${who}**：${who} 与你**没有任何关系**——你们没有私聊过，也没有共同记忆。`
                + `不要把 ta 当成熟人，不要表现出亲近、依赖或暧昧，也不要向 ta 解释你的私事。`
                + `就当群里有这么一个人在，你按自己的性格正常说话即可。`;
        case 'friend':
            return `- **先认清 ${who}**：你和 ${who} 是**朋友**，仅此而已。`
                + `可以熟络、可以开玩笑、可以关心，但**不要发展成亲密或暧昧关系**，也不要暗示你们之间有超出朋友的过去。`;
        case 'partner':
        default:
            return '- **先认清 U**：群聊里的用户，就是你一直在私聊、记忆和印象里认识的同一个人。'
                + '已经建立的关系、承诺和亲密程度继续成立；公开场合可以换一种表达方式，'
                + '但不能重置关系或突然把 U 当成普通陌生群友。';
    }
};

/**
 * 私聊 / 群聊之外的通用身份补充说明。返回空串表示"无需额外说明"——
 * 缺省角色一个字都不会多注入，保证旧行为零变化。
 */
export const buildIdentityNote = (
    char: Pick<CharacterProfile, 'hostRelation' | 'narrativeLayer'> | null | undefined,
    counterpart?: { name: string; label?: string },
): string => {
    const lines: string[] = [];
    if (hostRelationOf(char) === 'stranger') {
        lines.push('你不认识这台手机的机主，也从未与 ta 说过话。');
    } else if (hostRelationOf(char) === 'friend') {
        lines.push('你和这台手机的机主是朋友，关系止于朋友。');
    }
    // 「{{user}} 指向谁」纯粹是身份归属，**不蕴含任何关系**——配队的两人可能是恋人，
    // 也可能是死对头、刚认识、还在暧昧。所以只有用户**显式写了关系标签**才注入这一行，
    // 且原样引用标签，绝不替用户升格成「最重要的人」之类的说法。
    const name = counterpart?.name?.trim();
    const label = counterpart?.label?.trim();
    if (name && label) lines.push(`你和「${name}」的关系：${label}。`);
    return lines.join('\n');
};
