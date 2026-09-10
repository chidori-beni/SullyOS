import { describe, expect, it } from 'vitest';
import {
    buildChatPartnerNote,
    evaluateFriendshipUpgrade,
    FRIENDSHIP_SUGGEST_THRESHOLD,
    buildGroupHostAwarenessLine,
    buildIdentityNote,
    expandCharBodyMacros,
    hostRelationOf,
    knowsHost,
    narrativeLayerOf,
    resolveUserMacroName,
} from './characterIdentity';

const host = { name: '颜千夜' };

describe('缺省语义（旧角色行为必须零变化）', () => {
    it('没有字段时按 partner / real 处理', () => {
        expect(hostRelationOf(undefined)).toBe('partner');
        expect(hostRelationOf({})).toBe('partner');
        expect(narrativeLayerOf({})).toBe('real');
        expect(knowsHost({})).toBe(true);
    });

    it('没有 userMacroTarget 时 {{user}} 仍展开成机主', () => {
        expect(resolveUserMacroName({ id: 'c1' }, host, [])).toBe('颜千夜');
    });

    it('缺省角色的群聊「先认清 U」与改造前逐字一致', () => {
        expect(buildGroupHostAwarenessLine({}, '颜千夜')).toBe(
            '- **先认清 U**：群聊里的用户，就是你一直在私聊、记忆和印象里认识的同一个人。'
            + '已经建立的关系、承诺和亲密程度继续成立；公开场合可以换一种表达方式，'
            + '但不能重置关系或突然把 U 当成普通陌生群友。'
        );
    });

    it('缺省角色不会被多注入任何身份说明', () => {
        expect(buildIdentityNote({})).toBe('');
    });
});

describe('叙事层与「认不认识机主」互相独立', () => {
    // 四种组合都必须成立：把两者绑死（stranger→fiction、其余→real）会漏掉另外两格。
    it('认识机主 + 同处现实层：朋友 / 死对头 / 我女儿', () => {
        const c = { hostRelation: 'friend' as const, narrativeLayer: 'real' as const };
        expect(hostRelationOf(c)).toBe('friend');
        expect(narrativeLayerOf(c)).toBe('real');
        expect(knowsHost(c)).toBe(true);
    });

    it('不认识机主 + 仍在现实层：真实层里还没搭过话的人', () => {
        const c = { hostRelation: 'stranger' as const, narrativeLayer: 'real' as const };
        expect(narrativeLayerOf(c)).toBe('real');
        expect(knowsHost(c)).toBe(false);
    });

    it('认识机主 + 被创作：在剧场里和机主打过照面的角色', () => {
        const c = { hostRelation: 'friend' as const, narrativeLayer: 'fiction' as const };
        expect(narrativeLayerOf(c)).toBe('fiction');
        expect(knowsHost(c)).toBe(true);
    });

    it('不认识机主 + 被创作：从酒馆搬来过日子的角色', () => {
        const c = { hostRelation: 'stranger' as const, narrativeLayer: 'fiction' as const };
        expect(narrativeLayerOf(c)).toBe('fiction');
        expect(knowsHost(c)).toBe(false);
    });

    it('两个读取函数互不影响：只给其中一个字段时，另一个仍回落各自的缺省', () => {
        expect(narrativeLayerOf({ hostRelation: 'stranger' } as any)).toBe('real');
        expect(hostRelationOf({ narrativeLayer: 'fiction' } as any)).toBe('partner');
    });
});

describe('resolveUserMacroName —— 同名雷', () => {
    // 用户的真实处境：机主叫颜千夜，导入的酒馆 user 也叫颜千夜。
    const tavernQianye = { id: 'c-tavern-qianye', name: '颜千夜' };
    const tavernXiaoyi = {
        id: 'c-tavern-xiaoyi',
        userMacroTarget: { kind: 'character' as const, id: 'c-tavern-qianye' },
    };

    it('指向配队角色时展开成那个角色的名字，而不是机主', () => {
        // 名字碰巧相同，但语义已经归位——这正是同名让 bug 隐蔽的地方
        expect(resolveUserMacroName(tavernXiaoyi, host, [tavernQianye])).toBe('颜千夜');
    });

    it('配队角色改名后跟着走（证明取的确实是角色而非机主）', () => {
        const renamed = [{ id: 'c-tavern-qianye', name: '千夜（酒馆）' }];
        expect(resolveUserMacroName(tavernXiaoyi, host, renamed)).toBe('千夜（酒馆）');
    });

    it('显式 host 就是机主', () => {
        expect(resolveUserMacroName(
            { id: 'c1', userMacroTarget: { kind: 'host' } }, host, [tavernQianye],
        )).toBe('颜千夜');
    });

    it('指向已删除的角色时回退机主，不让提示词塌掉', () => {
        expect(resolveUserMacroName(tavernXiaoyi, host, [])).toBe('颜千夜');
    });

    it('自环（指向自己）按未设置处理', () => {
        const selfRef = { id: 'c1', userMacroTarget: { kind: 'character' as const, id: 'c1' } };
        expect(resolveUserMacroName(selfRef, host, [{ id: 'c1', name: '某某' }])).toBe('颜千夜');
    });

    it('机主没填名字时返回空串，交给调用方决定怎么兜底', () => {
        expect(resolveUserMacroName({ id: 'c1' }, { name: '' }, [])).toBe('');
    });
});

