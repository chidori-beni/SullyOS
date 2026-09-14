import { describe, it, expect } from 'vitest';
import type { CharacterProfile, OSTheme } from '../types';
import {
    CHAT_APPEARANCE_KEYS, pickChatAppearance, resolveChatAppearance,
    splitAppearancePatch, hasChatAppearanceOverride,
} from './chatAppearanceOverride';
import { CHAT_FINE_TUNE_KEYS } from './chatFineTuneCss';

const theme = { chatChromeStyle: 'soft', chatHeaderStyle: 'default', wallpaper: '#fff' } as unknown as OSTheme;
const char = (patch: Partial<CharacterProfile>) => ({ id: 'c', name: '小夜', ...patch } as CharacterProfile);

describe('按角色覆盖聊天外观', () => {
    it('白名单正好 16 项，且跟 9 项微调零重叠（加起来才是界面上的 25 项）', () => {
        expect(CHAT_APPEARANCE_KEYS).toHaveLength(16);
        const overlap = CHAT_APPEARANCE_KEYS.filter(k => (CHAT_FINE_TUNE_KEYS as readonly string[]).includes(k));
        expect(overlap).toEqual([]);
    });

    it('开关关着时原样返回全局，而且是同一个对象（下游 useMemo 不白算）', () => {
        const result = resolveChatAppearance(theme, char({ chatAppearance: { chatChromeStyle: 'pixel' } }));
        expect(result).toBe(theme);
    });

    it('开关开着时角色的那几项盖过全局，没覆盖的仍跟随全局', () => {
        const result = resolveChatAppearance(theme, char({
            chatFineTune: { enabled: true }, chatAppearance: { chatChromeStyle: 'pixel' },
        }));
        expect(result.chatChromeStyle).toBe('pixel');
        expect(result.chatHeaderStyle).toBe('default');
    });

    it('白名单之外的 theme 字段一律进不来（坏角色卡改不了整机设置）', () => {
        const result = resolveChatAppearance(theme, char({
            chatFineTune: { enabled: true },
            chatAppearance: { wallpaper: 'evil.png', primaryHue: 9 } as Partial<OSTheme>,
        }));
        expect(result.wallpaper).toBe('#fff');
        expect((result as Record<string, unknown>).primaryHue).toBeUndefined();
    });

    it('取值不在候选里、或类型不对的，直接丢掉', () => {
        expect(pickChatAppearance({ chatChromeStyle: 'octopus' })).toEqual({});
        expect(pickChatAppearance({ chatChromeStyle: 7 })).toEqual({});
        expect(pickChatAppearance({ chatShowSendButton: 'yes' })).toEqual({});
        expect(pickChatAppearance({ chatShowSendButton: true })).toEqual({ chatShowSendButton: true });
    });

    it('本 fork 独有的那两个开关也能按角色定制', () => {
        expect(pickChatAppearance({ chatShowSendButton: true, chatShowVoiceButton: false }))
            .toEqual({ chatShowSendButton: true, chatShowVoiceButton: false });
    });

    it('不是对象 / 是 null / 是数组，都当空处理，不抛错', () => {
        for (const bad of [null, undefined, 'x', 42, [1, 2]]) expect(pickChatAppearance(bad)).toEqual({});
    });

    it('一次补丁能同时含两类字段，会被拆成两份（「快速预设」就是这种）', () => {
        const { appearance, fineTune } = splitAppearancePatch({
            chatChromeStyle: 'pixel', chatBubbleFontSize: 14, wallpaper: 'nope',
        } as Partial<OSTheme>);
        expect(appearance).toEqual({ chatChromeStyle: 'pixel' });
        expect(fineTune).toEqual({ chatBubbleFontSize: 14 });
    });

    it('「跟随全局 / 单独定制」沿用原来那一个开关，不另开一个', () => {
        expect(hasChatAppearanceOverride(char({}))).toBe(false);
        expect(hasChatAppearanceOverride(char({ chatFineTune: { enabled: false } }))).toBe(false);
        expect(hasChatAppearanceOverride(char({ chatFineTune: { enabled: true } }))).toBe(true);
    });
});
