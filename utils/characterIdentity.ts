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

/**
 * 提议「升为朋友」的门槛：双方**各自**要达到的对话条数。
 *
 * 取 20 是因为它大约等于「聊过好几次」而不是「聊了一整晚」——
 * 目标是让关系「处出来」的那一刻显得自然，而不是刷一轮就弹。
 * 要调就改这里，判定逻辑不必动。
 */
export const FRIENDSHIP_SUGGEST_THRESHOLD = 20;

/** 计数需要看的消息形状（`Message` 的子集，方便直接喂测试假数据）。 */
export interface ExchangeLike {
    role?: string;
    type?: string;
    metadata?: {
        /** 机主侧：彼方留言簿/状态广播都带它 */
        userBoardPost?: boolean;
        /** 机主侧：**真的在留言墙上说了话**才有；只更新彼方状态时没有 */
        boardPost?: string;
        /**
         * 机主侧：这条广播是不是**冲着收件人本人**说的
         * （用户在留言墙精确回复了 ta 那条留言）。`VRWorldApp.onUserBoardPost` 落的。
         */
        boardDirectedAtMe?: boolean;
        /** 角色侧：ta 这次留言回的是谁（`runSession.ts` 落的 `boardReplyToName`） */
        boardReplyToName?: string;
        boardPosts?: { content?: string; replyToName?: string }[];
        [k: string]: unknown;
    } | null;
}

/** 一条消息在「你俩的来往」里算什么。`both` = 一条消息同时证明了两边。 */
export type ExchangeKind = 'host' | 'char' | 'both' | 'none';

/**
 * 这条消息在「你和 ta 之间的来往」里算什么。
 *
 * **两次修正的历史，别再改回去：**
 *
 * 1. 初版把角色侧的 `vr_card` 一刀切掉 → 「你在彼方跟 ta 一来一往，只算你那一半」，
 *    与用户心智完全相反（原话「在彼方聊得不错成为朋友了」）。
 * 2. 第二版让机主的留言墙发言直接计数 → 用户当即指出致命问题：
 *    **「我回复角色A，角色B那边也计数了怎么办？」**
 *    确实如此——`VRWorldApp.tsx:327` 把每条墙贴**群发给所有接入彼方的角色**，
 *    而且用户在留言簿**根本无法指定回复谁**（`onUserBoardPost(content)` 只收正文，
 *    只有角色会设 `replyToName`）。于是冲着 A 说的话，B 也白捡一条。
 *
 * **现在的规则：**
 *
 * | 消息 | 计入 |
 * |---|---|
 * | 私聊里机主说的话 | `host` |
 * | 私聊里角色的回复 | `char` |
 * | **角色在留言簿回了机主** | **`both`** —— 一条就同时证明了「你说过」和「ta 答了」 |
 * | **机主在彼方精确回复了 ta**（`boardDirectedAtMe`） | `host` —— 你确实在跟 ta 说话 |
 * | 机主的泛泛墙贴 / 彼方状态广播 | `none` —— 群发给所有人，**不能算成跟某一个人的来往** |
 * | 角色独自看书 / 小镇过日子 | `none` |
 *
 * 关键就是那条 `both`：**彼方的来往靠「ta 回了你」来认定，而不是靠「你说了话」。**
 * 于是「你发一百条墙贴没人理」时，谁的计数都不动——这正是用户要的。
 */
export const classifyExchange = (msg: ExchangeLike, hostName?: string): ExchangeKind => {
    const type = msg.type as string | undefined;
    const meta = msg.metadata || undefined;

    if (msg.role === 'user') {
        if (!meta?.userBoardPost) return 'host';
        // 彼方广播：**只有精确回复了这个角色**才算跟 ta 说话。
        // 泛泛的墙贴与状态更新会群发给所有接入角色，算了就等于「你回复 A，B 也白捡一条」。
        return meta.boardDirectedAtMe ? 'host' : 'none';
    }
    if (msg.role !== 'assistant') return 'none';

    if (type === 'world_card') return 'none';
    if (type === 'vr_card') {
        const host = (hostName || '').trim();
        if (!host) return 'none';
        if (meta?.boardReplyToName?.trim() === host) return 'both';
        return (meta?.boardPosts || []).some(p => p?.replyToName?.trim() === host) ? 'both' : 'none';
    }
    return 'char';
};

/** 这条消息是否构成任何一种来往。`hasHostExchange` 之类的粗判用它。 */
export const isMutualExchange = (msg: ExchangeLike, hostName?: string): boolean =>
    classifyExchange(msg, hostName) !== 'none';

export interface FriendshipSuggestion {
    /** 够不够熟——够了才提议，且**仅仅是提议** */
    ready: boolean;
    /** 机主发出的条数 */
    fromHost: number;
    /** 角色回应的条数（不含 ta 独自活动的卡片） */
    fromChar: number;
    threshold: number;
}

/**
 * 阶段 2.8：判断一个「不认识我」的角色，是否已经和机主处熟了。
 *
 * 起因是用户 2026-09-10 的一句话：
 * 「我以为在彼方会通过互动什么的渐渐认识，渐渐成为网友，原来是需要我提前设定的啊？」
 * —— 这个直觉比原设计更自然：**关系该处出来，而不是开局选好。**
 *
 * ⛔ **本函数只回答「够不够熟」，绝不改任何东西。**
 * `hostRelation` 是用户的角色设定，自动改它等于替用户改角色关系，
 * 直接踩「别把我的角色写崩」这条红线。真正的升级必须由用户点头（见 Character.tsx 的提议条）。
 *
 * 只对 `stranger` 有意义：
 * - `friend` / `partner` 本来就认识机主，没有可升的；
 * - `friend → partner` 属于恋爱线，归阶段 3.3 的好感阈值事件，**不要混进来**。
 *
 * 双方**各自**都要过门槛：单方面刷屏（你说了一百句 ta 没理你）不该算处熟了。
 */