describe('buildGroupHostAwarenessLine —— 群聊硬编码分支', () => {
    it('stranger 明确切断关系，且不含原文里的「继续成立」', () => {
        const line = buildGroupHostAwarenessLine({ hostRelation: 'stranger' }, '颜千夜');
        expect(line).toContain('没有任何关系');
        expect(line).toContain('不要表现出亲近、依赖或暧昧');
        expect(line).not.toContain('继续成立');
    });

    it('friend 允许熟络但堵死暧昧', () => {
        const line = buildGroupHostAwarenessLine({ hostRelation: 'friend' }, '颜千夜');
        expect(line).toContain('朋友');
        expect(line).toContain('不要发展成亲密或暧昧关系');
    });

    it('没有机主名字时用中性指代，不产生空书名号', () => {
        const line = buildGroupHostAwarenessLine({ hostRelation: 'stranger' }, '');
        expect(line).toContain('群里那位机主');
        expect(line).not.toContain('「」');
    });
});

describe('buildIdentityNote', () => {
    it('stranger 切断与机主的关系', () => {
        expect(buildIdentityNote({ hostRelation: 'stranger' })).toBe('你不认识这台手机的机主，也从未与 ta 说过话。');
    });

    it('friend 只说到朋友为止', () => {
        expect(buildIdentityNote({ hostRelation: 'friend' })).toBe('你和这台手机的机主是朋友，关系止于朋友。');
    });

    // ── 「配队 ≠ 恋人」：{{user}} 指向谁只是身份归属，不蕴含任何关系 ──
    it('只给名字、没给关系标签时，一个字都不许提两人的关系', () => {
        const note = buildIdentityNote({ hostRelation: 'stranger' }, { name: '颜千夜' });
        expect(note).toBe('你不认识这台手机的机主，也从未与 ta 说过话。');
        expect(note).not.toContain('颜千夜');
    });

    it('绝不把配队升格成恋爱措辞', () => {
        const note = buildIdentityNote({ hostRelation: 'stranger' }, { name: '颜千夜' });
        for (const word of ['重要的人', '恋人', '喜欢', '爱', '伴侣', '在乎']) {
            expect(note).not.toContain(word);
        }
    });

    it('给了标签就原样引用——死对头不会被写成恋人', () => {
        expect(buildIdentityNote({ hostRelation: 'stranger' }, { name: '某某', label: '死对头' }))
            .toContain('你和「某某」的关系：死对头。');
    });

    it('暧昧期、刚认识这类未定关系同样原样保留', () => {
        expect(buildIdentityNote({}, { name: '某某', label: '还在暧昧，谁都没先开口' }))
            .toBe('你和「某某」的关系：还在暧昧，谁都没先开口。');
    });

    it('partner 且无标签时输出空串，不多注入任何东西', () => {
        expect(buildIdentityNote({ hostRelation: 'partner' }, { name: '某某' })).toBe('');
    });
});


describe('userMacroTarget: unset —— 「暂不指定」这一档', () => {
    it('解析上等同机主：用户忘了回来设，行为也和从前一样', () => {
        expect(resolveUserMacroName({ id: 'c1', userMacroTarget: { kind: 'unset' } }, host, [])).toBe('颜千夜');
    });

    it('机主没名字时回空串，不会吐出 undefined', () => {
        expect(resolveUserMacroName({ id: 'c1', userMacroTarget: { kind: 'unset' } }, null, [])).toBe('');
    });
});

