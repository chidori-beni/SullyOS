import { expect, it, describe } from 'vitest';
import { ContextBuilder } from './context';
import type { CharacterProfile, MountedWorldbook, UserProfile } from '../types';

// 本 fork 的世界书规则在上游公共管线（25468054 的 buildCharacterContext / buildCharacterRequest /
// buildGroupWorldbookRequest）上仍然成立。上游那套不知道「生效场景」「日程专用书」这些概念，
// 以后再合上游时这里任何一条红了，就是 fork 的规则被冲掉了。

const user = { name: '机主', bio: '' } as UserProfile;
const wb = (id: string, x: Partial<MountedWorldbook> & Record<string, unknown> = {}): MountedWorldbook => (
    { id, title: id, content: `WB_${id}`, constant: true, position: 1, ...x } as MountedWorldbook
);
const char = (books: MountedWorldbook[], id = 'c', name = '角色') => ({
    id, name, avatar: '', description: '', systemPrompt: 'x', memories: [], mountedWorldbooks: books,
} as unknown as CharacterProfile);
const count = (s: string, k: string) => s.split(k).length - 1;

describe('本 fork 的世界书规则（公共管线上）', () => {
    it('生效场景：私聊只取线上/全部，见面只取线下/全部', () => {
        const c = char([wb('on', { mode: 'online' }), wb('off', { mode: 'offline' }), wb('all')]);
        const chat = ContextBuilder.buildCharacterContext({ char: c, user, history: [] }).coreContext;
        expect(chat).toContain('WB_on');
        expect(chat).not.toContain('WB_off');
        expect(chat).toContain('WB_all');
        const date = ContextBuilder.buildCoreContext(c, user, true, undefined, undefined, { worldbookMode: 'offline' });
        expect(date).not.toContain('WB_on');
        expect(date).toContain('WB_off');
    });

    it('日程专用书：普通用途（含消息入口）看不到，日程用途能看到', () => {
        const c = char([wb('sched', { mode: 'schedule' })]);
        expect(ContextBuilder.buildCharacterContext({ char: c, user, history: [] }).coreContext).not.toContain('WB_sched');
        expect(JSON.stringify(ContextBuilder.buildCharacterRequest({ char: c, user }, [{ role: 'user', content: 'hi' }])))
            .not.toContain('WB_sched');
        expect(ContextBuilder.buildCoreContext(c, user, true, undefined, undefined, { worldbookContextPurpose: 'schedule' }))
            .toContain('WB_sched');
    });

    it('日程的深度条目只以「本次日程参考」出现一次', () => {
        const c = char([wb('d', { position: 4 })]);
        const s = ContextBuilder.buildCoreContext(c, user, true, undefined, undefined, {
            includeAtDepthWorldbooks: true, worldbookContextPurpose: 'schedule',
        });
        expect(count(s, 'WB_d')).toBe(1);
        expect(s).toContain('本次日程参考');
    });

    it('见面 / 通话自己插深度条目：系统文本里不再塞一份；其余文本入口照上游带上', () => {
        const c = char([wb('d', { position: 4 })]);
        expect(ContextBuilder.buildCoreContext(c, user, true, undefined, undefined, { depthEntriesInjectedByCaller: true }))
            .not.toContain('WB_d');
        expect(count(ContextBuilder.buildCoreContext(c, user, true), 'WB_d')).toBe(1);
    });

    it('群聊：被任一成员标成仅日程的书不进群；成员关掉挂载的书不算 ta 的', () => {
        const a = char([wb('s', { mode: 'schedule' }), wb('x')], 'a', '甲');
        const b = char([wb('s'), wb('x', { mountEnabled: false })], 'b', '乙');
        const json = JSON.stringify(ContextBuilder.buildGroupWorldbookRequest({
            members: [a, b], user, history: [{ role: 'user', content: 'hi' }],
            render: (slots, h) => [{ role: 'system', content: slots.before + slots.after }, ...h],
        }));
        expect(json).not.toContain('WB_s');
        expect(json).toContain('世界书归属：甲；');
    });

    it('概率条目：调用方传 resolvedWorldbookEntries 时直接复用，不再重抽', () => {
        const c = char([wb('p', { useProbability: true, probability: 50 })]);
        const s = ContextBuilder.buildCoreContext(c, user, true, undefined, undefined, {
            resolvedWorldbookEntries: [{ book: c.mountedWorldbooks![0], content: 'WB_p', position: 1, order: 100 }],
        });
        expect(count(s, 'WB_p')).toBe(1);
    });
});
