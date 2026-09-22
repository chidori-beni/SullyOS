import { useSyncExternalStore } from 'react';

export const GUIDE_KEY = 'os_first_use_memory_guide_v1';
export const GUIDE_SULLY_ID = 'preset-sully-v2';
const SKIP_VECTOR_KEY = 'os_first_use_skip_vector_v1';
const event = 'sully:first-use-guide';
export function setVectorGuideSkipped(skipped: boolean) {
    localStorage.setItem(SKIP_VECTOR_KEY, String(skipped));
    window.dispatchEvent(new Event(event));
}
export function useVectorGuideSkipped() {
    return useSyncExternalStore(subscribe, () => localStorage.getItem(SKIP_VECTOR_KEY) === 'true', () => false);
}
export function readGuideStep(): number | null {
    // ⚠️ 本 fork 关掉了首次使用引导（用户要求）。
    //
    // 只在这里断一刀，是因为整条链路都以「没有引导步骤」为安全默认值：
    //   · FirstUseGuide 组件 step === null 时直接 return null，整个引导不渲染
    //   · MemoryGuideActions 的两个组件 step !== 1 时返回 null
    //   · 记忆宫殿的 guideSetup 恒 false → 走正常布局，原本被引导藏起来的区块照常显示
    //   · 设置页「API 配置」不再被引导强制展开
    // 于是不用删文件、不用改任何调用点，散在各处的 data-guide 标记也留着无害
    // （几个没人读的 HTML 属性），以后合上游还少一堆冲突。
    // 想重新打开引导：把下面这行 return null 换回注释里那两行原逻辑即可。
    //     const value = localStorage.getItem(GUIDE_KEY);
    //     return value !== null && /^[0-6]$/.test(value) ? Number(value) : null;
    return null;
}
export function setGuideStep(step: number | 'done') {
    localStorage.setItem(GUIDE_KEY, String(step));
    window.dispatchEvent(new Event(event));
}
// Called only after a successful DB read, before inserting the built-in Sully.
export function initializeFirstUseGuide(characterCount: number) {
    try {
        if (localStorage.getItem(GUIDE_KEY) === null) {
            setGuideStep(characterCount === 0 ? 0 : 'done');
        }
    } catch { /* Storage failure must never turn a successful DB read into an empty roster. */ }
}
function subscribe(notify: () => void) {
    window.addEventListener(event, notify);
    window.addEventListener('storage', notify);
    return () => {
        window.removeEventListener(event, notify);
        window.removeEventListener('storage', notify);
    };
}
export function useFirstUseGuideStep() {
    return useSyncExternalStore(subscribe, readGuideStep, () => null);
}
export function hasGuideApi(config?: { baseUrl?: string; apiKey?: string; model?: string }) {
    return !!(config?.baseUrl?.trim() && config.apiKey?.trim() && config.model?.trim());
}