describe('expandCharBodyMacros —— 正文里残留的宏', () => {
    const partner = { id: 'u-tavern', name: '倾川' };

    it('既有角色（正文无宏）原样返回，是纯空操作', () => {
        const text = '他是个沉默寡言的剑客，习惯在雨天擦刀。';
        expect(expandCharBodyMacros(text, { id: 'c1', name: '萧逸' }, host, [])).toBe(text);
    });

    it('unset + 未指定 → 展开成机主，不把 {{user}} 字面量漏给模型', () => {
        expect(expandCharBodyMacros(
            '你和 {{user}} 是青梅竹马。',
            { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'unset' } },
            host, [],
        )).toBe('你和 颜千夜 是青梅竹马。');
    });

    it('unset + 之后指向搭档 → 展开成搭档的名字（双向配队补齐）', () => {
        expect(expandCharBodyMacros(
            '你和 {{user}} 是青梅竹马。',
            { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'character', id: 'u-tavern', name: '倾川' } },
            host, [partner],
        )).toBe('你和 倾川 是青梅竹马。');
    });

    it('同一段文本改指向即变，可反复改（不必存原文、不必"兑现"）', () => {
        const body = '{{char}} 深爱着 {{user}}。';
        const asHost = expandCharBodyMacros(body, { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'unset' } }, host, [partner]);
        const asPartner = expandCharBodyMacros(body, { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'character', id: 'u-tavern' } }, host, [partner]);
        expect(asHost).toBe('萧逸 深爱着 颜千夜。');
        expect(asPartner).toBe('萧逸 深爱着 倾川。');
    });

    it('{{char}} 与大小写 / 空格变体都认', () => {
        expect(expandCharBodyMacros(
            '{{ Char }} 对 {{ USER }} 说：',
            { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'character', id: 'u-tavern' } },
            host, [partner],
        )).toBe('萧逸 对 倾川 说：');
    });

    it('认识 <BOT> / <USER> 这套旧式宏', () => {
        expect(expandCharBodyMacros(
            '<BOT> 看着 <USER>。',
            { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'character', id: 'u-tavern' } },
            host, [partner],
        )).toBe('萧逸 看着 倾川。');
    });

    it('指向的角色被删 → 回退机主，不让悬空 id 把提示词搞塌', () => {
        expect(expandCharBodyMacros(
            '{{user}} 来了。',
            { id: 'c1', name: '萧逸', userMacroTarget: { kind: 'character', id: 'gone' } },
            host, [],
        )).toBe('颜千夜 来了。');
    });

    it('空 / null / undefined 输入回空串', () => {
        const c = { id: 'c1', name: '萧逸' };
        expect(expandCharBodyMacros(undefined, c, host, [])).toBe('');
        expect(expandCharBodyMacros(null, c, host, [])).toBe('');
        expect(expandCharBodyMacros('', c, host, [])).toBe('');
    });
});


describe('buildChatPartnerNote —— 私聊里「对面这位是谁」', () => {
    const toPartner = { kind: 'character', id: 'u1', name: '凌葵羽' } as const;

    it('缺省角色输出空串，旧角色零变化', () => {
        expect(buildChatPartnerNote({}, '颜千夜', '颜千夜')).toBe('');
        expect(buildChatPartnerNote({ hostRelation: 'partner' }, '颜千夜', '颜千夜')).toBe('');
        expect(buildChatPartnerNote(undefined, '颜千夜', '颜千夜')).toBe('');
    });

    it('⭐ 用户实测那个坑：stranger + {{user}} 指向别人 → 必须点破两人不是同一个', () => {
        const note = buildChatPartnerNote(
            { hostRelation: 'stranger', userMacroTarget: toPartner },
            '颜千夜', '凌葵羽',
        );
        expect(note).toContain('对面是这台手机的机主「颜千夜」');
        expect(note).toContain('你不认识 ta');
        expect(note).toContain('「凌葵羽」是**另一个人**，不是对面这位');
    });

    it('friend 说到朋友为止，同样会点破身份', () => {
        const note = buildChatPartnerNote(
            { hostRelation: 'friend', userMacroTarget: toPartner },
            '颜千夜', '凌葵羽',
        );
        expect(note).toContain('你和 ta 是朋友，关系止于朋友');
        expect(note).toContain('「凌葵羽」是**另一个人**');
    });

    it('{{user}} 指向机主本人时不做区分（本来就是同一个人）', () => {
        expect(buildChatPartnerNote(
            { hostRelation: 'stranger', userMacroTarget: { kind: 'host' } },
            '颜千夜', '颜千夜',
        )).not.toContain('另一个人');
    });

    it('同名时也不硬造区分——两个名字一样就没什么可分的', () => {
        expect(buildChatPartnerNote(
            { hostRelation: 'stranger', userMacroTarget: { kind: 'character', id: 'u1', name: '颜千夜' } },
            '颜千夜', '颜千夜',
        )).not.toContain('另一个人');
    });

    it('⛔ 铁律①：只说是谁/不是谁，一个关系词都不许出现', () => {
        const note = buildChatPartnerNote(
            { hostRelation: 'stranger', userMacroTarget: toPartner },
            '颜千夜', '凌葵羽',
        );
        for (const word of ['恋人', '喜欢', '爱', '伴侣', '在乎', '重要的人', '前任', '暧昧']) {
            expect(note).not.toContain(word);
        }
    });

    it('机主没名字时也不崩，只是说得笼统些', () => {
        const note = buildChatPartnerNote({ hostRelation: 'stranger' }, '', '');
        expect(note).toContain('对面是这台手机的机主。');
        expect(note).toContain('你不认识 ta');
    });
});


