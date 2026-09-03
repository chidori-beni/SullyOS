import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import MessageItem from '../components/chat/MessageItem';
import { CARD_SHELL_SELECTOR, DARK_CARD_KINDS } from './chatCardCss';

/**
 * 接线测试：钩子必须真的出现在渲染结果里。
 *
 * 单测 resolveCardHook 只能证明「算出来的值对」，证明不了有人把它挂到 DOM 上了 ——
 * 而这个功能的整个价值就在于「装扮里那段 CSS 选得中卡片」。卡片分支有十几个各自的
 * 外层 div，漏挂一个就是那张卡静默地没法美化，所以这里逐类渲染真组件来兜底。
 */

const activeTheme = { id: 'test-theme', name: 'Test', user: {}, ai: {} } as any;

const render = (msg: Message) => renderToStaticMarkup(React.createElement(MessageItem, {
    msg,
    isFirstInGroup: true,
    isLastInGroup: true,
    activeTheme,
    charAvatar: 'https://example.com/char.png',
    charName: '角色',
    userAvatar: 'https://example.com/user.png',
    onLongPress: vi.fn(),
    onReply: vi.fn(),
    selectionMode: false,
    isSelected: false,
    onToggleSelect: vi.fn(),
} as any));

const base = { id: 1, charId: 'char-1', timestamp: 1 };

describe('卡片钩子真的渲染进了 DOM', () => {
    it('普通文字消息不带 sully-chat-card，也没有 data-card', () => {
        const html = render({ ...base, role: 'assistant', type: 'text', content: '你好' } as Message);
        expect(html).not.toContain('sully-chat-card');
        expect(html).not.toContain('data-card');
    });

    it('彼方卡片（走 commonLayout 的那一路）', () => {
        const html = render({
            ...base, role: 'assistant', type: 'vr_card', content: '',
            metadata: { room: 'library', activity: '看了会儿书。' },
        } as Message);
        expect(html).toContain('sully-chat-card');
        expect(html).toContain('data-card="vr_card"');
    });

    it('通话结束小结（system 角色、自带外壳的那一路）', () => {
        const html = render({
            ...base, role: 'system', type: 'system', content: '[System: 通话结束]',
            metadata: { source: 'call-end-popup', callMemo: '聊了会儿天', durationSec: 300, characterAvatar: 'x' },
        } as Message);
        expect(html).toContain('sully-chat-card');
        expect(html).toContain('data-card="system"');
        expect(html).toContain('data-card-sub="call-end-popup"');
    });

    it('未接来电', () => {
        const html = render({
            ...base, role: 'system', type: 'system', content: '[System: 未接来电]',
            metadata: { source: 'incoming-call-missed', characterName: '角色' },
        } as Message);
        expect(html).toContain('data-card-sub="incoming-call-missed"');
    });

    it('见面邀请', () => {
        const html = render({
            ...base, role: 'system', type: 'system', content: '',
            metadata: { source: 'date-meeting-invite', invitation: '来见我', charName: '角色' },
        } as Message);
        expect(html).toContain('data-card-sub="date-meeting-invite"');
    });

    it('score_card 的子类型也落到了 data-card-sub 上', () => {
        const html = render({
            ...base, role: 'system', type: 'score_card', content: '',
            metadata: { scoreCard: { type: 'diary_card', date: '2026-09-03', userText: '今天' } },
        } as Message);
        expect(html).toContain('data-card="system"');
        expect(html).toContain('data-card-sub="diary_card"');
    });

    it('戳一戳（自成一路的外壳）', () => {
        const html = render({ ...base, role: 'user', type: 'interaction', content: '戳了戳' } as Message);
        expect(html).toContain('data-card="interaction"');
    });
});

describe('内置「浅色卡片」预设的选择器打得中真卡片', () => {
    // CARD_SHELL_SELECTOR 靠「同时带 rounded- 和 overflow-hidden」认卡片外壳。
    // 卡片改版时最容易悄悄失效的就是这条，所以对着真渲染结果验一次。
    const darkCardSamples: Record<string, Message> = {
        vr_card: { ...base, role: 'assistant', type: 'vr_card', content: '', metadata: { room: 'library', activity: 'x' } } as Message,
        sim_card: { ...base, role: 'assistant', type: 'sim_card', content: '', metadata: { simCard: { title: 'x' } } } as Message,
        phone_card: { ...base, role: 'assistant', type: 'phone_card', content: '', metadata: { phoneCard: { kind: 'chat', name: 'x' } } } as Message,
        trpg_card: { ...base, role: 'assistant', type: 'trpg_card', content: '', metadata: { trpgCard: { title: 'x' } } } as Message,
    };

    it('名录里标成深色的那几张都有样本', () => {
        expect([...DARK_CARD_KINDS].sort()).toEqual(Object.keys(darkCardSamples).sort());
    });

    // 这份测试跑在 node 环境里（没有 DOM），所以直接在 class 属性上验同一组条件：
    // CARD_SHELL_SELECTOR 就是 div[class*="overflow-hidden"][class*="rounded-"]。
    const hasShellClass = (html: string): boolean =>
        [...html.matchAll(/class="([^"]*)"/g)]
            .some(([, cls]) => cls.includes('overflow-hidden') && cls.includes('rounded-'));

    it.each(Object.entries(darkCardSamples))('%s 的外壳同时带 rounded- 和 overflow-hidden', (_kind, msg) => {
        expect(CARD_SHELL_SELECTOR).toBe('div[class*="overflow-hidden"][class*="rounded-"]');
        expect(hasShellClass(render(msg))).toBe(true);
    });
});
