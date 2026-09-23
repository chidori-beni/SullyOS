import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';

// 私聊历史里「用户分享进来的卡片」角色到底看得到什么。
// 以前 webpage_card 落到默认分支，角色只读到网页标题，正文只进了归档/记忆宫殿。
const char = { id: 'c', name: '萧逸' } as any;
const user = { name: '千夜' } as any;

const history = (msgs: any[]) =>
    ChatPrompts.buildMessageHistory(msgs as any, 50, char, user, []).apiMessages
        .map((m: any) => String(m.content));

describe('buildMessageHistory · 用户分享的卡片', () => {
    it('网页卡片：角色读得到正文，不只是标题', () => {
        const now = Date.now();
        const [line] = history([{
            id: 1, charId: 'c', role: 'user', type: 'webpage_card', content: '某网页标题', timestamp: now,
            metadata: { webpage: { url: 'https://example.com/a', title: '某网页标题', content: '正文里的独特句子', excerpt: '', fetchedAt: now } },
        }]);
        expect(line).toContain('[网页分享]');
        expect(line).toContain('正文里的独特句子');
        expect(line).toContain('https://example.com/a');
    });

    it('热点日报转来的热搜：带标题、来源、简介，并提醒没读过全文', () => {
        const now = Date.now();
        const [line] = history([{
            id: 1, charId: 'c', role: 'user', type: 'news_card', content: '某某官宣', timestamp: now,
            metadata: { source: '微博', title: '某某官宣', desc: '今天下午发了长文', url: 'https://s.weibo.com/x', sharedFrom: 'hot_news' },
        }]);
        expect(line).toContain('[热点分享]');
        expect(line).toContain('千夜');
        expect(line).toContain('「某某官宣」');
        expect(line).toContain('来源：微博');
        expect(line).toContain('今天下午发了长文');
        expect(line).toContain('别编造');
    });

    it('角色自己分享的热点卡保持原样（content 里已写好第一人称文本）', () => {
        const now = Date.now();
        const [line] = history([{
            id: 1, charId: 'c', role: 'assistant', type: 'news_card', timestamp: now,
            content: '[你分享了一个热点：「某某官宣」（来源：微博）]',
            metadata: { source: '微博', title: '某某官宣' },
        }]);
        expect(line).toContain('[你分享了一个热点：「某某官宣」（来源：微博）]');
        expect(line).not.toContain('[热点分享]');
    });
});
