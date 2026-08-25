import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
    fileURLToPath(new URL('../hooks/useChatAI.ts', import.meta.url)),
    'utf8',
);

describe('忙碌自动回复的聊天入口接线', () => {
    it('在 API 配置检查和模型生成状态之前本地落盘并结束本轮', () => {
        const decisionAt = source.indexOf("if (char.busyAutoReplyEnabled === true && isScheduleFeatureOn(char))");
        const apiCheckAt = source.indexOf('const effectiveApi = overrideApiConfig || apiConfig;');
        const typingAt = source.indexOf('setIsTyping(true);', apiCheckAt);
        expect(decisionAt).toBeGreaterThan(-1);
        expect(apiCheckAt).toBeGreaterThan(decisionAt);
        expect(typingAt).toBeGreaterThan(apiCheckAt);

        const branch = source.slice(decisionAt, apiCheckAt);
        expect(branch).toContain("busyDecision.mode === 'auto-reply'");
        expect(branch).toContain('await DB.saveMessage({');
        expect(branch).toContain('busyAutoReply: {');
        expect(branch).toContain('onInstantPosted?.();');
        expect(branch).toMatch(/onInstantPosted\?\.\(\);\s*return;/);
        expect(branch).not.toContain('safeFetchJson');
        expect(branch).not.toContain('sendInstantChatTurn');
    });
});
