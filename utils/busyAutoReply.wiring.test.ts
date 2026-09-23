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
        // 合上游后 isTyping 拆成了 localTyping（本机）+ characterTyping（跨页面占位），
        // 置位的函数随之改名；这里只是跟着改锚点，断言的顺序含义不变。
        const typingAt = source.indexOf('setLocalTyping(true);', apiCheckAt);
        expect(decisionAt).toBeGreaterThan(-1);
        expect(apiCheckAt).toBeGreaterThan(decisionAt);
        expect(typingAt).toBeGreaterThan(apiCheckAt);

        const branch = source.slice(decisionAt, apiCheckAt);
        expect(branch).toContain('await DB.getRecentMessagesByCharId(char.id, 200)');
        expect(branch).toContain('const scheduleInstant = new Date();');
        expect(branch).toContain('getDailyScheduleForChar(char, scheduleInstant)');
        expect(branch).toContain('scheduleContextForTurn = turnScheduleContext;');
        expect(branch).toContain('messages: recentMessagesForPrompt');
        expect(branch).toContain("busyDecision.mode === 'auto-reply'");
        expect(branch).toContain('await DB.saveMessage({');
        expect(branch).toContain('timestamp: turnScheduleContext.instant.getTime(),');
        expect(branch).toContain('busyAutoReply: {');
        expect(branch).toContain('saved auto reply but failed to refresh chat UI');
        // 原先这里还要求调用 onInstantPosted（Instant Push 的「发送中」指示灯收尾）；
        // Instant Push 整条链路移除后这个回调没了，自动回复落盘后只需解锁入口并结束本轮。
        expect(branch).toMatch(/triggerInFlightRef\.current = false;\s*return;/);
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
        expect(source).toContain('scheduleContext: scheduleContextForTurn');
        expect(source).toContain('busyReplyDecision: busyDecisionForTurn');
    });
});
