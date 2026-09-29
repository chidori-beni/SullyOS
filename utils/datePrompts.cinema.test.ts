import { describe, expect, it } from 'vitest';
import { DatePrompts } from './datePrompts';
import type { CharacterProfile, Message, UserProfile } from '../types';

// 影院「线下一起看」的话记在这次见面名下（source: 'cinema' + cinemaMeet: 'offline' + dateEncounterId）。
// 回到见面时，见面的提示词要告诉角色「这次见面里你们一起看过片」，但只认这一次见面的。

const char = { id: 'c1', name: '萧逸', avatar: '', description: '', systemPrompt: '你是萧逸。', memories: [] } as unknown as CharacterProfile;
const user = { name: '千夜', bio: '' } as UserProfile;
let id = 1;
const msg = (over: Partial<Message>): Message => ({ id: id++, charId: 'c1', role: 'user', type: 'text', content: '嗯', timestamp: Date.now(), ...over });

const build = (cinemaEncounterId: string) => DatePrompts.buildSessionPayload({
    char, userProfile: user, emojis: [], userText: '看完啦', variant: 'send',
    allMsgs: [
        msg({ role: 'assistant', content: '[normal] 开场白', metadata: { source: 'date', isOpening: true, dateEncounterId: 'e1', sceneClockAt: Date.now() } }),
        msg({ content: '这个人好可疑', metadata: { source: 'cinema', cinemaSessionId: 's1', cinemaTitle: '钟表馆事件', cinemaMeet: 'offline', dateEncounterId: cinemaEncounterId } }),
        msg({ content: '看完啦', metadata: { source: 'date', dateEncounterId: 'e1' } }),
    ],
});

const systemOf = (messages: any[]) => String(messages.find(m => m.role === 'system')?.content || '');

describe('见面里一起看过片', () => {
    it('这次见面里线下一起看过：提醒角色接着记得，别自己跳时间', async () => {
        const sys = systemOf((await build('e1')).messages);
        expect(sys).toContain('这次见面中一起看过片');
        expect(sys).toContain('不要自己跳时间');
    });

    it('别的见面里看的，不算这一次', async () => {
        const sys = systemOf((await build('e0')).messages);
        expect(sys).not.toContain('这次见面中一起看过片');
    });
});
