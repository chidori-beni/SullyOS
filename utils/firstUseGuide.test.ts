import { describe, expect, it, vi } from 'vitest';

// 挡掉 OSContext：引导组件 import 了它，而它会把整个 App（DB、各种 App）拖进来。
vi.mock('../context/OSContext', () => ({ useOS: () => ({ characters: [], apiConfig: {}, memoryPalaceConfig: {}, openApp: () => {}, setActiveCharacterId: () => {}, updateMemoryPalaceConfig: () => {} }) }));
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeFirstUseGuide, readGuideStep } from './firstUseGuide';

// 本 fork 关掉了首次使用引导（用户 2026-09-22 要求）。
//
// 原来这份文件测的是「引导会不会正确出现」，需要 jsdom 渲染整个引导组件。
// 现在反过来：**盯着它必须一直是关的**。以后上游再动这块、或某次合并把
// readGuideStep 的原逻辑合回来，这里会立刻变红。
describe('首次使用引导已关闭', () => {
    it('读步骤恒为 null —— 整条链路都以此为「不显示」的安全默认值', () => {
        expect(readGuideStep()).toBeNull();
    });

    it('初始化（哪怕一个角色都没有）也不会把引导打开', () => {
        expect(() => initializeFirstUseGuide(0)).not.toThrow();
        expect(readGuideStep()).toBeNull();
    });

    it('源码里那一刀还在，没被上游合并悄悄合回去', () => {
        const source = readFileSync(fileURLToPath(new URL('./firstUseGuide.ts', import.meta.url)), 'utf8');
        // 函数体里只剩 return null；原逻辑收在注释里，方便随时改回来
        expect(source).toContain('本 fork 关掉了首次使用引导');
        expect(source).not.toMatch(/^\s*const value = localStorage\.getItem\(GUIDE_KEY\);/m);
    });

    it('就算 localStorage 里写着「第 0 步」，引导也渲染不出任何东西', async () => {
        // 直接渲染成字符串来证明 —— 这台机器的 jsdom 和 dev 服务器都装坏了
        // （jsdom 缺 custom-elements、vite 缺 @babel/core），但 react-dom/server 是好的，
        // 比「看代码里有 return null」更硬：真跑一遍。
        // OSContext 要挡掉，否则 import 会把整个 App（含 IndexedDB）拖进来直接超时。
        vi.stubGlobal('localStorage', {
            getItem: () => '0', setItem: () => {}, removeItem: () => {}, clear: () => {},
        } as unknown as Storage);
        const { renderToStaticMarkup } = await import('react-dom/server');
        const React = (await import('react')).default;
        const FirstUseGuide = (await import('../components/FirstUseGuide')).default;
        expect(renderToStaticMarkup(React.createElement(FirstUseGuide))).toBe('');
    });
});
