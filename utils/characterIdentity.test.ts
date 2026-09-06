import { describe, expect, it } from 'vitest';
import {
    buildGroupHostAwarenessLine,
    buildIdentityNote,
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
    it('stranger + 配队对象', () => {
        const note = buildIdentityNote({ hostRelation: 'stranger' }, '颜千夜');
        expect(note).toContain('你不认识这台手机的机主');
        expect(note).toContain('「颜千夜」');
    });

    it('friend 只说到朋友为止', () => {
        expect(buildIdentityNote({ hostRelation: 'friend' })).toBe('你和这台手机的机主是朋友，关系止于朋友。');
    });

    it('partner 即使给了配队对象也只输出那一行，不谈与机主的关系', () => {
        expect(buildIdentityNote({ hostRelation: 'partner' }, '某某')).toBe('你生活里真正重要的那个人是「某某」。');
    });
});
