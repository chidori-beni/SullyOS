/**
 * 彼方「止于朋友」公约（阶段 2.7）。
 *
 * ## 这不是礼貌规则，是 CP 绑定在彼方的唯一防线
 *
 * 角色在彼方是**真的会记住彼此**的：进房间前系统把同场所有人的名字塞进记忆检索并特意加权
 * （`runSession.ts` 的 `recallNames`），`prompts.ts` 再接一句「记忆里有 ta → 按真实交情待之」。
 * 所以住在**不同小镇**、**各有配队对象**的两个角色，可以在镇子之外、
 * 用户完全没盯着的地方一次次碰面、累积记忆与好感，最后好上。
 *
 * 镇内关系有锁（2.2）、有历史回滚（2.3）、有全局镜像（2.4）；**彼方里此前零防护**。
 * 这是用户 B 那句「要是我不在的时候赤司和黄濑搞在一起怎么办」的**跨镇版本，且更隐蔽**
 * —— 镇里至少还会留下一条可回滚的关系名，彼方里是悄悄长出来的。
 *
 * ## 为什么要有例外，而且例外必须是「本来就认识」
 *
 * 一刀切「彼方里不许暧昧」会把**本来就是恋人**的两个角色在彼方演成生分的陌生人 ——
 * 那是比原问题更糟的 bug（用户的铁律是「别把我的角色写崩」）。
 * 所以规则的对象只能是「**在这里新认识的人**」。
 *
 * 判据用阶段 2.4 落下的 `charBonds`：ta 的全局关系里已经有这个人 = 本来就认识，放行；
 * 没有 = 在彼方新碰上的，止于朋友。**这是机械判定，不需要模型自己拿捏。**
 *
 * ## ⭐ 第二类例外：同住一个世界的人（2026-09-18 补）
 *
 * 上面那条判据**漏了一种「本来就认识」**：两个角色同住一个小镇。
 *
 * 公约的措辞本来就是「**在这游戏里认识的人**止于朋友」—— 而同镇的两个人
 * 天天在面包房碰面，**根本不是在这游戏里认识的**，公约压根不该管他们。
 * 判定实现时只看了 `charBonds`，漏了这一条。
 *
 * 这个漏洞在用户提出「想把各作品角色丢进同一个小镇看他们摩擦出火花」时暴露：
 * 他把角色放进同一个小镇这个动作本身就是在说「我要看你们相处」，
 * 结果彼方那边还在替他摁着。
 *
 * ⛔ **用户 B 的防线一点没动**：住在**不同**小镇的两个角色
 * （「赤司和黄濑」那个场景）确实是在彼方认识的 —— 照管不误。
 *
 * ⭐ 顺带补掉一个空窗期：`charBonds` 那条例外要求**写了关系名**，
 * 而关系名只在小镇演绎给出「重大转折」时才改。所以两个角色在镇里
 * 已经处出感情、但还没到转折的那一段时间里，彼方会在**最关键的时候踩刹车**。
 * 同镇例外把这段空窗一起填掉了。
 *
 * ## ⛔ 默认开，但必须可关
 *
 * 用户两人的偏好是「随心情切换」而非一次设定终身，且明确说过「有时候也会期待混乱的关系」。
 * 所以这是个随时能切的全局开关，不是建镇时定死的东西。默认开是因为它保护的是
 * 「用户辛苦绑好的 CP」——默认不开等于默认让它悄悄坏掉，而坏掉之后没有回滚入口。
 */

import type { CharacterProfile, WorldProfile } from '../../types';

export type VRPactMode =
    /** 彼方里**新认识**的人止于朋友；本来就有关系的照旧。默认。 */
    | 'friends_only'
    /** 不管，随他们去。 */
    | 'off';

export const VR_PACT_KEY = 'vr_pact_mode';
export const DEFAULT_VR_PACT_MODE: VRPactMode = 'friends_only';

export const readVRPactMode = (
    storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): VRPactMode => {
    try {
        return storage?.getItem(VR_PACT_KEY) === 'off' ? 'off' : DEFAULT_VR_PACT_MODE;
    } catch {
        // 隐私模式 / 禁了站点数据时读不出来 —— 按默认（保护）走，不要因为读不到就放开
        return DEFAULT_VR_PACT_MODE;
    }
};

export const saveVRPactMode = (
    mode: VRPactMode,
    storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): void => {
    try { storage?.setItem(VR_PACT_KEY, mode); } catch { /* 存不下就算了，下次仍按默认 */ }
};