describe('evaluateFriendshipUpgrade —— 关系「处出来」（阶段 2.8）', () => {
    const stranger = { hostRelation: 'stranger' } as const;
    const N = FRIENDSHIP_SUGGEST_THRESHOLD;
    /** n 条机主消息 + m 条角色对话消息 */
    const talk = (n: number, m: number) => [
        ...Array.from({ length: n }, () => ({ role: 'user', type: 'text' })),
        ...Array.from({ length: m }, () => ({ role: 'assistant', type: 'text' })),
    ];

    it('双方都过门槛才提议', () => {
        expect(evaluateFriendshipUpgrade(stranger, talk(N, N)).ready).toBe(true);
    });

    it('⛔ 单方面刷屏不算处熟——你说了一百句 ta 没理你', () => {
        const r = evaluateFriendshipUpgrade(stranger, talk(100, 0));
        expect(r.ready).toBe(false);
        expect(r.fromHost).toBe(100);
        expect(r.fromChar).toBe(0);
    });

    it('差一条都不提议', () => {
        expect(evaluateFriendshipUpgrade(stranger, talk(N, N - 1)).ready).toBe(false);
        expect(evaluateFriendshipUpgrade(stranger, talk(N - 1, N)).ready).toBe(false);
    });

    it('⛔ 只对「不认识我」有意义——朋友/陪伴没有可升的', () => {
        expect(evaluateFriendshipUpgrade({ hostRelation: 'friend' }, talk(99, 99)).ready).toBe(false);
        expect(evaluateFriendshipUpgrade({ hostRelation: 'partner' }, talk(99, 99)).ready).toBe(false);
        // 缺省即 partner，旧角色不会冒出提议
        expect(evaluateFriendshipUpgrade({}, talk(99, 99)).ready).toBe(false);
    });

    // ── 彼方：一来一往要**两边都算**（2026-09-10 按用户反馈重写） ──
    const HOST = '颜千夜';
    /** 机主在留言墙真发了话 */
    const boardSay = () => ({ role: 'user', type: 'vr_card', metadata: { userBoardPost: true, boardPost: '在吗' } });
    /** 机主只是广播「我现在在健身房」——群发给每个角色，不是在跟谁说话 */
    const boardStatus = () => ({ role: 'user', type: 'vr_card', metadata: { userBoardPost: true, activity: '在健身房挂机' } });
    /** 角色在留言簿回了机主 */
    const boardReply = () => ({ role: 'assistant', type: 'vr_card', metadata: { room: 'guestbook', boardReplyToName: HOST, boardPosts: [{ content: '在', replyToName: HOST }] } });
    /** 角色自己在彼方看书 */
    const alone = () => ({ role: 'assistant', type: 'vr_card', metadata: { room: 'library' } });

    it('⭐ 彼方来往由「ta 回了你」认定，一条同时算双方', () => {
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: N }, boardReply), HOST);
        expect(r.fromHost).toBe(N);
        expect(r.fromChar).toBe(N);
        expect(r.ready).toBe(true);
    });

    it('⭐ 你在彼方精确回复了 ta → 算你跟 ta 说话', () => {
        const directed = () => ({ role: 'user', type: 'vr_card', metadata: { userBoardPost: true, boardPost: '在吗', boardDirectedAtMe: true } });
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: N }, directed), HOST);
        expect(r.fromHost).toBe(N);
    });

    it('⛔⭐ 你回复的是别人，这个角色不能白捡（广播仍会发给 ta）', () => {
        const toOther = () => ({ role: 'user', type: 'vr_card', metadata: { userBoardPost: true, boardPost: '在吗', boardDirectedAtMe: false } });
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: 99 }, toOther), HOST);
        expect(r.fromHost).toBe(0);
    });

    it('⛔⭐ 没指定回复谁的泛墙贴不计数', () => {
        // 用户 2026-09-10 原话：「我回复角色A，角色B那边也计数了怎么办？」
        // 留言簿里用户根本无法指定回复谁（onUserBoardPost 只收正文），所以只能这样解。
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: 99 }, boardSay), HOST);
        expect(r.fromHost).toBe(0);
        expect(r.fromChar).toBe(0);
    });

    it('⛔ 发一百条墙贴没人理 → 谁的计数都不动', () => {
        const msgs = [...Array.from({ length: 99 }, boardSay), ...Array.from({ length: 99 }, alone)];
        const r = evaluateFriendshipUpgrade(stranger, msgs, HOST);
        expect(r.ready).toBe(false);
        expect(r.fromHost + r.fromChar).toBe(0);
    });

    it('⛔ 状态广播不算——它同样群发给每个接入角色', () => {
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: 99 }, boardStatus), HOST);
        expect(r.fromHost).toBe(0);
    });

    it('⛔ 「ta 独自度过的时间」不算——在彼方看书、在小镇过日子都不是在跟你来往', () => {
        const msgs = [
            ...Array.from({ length: N }, () => ({ role: 'user', type: 'text' })),
            ...Array.from({ length: 99 }, alone),
            ...Array.from({ length: 99 }, () => ({ role: 'assistant', type: 'world_card' })),
        ];
        const r = evaluateFriendshipUpgrade(stranger, msgs, HOST);
        expect(r.fromChar).toBe(0);
        expect(r.ready).toBe(false);
    });

    it('⛔ 角色在留言簿回的是别人，不算回你', () => {
        const toOther = { role: 'assistant', type: 'vr_card', metadata: { room: 'guestbook', boardReplyToName: '别人', boardPosts: [{ content: 'hi', replyToName: '别人' }] } };
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: 99 }, () => toOther), HOST);
        expect(r.fromChar).toBe(0);
    });

    it('不传机主名时，角色侧的彼方往来保守地不计入', () => {
        const r = evaluateFriendshipUpgrade(stranger, Array.from({ length: 99 }, boardReply));
        expect(r.fromChar).toBe(0);
    });

    it('空 / null 输入不崩', () => {
        expect(evaluateFriendshipUpgrade(stranger, []).ready).toBe(false);
        expect(evaluateFriendshipUpgrade(stranger, null).ready).toBe(false);
        expect(evaluateFriendshipUpgrade(null, talk(99, 99)).ready).toBe(false);
    });

    it('门槛可调，判定逻辑不变', () => {
        expect(evaluateFriendshipUpgrade(stranger, talk(3, 3), '', 3).ready).toBe(true);
        expect(evaluateFriendshipUpgrade(stranger, talk(3, 2), '', 3).ready).toBe(false);
    });
});


