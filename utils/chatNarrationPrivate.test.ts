import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CHAT_ACTION_DEFINITIONS,
    DEFAULT_CHAT_ACTION_ORDER,
    normalizeChatActionOrder,
    isChatActionId,
} from './chatActionOrder';

/**
 * 旁白接进 1v1 私聊（阶段 5.2 收口）。
 *
 * 底层（`NarrationMeta` / `buildNarrationLine` / `buildMessageHistory` 的改写分支）
 * 在群聊那一批就写好了，且**完全通用**——私聊这边只是把入口接上。
 * 所以这份测试只锁「接线没接错」，不重复测底层。
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('私聊旁白 · 加号菜单入口', () => {
    it('narration 是一个合法的加号菜单动作', () => {
        expect(isChatActionId('narration')).toBe(true);
        expect(CHAT_ACTION_DEFINITIONS.find(d => d.id === 'narration')?.label).toBe('旁白');
    });

    it('⭐ 默认顺序里放在**末尾** —— 老用户的排序会把新动作补到末尾，两边得在同一格', () => {
        expect(DEFAULT_CHAT_ACTION_ORDER[DEFAULT_CHAT_ACTION_ORDER.length - 1]).toBe('narration');
    });

    it('⛔ 老用户存过的排序（没有 narration）不会丢失自定义顺序，只是把旁白补在最后', () => {
        const legacy = DEFAULT_CHAT_ACTION_ORDER.filter(id => id !== 'narration');
        const reordered = ['favorites', ...legacy.filter(id => id !== 'favorites')];
        const fixed = normalizeChatActionOrder(reordered);
        expect(fixed[0]).toBe('favorites');                    // 用户自己的排序保住
        expect(fixed[fixed.length - 1]).toBe('narration');     // 新动作补在末尾
        expect(fixed).toHaveLength(DEFAULT_CHAT_ACTION_ORDER.length);
    });

    it('加号菜单里有这个按钮，且点了走 onPanelAction(\'narration\')', () => {
        const src = read('components/chat/ChatInputArea.tsx');
        expect(src).toContain("onPanelAction('narration')");
        expect(src).toMatch(/narration:\s*\(/);
    });
});

describe('私聊旁白 · 落库', () => {
    const src = read('apps/Chat.tsx');

    it('加号菜单的动作接到了打开弹窗上', () => {
        expect(src).toContain("case 'narration':");
    });

    it('⛔⭐ 存成 role:\'system\' —— 存成 \'user\' 角色会当成「你说的话」，回你一句「外面下雨了吗？我看看」，效果当场废掉', () => {
        const fn = src.slice(src.indexOf('const sendNarration'), src.indexOf('const handlePanelAction'));
        expect(fn).toContain("role: 'system'");
        expect(fn).not.toContain("role: 'user'");
    });

    it('⭐ 带上 narration 标记和档位 —— 没有标记的话 buildMessageHistory 认不出来，就成了一句裸指令', () => {
        const fn = src.slice(src.indexOf('const sendNarration'), src.indexOf('const handlePanelAction'));
        expect(fn).toContain('narration: true');
        expect(fn).toContain('narrationKind');
    });

    it('⛔ 私聊不给「说给谁听」—— 只有一个角色，指令档天然就是说给 ta 的', () => {
        const fn = src.slice(src.indexOf('const sendNarration'), src.indexOf('const handlePanelAction'));
        expect(fn).not.toContain('narrationTo');
    });
});
