import { describe, it, expect } from 'vitest';
import { isMessageSemanticallyRelevant } from './messageFormat';

/**
 * 锁住「只给用户看的提示」（`UiNoticeMeta`）不会漏进角色那边。
 *
 * 用户 2026-09-11 的要求：角色偷偷更新对你的印象，聊天里留一条提示，
 * **但这句系统提示不注入角色记忆**。
 *
 * 漏掉任一排除点，角色就会读到「系统说我对你改观了」——
 * 比让 ta 直接在台词里演还糟。
 */
const notice = (content = '游霄 对你们这段关系的看法变了') => ({
    id: 1, charId: 'c1', role: 'system', type: 'text', content, timestamp: 0,
    metadata: { uiNotice: true, noticeKind: 'bond_changed' },
} as any);

describe('UI-only 提示的排除守卫', () => {
    it('⛔⭐ 不进记忆管线', () => {
        expect(isMessageSemanticallyRelevant(notice())).toBe(false);
    });

    it('⛔ 有正文也照样不进 —— 不是靠"没内容"挡住的', () => {
        expect(isMessageSemanticallyRelevant(notice('一段很长的、看起来很有语义的正文'))).toBe(false);
    });

    it('✅ 普通系统消息不受影响（相识记录那种要进记忆）', () => {
        const normal = {
            id: 2, charId: 'c1', role: 'system', type: 'text',
            content: '你和游霄是在彼方的留言簿认识的。', timestamp: 0,
        } as any;
        expect(isMessageSemanticallyRelevant(normal)).toBe(true);
    });
});