export const evaluateFriendshipUpgrade = (
    char: Pick<CharacterProfile, 'hostRelation'> | null | undefined,
    messages: readonly ExchangeLike[] | null | undefined,
    /** 机主名——判断角色在留言簿回的是不是 ta 时要用。不传则角色侧的彼方往来不计入。 */
    hostName?: string,
    threshold: number = FRIENDSHIP_SUGGEST_THRESHOLD,
): FriendshipSuggestion => {
    const limit = Math.max(1, Math.floor(threshold));
    const empty: FriendshipSuggestion = { ready: false, fromHost: 0, fromChar: 0, threshold: limit };
    if (hostRelationOf(char) !== 'stranger') return empty;

    let fromHost = 0;
    let fromChar = 0;
    for (const msg of messages || []) {
        const kind = classifyExchange(msg, hostName);
        if (kind === 'host') fromHost++;
        else if (kind === 'char') fromChar++;
        else if (kind === 'both') { fromHost++; fromChar++; }
    }
    return { ready: fromHost >= limit && fromChar >= limit, fromHost, fromChar, threshold: limit };
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
 * 另外承担两件事：**「陌生但聊过」这一档**（别再说「从未说过话」），
 * 以及**相识经过**（`char.acquaintance`，角色自己知道你们是在哪认识的）。
 *
 * **只陈述「是谁 / 不是谁」，绝不描述任何关系**（铁律 ①：配队 ≠ 恋人，
 * `{{user}}` 指向谁纯属身份归属，不蕴含亲密度）。关系标签仍由 `buildIdentityNote` 负责。
 *
 * 缺省角色（`partner` 且没指过 `userMacroTarget`）**返回空串**，旧角色零变化。
 */
export const buildChatPartnerNote = (
    char: Pick<CharacterProfile, 'hostRelation' | 'userMacroTarget' | 'acquaintance'> | null | undefined,
    hostName: string | null | undefined,
    counterpartName?: string | null,
    /** 你们是否已经来回聊过（由 evaluateFriendshipUpgrade 的计数判定）。见下方 stranger 分支。 */
    hasExchanged: boolean = false,
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
        // ⚠️ 「不认识」与「没说过话」是两件事，早先焊死在一句里 —— 于是聊了几十轮之后
        // 提示词还在说「此前从未与 ta 说过话」，那句已经是**假的**，
        // 而且每轮都在把角色对机主的印象清零（用户 2026-09-10 问「ta 会渐渐产生印象吗」，
        // 答案原本是「不会，就是被这句堵死的」）。
        lines.push(hasExchanged
            ? '- 你原本不认识 ta。但你们已经来回聊过一阵子了——ta 现在算是个聊得来的陌生人，不再是完全的路人；该有的熟悉感和分寸感都可以自然带出来。'
            : '- 你不认识 ta，此前从未与 ta 说过话。');
    } else if (relation === 'friend') {
        lines.push('- 你和 ta 是朋友，关系止于朋友。');
    }
    // 相识经过：用户在「身份归属」里确立关系时落下的，角色自己的来历认知。
    const where = char?.acquaintance?.where?.trim();
    if (where && relation !== 'stranger') {
        lines.push(`- 你们是在${where}认识的，后来才加上联系方式、能私下说话。这段经过你记得。`);
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
 * 阶段 2.1：把「你和机主之间」的两栏铺成提示词。
 *
 * **两栏的注入方式刻意不同**（用户 2026-09-11 选定）：
 *
 * | 栏 | 怎么注入 |
 * |---|---|
 * | `toHost`（ta 怎么看机主） | 直接告诉 ta —— 那是 ta 自己的内心 |
 * | `fromHost`（机主怎么看 ta） | **不当作 ta 知道的事**，而是「写到机主时的分寸」 |
 *
 * 为什么 `fromHost` 不能直说：告诉角色「机主只当你是朋友」，
 * **暗恋 / 单相思当场就塌了** —— ta 会知道自己没戏，那出戏就没了。
 * 改成叙述约束之后，效果是：角色可以照样偷偷喜欢，
 * 但演绎里机主不会回应超过机主自己写的那个程度。
 *
 * 缺省（两栏都空）返回空串，旧角色零变化。
 */
export const buildHostBondNote = (
    char: Pick<CharacterProfile, 'hostBond'> | null | undefined,
    hostName?: string | null,
): string => {
    const toHost = char?.hostBond?.toHost?.trim();
    const fromHost = char?.hostBond?.fromHost?.trim();
    if (!toHost && !fromHost) return '';
    const host = (hostName || '').trim() || '机主';

    const lines: string[] = [];
    if (toHost) lines.push(`- 你心里怎么看这段关系：${toHost}`);
    if (fromHost) {
        lines.push(
            `- ⚠️ 写到${host}时的分寸：ta 对你的言行**止于「${fromHost}」**。`
            + `不要让 ta 表现得比这更亲近，也不要替 ta 认定心意。`
            + `（你自己单方面怎么想不受这条限制。）`
        );
    }
    return `【你和${host}之间】\n${lines.join('\n')}`;
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
