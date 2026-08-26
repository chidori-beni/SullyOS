import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
    fileURLToPath(new URL('../hooks/useChatAI.ts', import.meta.url)),
    'utf8',
);

describe('忙碌自动回复的聊天入口接线', () => {
    it('在 API 配置检查和模型生成状态之前读取最新 DB 历史并本地落盘', () => {
        const decisionAt = source.indexOf("if (char.busyAutoReplyEnabled === true && isScheduleFeatureOn(char))");
        const apiCheckAt = source.indexOf('const effectiveApi = overrideApiConfig || apiConfig;');
        const typingAt = source.indexOf('setIsTyping(true);', apiCheckAt);
        expect(decisionAt).toBeGreaterThan(-1);
        expect(apiCheckAt).toBeGreaterThan(decisionAt);
        expect(typingAt).toBeGreaterThan(apiCheckAt);

        const branch = source.slice(decisionAt, apiCheckAt);
        expect(branch).toContain('await DB.getRecentMessagesByCharId(char.id, 200)');
        expect(branch).toContain('messages: recentMessagesForPrompt');
        expect(branch).toContain("busyDecision.mode === 'auto-reply'");
        expect(branch).toContain('await DB.saveMessage({');
        expect(branch).toContain('busyAutoReply: {');
        expect(branch).toContain('saved auto reply but failed to refresh chat UI');
        expect(branch).toContain('auto reply posted but UI callback failed');
        expect(branch).toContain('onInstantPosted?.();');
        expect(branch).toMatch(/onInstantPosted\?\.\(\);[\s\S]*return;/);
        expect(branch).not.toContain('safeFetchJson');
        expect(branch).not.toContain('sendInstantChatTurn');
    });

    it('用同步入口锁挡住自动触发与手动触发的并发重复生成', () => {
        expect(source).toContain('const triggerInFlightRef = useRef(false);');
        expect(source).toContain('if (triggerInFlightRef.current) return;');
        expect(source).toContain('triggerInFlightRef.current = false;');
    });

    it('把同一份最新消息提示传给普通模型，避免忙碌状态因旧快照丢失', () => {
        expect(source).toContain('recentMsgsHint: recentMessagesForPrompt');
    });
});
