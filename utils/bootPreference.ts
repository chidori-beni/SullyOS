/**
 * 开场偏好的「同步副本」。
 *
 * 为什么需要这份副本：开机动画的**开关**和**风格**都存在 theme 里，而 theme 要等
 * IndexedDB 读完才有。PhoneShell 的第一帧拿到的是空 theme——
 * `bootAnimationEnabled` 是 undefined（`!== false` 判成「开启」）、
 * `bootAnimationStyle` 也是 undefined（BootSequence 判成「水母」），
 * 于是**不管用户关没关、选没选原版，每次冷启动都会先闪一帧水母**，
 * 等数据到了才纠正。用户报的「一闪而过的紫色水母」就是这个。
 *
 * localStorage 是同步的，第一帧就读得到。所以 theme 就绪后把这两个值镜像一份进去，
 * 下次启动直接按镜像决定。
 *
 * 读不到镜像时（首次启动、无痕模式、localStorage 被禁）一律返回 undefined，
 * 调用方退回原来的 theme 判定——**绝不会比修之前更差**。
 */
import type { OSTheme } from '../types';

const ENABLED_KEY = 'sullyos_boot_animation_enabled';
const STYLE_KEY = 'sullyos_boot_animation_style';

export interface BootPreference {
    /** undefined = 没有镜像，调用方按 theme 判定。 */
    enabled?: boolean;
    /** undefined = 没有镜像，调用方按 theme 判定。 */
    style?: OSTheme['bootAnimationStyle'];
}

/** 同步读取镜像。任何异常都吞掉并返回空对象——开场偏好不值得让整机起不来。 */
export const readBootPreference = (): BootPreference => {
    if (typeof window === 'undefined') return {};
    try {
        const enabledRaw = window.localStorage.getItem(ENABLED_KEY);
        const styleRaw = window.localStorage.getItem(STYLE_KEY);
        return {
            enabled: enabledRaw === null ? undefined : enabledRaw !== '0',
            style: styleRaw === 'classic' || styleRaw === 'jellyfish' ? styleRaw : undefined,
        };
    } catch {
        return {};
    }
};

/** theme 就绪后调用，把当前选择写进镜像，供下次冷启动第一帧使用。 */
export const rememberBootPreference = (theme: Pick<OSTheme, 'bootAnimationEnabled' | 'bootAnimationStyle'>): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(ENABLED_KEY, theme.bootAnimationEnabled === false ? '0' : '1');
        // 风格没显式选过就删掉镜像，让默认值继续由 BootSequence 决定（当前是水母）。
        if (theme.bootAnimationStyle) window.localStorage.setItem(STYLE_KEY, theme.bootAnimationStyle);
        else window.localStorage.removeItem(STYLE_KEY);
    } catch {
        /* 无痕模式等场景写不进去，下次照旧走 theme 判定即可 */
    }
};
