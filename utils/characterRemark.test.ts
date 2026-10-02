import { describe, it, expect } from 'vitest';
import { chatCharacterDisplayName } from './characterRemark';

describe('线上聊天显示网名（本 fork）', () => {
    it('填了网名显示网名，真名不动', () => {
        const character = { name: '萧逸', chatNickname: 'XY_' };
        expect(chatCharacterDisplayName(character)).toBe('XY_');
        expect(character.name).toBe('萧逸');
    });
    it('没填或只有空格就显示真名', () => {
        for (const chatNickname of [undefined, '', '   ']) {
            expect(chatCharacterDisplayName({ name: '萧逸', chatNickname })).toBe('萧逸');
        }
    });
});
