import { describe, it, expect, vi } from 'vitest';
import { chatCharacterDisplayName, chatDisplayNameById, setChatDisplayNames } from './characterRemark';
import { emitMessagePreview, MESSAGE_PREVIEW_EVENT } from './messagePreview';

describe('线上显示备注（本 fork）', () => {
    it('填了备注显示备注，真名不动', () => {
        const character = { name: '萧逸', chatNickname: 'XY_' };
        expect(chatCharacterDisplayName(character)).toBe('XY_');
        expect(character.name).toBe('萧逸');
    });
    it('没填或只有空格就显示真名', () => {
        for (const chatNickname of [undefined, '', '   ']) {
            expect(chatCharacterDisplayName({ name: '萧逸', chatNickname })).toBe('萧逸');
        }
    });
    it('横幅按 charId 换成备注；认不出的角色用原名', () => {
        setChatDisplayNames([{ id: 'c1', name: '萧逸', chatNickname: 'XY_' }, { id: 'c2', name: '沈星回' }]);
        expect(chatDisplayNameById('c1', '萧逸')).toBe('XY_');
        expect(chatDisplayNameById('c2', '沈星回')).toBe('沈星回');
        expect(chatDisplayNameById('nobody', '旧名字')).toBe('旧名字');
        vi.stubGlobal('window', new EventTarget());
        const seen: string[] = [];
        const listener = (e: Event) => seen.push((e as CustomEvent).detail.charName);
        window.addEventListener(MESSAGE_PREVIEW_EVENT, listener);
        emitMessagePreview({ charId: 'c1', charName: '萧逸', body: '在吗' });
        window.removeEventListener(MESSAGE_PREVIEW_EVENT, listener);
        expect(seen).toEqual(['XY_']);
        vi.unstubAllGlobals();
    });
});
