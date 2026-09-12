import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

describe('聊天触发 AI 闪电按钮位置接线', () => {
    it('位置存在全局输入偏好里，对所有私聊统一生效', () => {
        const types = read('types.ts');
        const chat = read('apps/Chat.tsx');
        const modals = read('components/chat/ChatModals.tsx');
        const prefs = read('utils/chatInputPreferences.ts');

        expect(types).toContain("export type ChatTriggerPlacement = 'header' | 'input';");
        expect(prefs).toContain('triggerPlacement: ChatTriggerPlacement;');
        expect(prefs).toContain("triggerPlacement: 'header',");
        expect(prefs).toContain("triggerPlacement: saved.triggerPlacement === 'input' ? 'input' : 'header',");

        // 全局一份：不再从角色身上读回，也不再跟着角色设置一起保存。
        // 这两条 not.toContain 是回归守卫——谁把它改回按角色存，这里立刻挂。
        expect(chat).not.toContain('settingsTriggerPlacement');
        expect(chat).not.toContain('char.chatTriggerPlacement');

        expect(modals).toContain('闪电按钮位置');
        expect(modals).toContain('聊天顶栏右上角');
        expect(modals).toContain('输入框右侧');
        expect(modals).toContain("settingsInputPreferences.triggerPlacement === 'header'");
        expect(modals).toContain("triggerPlacement: 'input'");
    });

    it('顶栏和输入框使用同一个触发回调，并且渲染位置互斥', () => {
        const chat = read('apps/Chat.tsx');
        const header = read('components/chat/ChatHeaderShell.tsx');
        const input = read('components/chat/ChatInputArea.tsx');

        expect(chat).toContain("showTrigger={inputPreferences.triggerPlacement !== 'input'}");
        expect(chat).toContain("showTriggerButton={inputPreferences.triggerPlacement === 'input'}");
        expect(chat).toContain('onTriggerAI={handleManualTrigger}');
        expect(header).toContain('showTrigger?: boolean;');
        expect(header).toContain('{showTrigger && !hideTrigger && (');
        expect(input).toContain('showTriggerButton?: boolean;');
        expect(input).toContain('{showTriggerButton && onTriggerAI && (');
        expect(input.indexOf('{showTriggerButton && onTriggerAI && (')).toBeLessThan(input.indexOf('title="表情包"'));
        expect(input).toContain('<Lightning className="w-5 h-5" weight="bold" />');
    });
});
