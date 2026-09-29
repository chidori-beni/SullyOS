import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';

// 影院里的话照通话的做法存进私聊消息库（source: 'cinema'）。私聊界面不显示，
// 但角色的上下文要认得出这是「一起看片时说的」，而且知道看的是哪一部。

const char = { id: 'c1', name: '萧逸' } as any;
const userProfile = { name: '千夜' } as any;
const t0 = Date.now() - 60_000;

describe('私聊上下文里的一起看记录', () => {
    it('影院的话带上「[一起看：片名]」，普通聊天仍是「[聊天]」', () => {
        const history = [
            { id: 1, charId: 'c1', role: 'user', type: 'text', content: '这个人好可疑', timestamp: t0, metadata: { source: 'cinema', cinemaSessionId: 's1', cinemaTitle: '钟表馆事件' } },
            { id: 2, charId: 'c1', role: 'assistant', type: 'text', content: '跑这么急肯定有鬼', timestamp: t0 + 1000, metadata: { source: 'cinema', cinemaSessionId: 's1', cinemaTitle: '钟表馆事件' } },
            { id: 3, charId: 'c1', role: 'user', type: 'text', content: '看完啦', timestamp: t0 + 2000 },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        const text = apiMessages.map((m: any) => String(m.content)).join('\n');
        expect(text).toContain('[一起看：钟表馆事件]');
        expect(text).toContain('[聊天]');
    });

    it('线下一起看标成「面对面」', () => {
        const history = [
            { id: 1, charId: 'c1', role: 'user', type: 'text', content: '好吓人', timestamp: t0, metadata: { source: 'cinema', cinemaSessionId: 's2', cinemaTitle: '钟表馆事件', cinemaMeet: 'offline', dateEncounterId: 'e1' } },
        ] as any[];
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        expect(apiMessages.map((m: any) => String(m.content)).join(' ')).toContain('[一起看（面对面）：钟表馆事件]');
    });
});
