import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context';

/**
 * 锁住「正在和你说话的人」这段该出现在哪、不该出现在哪。
 *
 * 背景（2026-09-10 用户实测）：小镇里「远方」档表现得和「重度」一模一样。
 * 原因是这段被注进了小镇，和存在感档位正面打架：
 *
 * ```
 * 你不认识 ta，此前从未与 ta 说过话。          ← buildChatPartnerNote
 * 【模式：远方】ta 认识你……你们是网上认识的。   ← buildModeRule
 * ```
 *
 * 小镇本来也没有「对面」—— 家园 addendum 第一句就写着「这不是和 X 的聊天」。
 */

const HEADER = '【正在和你说话的人】';

const strangerChar = () => ({
    id: 'c1',
    name: '游霄',
    systemPrompt: '你是游霄。',
    hostRelation: 'stranger',
    userMacroTarget: { kind: 'character', id: 'u-partner', name: '凌葵羽' },
} as any);

const user = { name: '颜千夜', bio: '' } as any;

describe('buildChatPartnerNote 的注入边界', () => {
    it('1v1 私聊：注入，并点破机主与卡里的 {{user}} 不是同一人', () => {
        const core = ContextBuilder.buildCoreContext(strangerChar(), user, true);
        expect(core).toContain(HEADER);
        expect(core).toContain('颜千夜');
        expect(core).toContain('凌葵羽');
    });

    it('⛔ 小镇（skipChatPartnerNote）：整段不出现', () => {
        const core = ContextBuilder.buildCoreContext(
            strangerChar(), user, true, undefined, { skipChatPartnerNote: true },
        );
        expect(core).not.toContain(HEADER);
    });

    it('⛔ 小镇：连「你不认识 ta」这句都不能漏出去（否则顶掉存在感档位）', () => {
        const core = ContextBuilder.buildCoreContext(
            strangerChar(), user, true, undefined, { skipChatPartnerNote: true },
        );
        expect(core).not.toContain('你不认识 ta');
    });

    it('群聊：同样不注入（它有自己的「先认清 U」）', () => {
        const core = ContextBuilder.buildCoreContext(
            strangerChar(), user, true, undefined,
            { skipUserProfile: true, headerOverride: '[Group Member Profile: 游霄]' },
        );
        expect(core).not.toContain(HEADER);
    });

    it('缺省角色（partner 且没指过 userMacroTarget）：1v1 里也不注入，旧角色零变化', () => {
        const core = ContextBuilder.buildCoreContext(
            { id: 'c2', name: '萧逸', systemPrompt: '你是萧逸。' } as any, user, true,
        );
        expect(core).not.toContain(HEADER);
    });
});