/**
 * 和这个角色**同住一个世界**的所有角色 id（不含自己）。
 *
 * 纯函数：`worlds` 由调用方读好传进来（`DB.getWorlds()`），这里不碰 DB，才测得动。
 *
 * ⭐ 只要**至少共住一个**世界就算 —— 一个角色可以住在好几个小镇里，
 * 只要和对方在任何一个镇里是邻居，他们就不是「在彼方认识的」。
 */
export const townmateIdsOf = (
    charId: string,
    worlds: readonly Pick<WorldProfile, 'memberIds'>[] | null | undefined,
): Set<string> => {
    const out = new Set<string>();
    if (!charId || !worlds) return out;
    for (const w of worlds) {
        const ids = w?.memberIds;
        if (!Array.isArray(ids) || !ids.includes(charId)) continue;
        for (const id of ids) if (id && id !== charId) out.add(id);
    }
    return out;
};

/**
 * 公约那段提示词。`off` 或没人同场时返回空串（旧行为零变化）。
 *
 * ⛔ **只约束角色之间，绝不能扫到机主。** `peers` 传的永远是 `CharacterProfile[]`，
 * 机主不在里面 —— 文案里也写明了对象是「在这游戏里遇到的其他玩家」。
 * 一旦这句话把机主圈进去，用户的陪伴角色会当场变得客客气气，那是灾难。
 *
 * ⛔ **不解释为什么有这条规矩。** 不能写「因为你们各自有配队对象」「因为这是用户定的」——
 * 前者等于替角色认领一段 ta 未必知情的关系，后者直接把第四面墙拆了。
 * 就当成 ta 自己对这个游戏的态度来写。
 */
export const buildVRPactRule = (
    mode: VRPactMode,
    char: Pick<CharacterProfile, 'charBonds'> | null | undefined,
    peers: readonly Pick<CharacterProfile, 'id' | 'name'>[] | null | undefined,
    /**
     * 和这个角色同住一个世界的人（`townmateIdsOf` 的结果）。
     * 不传＝退回只看 `charBonds` 的旧行为，**老调用方零变化**。
     */
    townmates?: ReadonlySet<string> | null,
): string => {
    if (mode === 'off') return '';
    if (!peers || peers.length === 0) return '';

    const bonds = char?.charBonds || [];
    // 「本来就认识」= 全局关系里已经有这个人且写了关系名。
    // 只有 value 没有 label 的不算 —— 那说明还没处出一个说法来。
    const known = peers
        .filter(p => bonds.some(b => b.toId === p.id && (b.label || '').trim()))
        .map(p => (p.name || '').trim())
        .filter(Boolean);
    // 同镇的：**不是在这游戏里认识的**，公约管不到（见文件头「第二类例外」）。
    // ⛔ 已经进了 known 的不再重复列 —— 同一个名字出现在两句例外里会很怪。
    const knownIds = new Set(peers.filter(p => bonds.some(b => b.toId === p.id && (b.label || '').trim())).map(p => p.id));
    const neighbours = townmates
        ? peers
            .filter(p => !knownIds.has(p.id) && townmates.has(p.id))
            .map(p => (p.name || '').trim())
            .filter(Boolean)
        : [];

    const lines = [
        `⛔ 你对《彼方》有自己的一条底线：**在这游戏里认识的人，关系止于朋友。**`
        + `聊得来、一起玩、真心把对方当朋友，都没问题；`
        + `但**不往暧昧和恋爱上走**——不告白、不调情、不做超出朋友的亲近举动，`
        + `对方要是往那个方向试探，你会自然地把话岔开或明确拒绝。`,
        `这不是因为你冷淡，也不是谁规定的，就是你自己进这游戏时抱的态度：`
        + `这是个放松的地方，不是找对象的地方。`,
    ];
    if (known.length > 0) {
        lines.push(
            `· 例外是${known.join('、')}——你和 ta 们的关系本来就不止于此，`
            + `照你们本来的样子相处，**别因为这条底线跟熟人变生分**。`,
        );
    }
    if (neighbours.length > 0) {
        // ⛔ 措辞只做一件事：**把这些人移出「在这游戏里认识的」这个范围**。
        //    绝不能写成「你们可以发展关系」—— 那是替角色做决定，
        //    和阶段 3.3「写该发生的事，不写结局」同一条原则。
        lines.push(
            `· ${neighbours.join('、')}不是你在这儿认识的——你们本来就生活在同一个地方、平时就会碰面。`
            + `你们在外面是什么样，在这儿就还是什么样，这条底线管不到你们之间。`,
        );
    }
    return lines.join('\n');
};
