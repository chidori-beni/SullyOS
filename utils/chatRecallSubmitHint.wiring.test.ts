import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

describe('聊天召回/提交状态提示接线', () => {
    it('把提示接到现有临时气泡，并保留手动开关', () => {
        const chat = read('apps/Chat.tsx');
        const modals = read('components/chat/ChatModals.tsx');
        const hook = read('hooks/useChatAI.ts');

        expect(chat).toContain('visibleRecallSubmitStatus');
        expect(chat).toContain('正在召回记忆…');
        expect(chat).toContain('记忆准备完成，正在提交云端…');
        expect(chat).toContain('云端任务已接收，现在可以切后台');
        expect(chat).toContain('aria-live="polite"');
        expect(chat).toContain('settingsShowTokenUsage={settingsShowTokenUsage}');
        expect(chat).toContain('showTokenUsage={char.showTokenUsage !== false}');
        expect(chat).toContain('showTokenUsage: settingsShowTokenUsage');
        expect(chat).toContain('settingsShowRecallSubmitStatus={settingsShowRecallSubmitStatus}');
        expect(modals).toContain('显示召回/提交状态');
        expect(modals).toContain('aria-pressed={settingsShowRecallSubmitStatus}');
        expect(hook).toContain("phase: 'accepted'");
        expect(hook).toContain('底层 /instant-chat 得到 202');
    });
});
