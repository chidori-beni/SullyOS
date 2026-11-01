import { describe, expect, it } from 'vitest';
import { feedItemCopyText, guestbookCopyText, letterCopyText, scriptCopyText, stagedPlayCopyText } from './copyText';
import type { VRLetter, VRStagedPlay } from '../../types';

describe('彼方一键复制', () => {
    it('动态里的信件摘要复制全文，不按卡片的 70 字截断', () => {
        const long = '信'.repeat(120);
        const text = feedItemCopyText({ charName: '萧逸', timestamp: 0, meta: { vrCard: true, room: 'postoffice', activity: '萧逸写了一封漂流信', letterExcerpt: long } }, '邮局', { activity: s => s.replace(/^萧逸/, '') });
        expect(text).toContain('萧逸 · 邮局');
        expect(text).toContain('写了一封漂流信');
        expect(text).not.toContain('萧逸写了');
        expect(text).toContain(`「${long}」`);
    });

    it('信件带上回信、收到的回复和读后感', () => {
        const l: VRLetter = {
            id: 'a', box: 'outbox', pen: '夜航', content: '你好', createdAt: 0,
            repliesReceived: [{ pen: '路人', content: '收到了', createdAt: 0 }],
            reaction: { content: '真好', createdAt: 0 },
        };
        expect(letterCopyText(l)).toBe('夜航：\n你好\n\n路人 回：\n收到了\n\n读后：\n真好');
        const inbox: VRLetter = { id: 'b', box: 'inbox', pen: '陌生人', content: '在吗', createdAt: 0, reply: { charId: 'user', pen: '我', content: '在', createdAt: 0, userNote: '补一句' } };
        expect(letterCopyText(inbox)).toBe('陌生人：\n在吗\n\n回信（我）：\n在\n——\n补一句');
    });

    it('留言簿一条一行，标出回复对象，名字可替换', () => {
        const text = guestbookCopyText([
            { id: '1', authorId: 'c1', authorName: '旧名', content: '早', createdAt: 0 },
            { id: '2', authorId: 'user', authorName: '我', content: '早呀', replyToId: '1', replyToName: '旧名', createdAt: 0 },
        ], m => m.authorId === 'c1' ? '新名' : m.authorName);
        const lines = text.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/^新名（.+）：早$/);
        expect(lines[1]).toMatch(/^我（.+） ↩旧名：早呀$/);
    });

    it('剧本和舞台剧都输出全文', () => {
        expect(scriptCopyText({ id: 's', title: '电梯', logline: '困住了', roles: [{ name: '甲', persona: '急' }], body: '甲：开门！', authorId: 'user', authorName: '我', source: 'user', createdAt: 0 }))
            .toBe('《电梯》　我\n困住了\n登场：甲（急）\n\n甲：开门！');
        const play: VRStagedPlay = {
            id: 'p', scriptId: 's', title: '电梯', logline: '', notes: [], rating: 'A',
            cast: [{ roleName: '甲', actorId: 'c1', actorName: '萧逸', isNpc: false }],
            stage: [{ kind: 'enter', actorName: '萧逸', text: '' }, { kind: 'line', actorName: '萧逸', text: '开门！' }, { kind: 'narration', text: '灯灭了' }],
            reviews: [{ critic: '观众', text: '好' }], createdAt: 0,
        };
        expect(stagedPlayCopyText(play)).toBe('《电梯》\n演员：萧逸 饰 甲\n\n——甲 上场——\n甲：开门！\n（灯灭了）\n\n观众席\n观众：好\n\n综合评级：A');
    });
});
