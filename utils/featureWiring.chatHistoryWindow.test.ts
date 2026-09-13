import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'apps/Chat.tsx'), 'utf8');

/**
 * 旧消息浏览窗口的接线守卫。
 *
 * 这套交互没法在单测里真跑（要真实滚动和 DOM 高度），所以退而守住三条
 * 「一旦写错就一定坏」的不变量。
 */
describe('聊天记录浏览窗口接线', () => {
    it('跳转定位和渲染切片共用同一套过滤条件', () => {
        // 两边各写一份过滤条件的话，稍有出入就会下标错位 —— 跳过去落在别的消息上，
        // 而且错得很隐蔽（只在「有被隐藏的系统日志」的角色身上才现形）。
        expect(source).toContain('const browseableMessages = browseableChatMessages(allMsgs, char?.hideSystemLogs)');
        expect(source).toContain('() => browseableChatMessages(messages, char?.hideSystemLogs)');
        // 「能翻到的消息」这套过滤条件只允许有一处定义 —— 就是这个 helper。
        expect(source).toContain('const browseableChatMessages = (messages: Message[], hideSystemLogs?: boolean): Message[] =>');
    });

    it('定位动画期间不许续载', () => {
        // scrollIntoView 的平滑滚动自己会触发 onScroll；不上这道闸，
        // 跳转的一瞬间窗口就会被自动撑开，用户看到内容乱跳。
        expect(source).toContain('if (historyWindowScrollEnabledRef.current && historyWindowRangeRef.current)');
        expect(source).toContain('historyWindowScrollEnabledRef.current = true;');
    });

    it('向上续载会补偿滚动位置', () => {
        // 前插消息把内容整体往下顶；不补偿的话用户眼里的位置会突然跳走。
        expect(source).toContain('historyPrependAnchorRef.current = {');
        expect(source).toContain('scroller.scrollTop = anchor.scrollTop + (scroller.scrollHeight - anchor.scrollHeight)');
    });
});
