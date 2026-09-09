import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

describe('聊天触发 AI 闪电按钮位置接线', () => {
    it('按当前角色保存位置，并让旧角色默认继续显示在顶栏', () => {
        const types = read('types.ts');
        const chat = read('apps/Chat.tsx');
        const modals = read('components/chat/ChatModals.tsx');

        expect(types).toContain("export type ChatTriggerPlacement = 'header' | 'input';");
        expect(types).toContain('chatTriggerPlacement?: ChatTriggerPlacement;');
        expect(chat).toContain("useState<ChatTriggerPlacement>('header')");
        expect(chat).toContain("setSettingsTriggerPlacement(char.chatTriggerPlacement === 'input' ? 'input' : 'header');");
        expect(chat).toContain('chatTriggerPlacement: settingsTriggerPlacement');
        expect(chat).toContain('settingsTriggerPlacement={settingsTriggerPlacement} setSettingsTriggerPlacement={setSettingsTriggerPlacement}');
        expect(modals).toContain('闪电按钮位置');
        expect(modals).toContain('聊天顶栏右上角');
        expect(modals).toContain('输入框右侧');
    });

    it('顶栏和输入框使用同一个触发回调，并且渲染位置互斥', () => {
        const chat = read('apps/Chat.tsx');
        const header = read('components/chat/ChatHeaderShell.tsx');
        const input = read('components/chat/ChatInputArea.tsx');

        expect(chat).toContain('showTrigger={char.chatTriggerPlacement !== \'input\'}');
        expect(chat).toContain('showTriggerButton={char.chatTriggerPlacement === \'input\'}');
        expect(chat).toContain('onTriggerAI={handleManualTrigger}');
        expect(header).toContain('showTrigger?: boolean;');
        expect(header).toContain('{showTrigger && (');
        expect(input).toContain('showTriggerButton?: boolean;');
        expect(input).toContain('{showTriggerButton && onTriggerAI && (');
        expect(input.indexOf('{showTriggerButton && onTriggerAI && (')).toBeLessThan(input.indexOf('title="表情包"'));
        expect(input).toContain('<Lightning className="w-5 h-5" weight="bold" />');
    });
});
