// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readBootPreference, rememberBootPreference } from './bootPreference';

// 用户报的 bug：关了开场动画、或选了「原版」，冷启动仍会闪一下紫色水母。
// 病根是 theme 要等 IndexedDB，PhoneShell 第一帧读到的是 undefined
// （被判成「开启」+「水母」）。这份镜像存在 localStorage 里，第一帧同步可读。

describe('bootPreference', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('没写过镜像时两个值都是 undefined —— 调用方退回原来的 theme 判定', () => {
        expect(readBootPreference()).toEqual({ enabled: undefined, style: undefined });
    });

    it('关掉开场动画后，下次第一帧就知道是关的', () => {
        rememberBootPreference({ bootAnimationEnabled: false });
        expect(readBootPreference().enabled).toBe(false);
    });

    it('开着开场动画时记 true（undefined 也按开启记，跟 theme 的 !== false 一致）', () => {
        rememberBootPreference({ bootAnimationEnabled: true });
        expect(readBootPreference().enabled).toBe(true);
        rememberBootPreference({});
        expect(readBootPreference().enabled).toBe(true);
    });

    it('选了原版后，下次第一帧就是原版，不会先闪水母', () => {
        rememberBootPreference({ bootAnimationStyle: 'classic' });
        expect(readBootPreference().style).toBe('classic');
    });

    it('选回水母也记得住', () => {
        rememberBootPreference({ bootAnimationStyle: 'jellyfish' });
        expect(readBootPreference().style).toBe('jellyfish');
    });

    it('风格被清空时删掉镜像，默认值重新交回 BootSequence 决定', () => {
        rememberBootPreference({ bootAnimationStyle: 'classic' });
        rememberBootPreference({});
        expect(readBootPreference().style).toBeUndefined();
    });

    it('镜像里是垃圾值时当作没写过，不会把未知风格喂给 BootSequence', () => {
        window.localStorage.setItem('sullyos_boot_animation_style', 'octopus');
        expect(readBootPreference().style).toBeUndefined();
    });

    it('localStorage 读不了（无痕模式等）时安静退回默认，不抛异常', () => {
        vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(() => readBootPreference()).not.toThrow();
        expect(readBootPreference()).toEqual({});
    });

    it('localStorage 写不了时也安静跳过，不影响启动', () => {
        vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => rememberBootPreference({ bootAnimationStyle: 'classic' })).not.toThrow();
    });
});