describe('陌生但聊过 / 相识经过（阶段 2.8）', () => {
    const stranger = { hostRelation: 'stranger' } as const;

    it('⛔ 没聊过：维持原话「此前从未与 ta 说过话」', () => {
        expect(buildChatPartnerNote(stranger, '颜千夜', '', false))
            .toContain('此前从未与 ta 说过话');
    });

    it('⭐ 聊过之后不许再说「从未说过话」——那句已经是假的，还会把印象一遍遍清零', () => {
        const note = buildChatPartnerNote(stranger, '颜千夜', '', true);
        expect(note).not.toContain('从未与 ta 说过话');
        expect(note).toContain('聊得来的陌生人');
    });

    it('相识经过会告诉角色，且明说「这段经过你记得」', () => {
        const note = buildChatPartnerNote(
            { hostRelation: 'friend', acquaintance: { at: 1, where: '彼方的留言簿' } } as any,
            '颜千夜', '', true,
        );
        expect(note).toContain('你们是在彼方的留言簿认识的');
        expect(note).toContain('这段经过你记得');
    });

    it('⛔ 还是陌生人时不提相识经过——没确立就没有这回事', () => {
        const note = buildChatPartnerNote(
            { hostRelation: 'stranger', acquaintance: { at: 1, where: '彼方' } } as any,
            '颜千夜', '', true,
        );
        expect(note).not.toContain('认识的');
    });

    it('⛔ 铁律①仍然成立：相识经过里不许冒出关系词', () => {
        const note = buildChatPartnerNote(
            { hostRelation: 'friend', acquaintance: { at: 1, where: '彼方' } } as any,
            '颜千夜', '', true,
        );
        for (const w of ['恋人', '喜欢', '爱', '伴侣', '在乎', '重要的人']) {
            expect(note).not.toContain(w);
        }
    });
});
