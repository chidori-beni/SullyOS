import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';

describe('普通聊天的陪伴、不监督边界', () => {
    it('把边界放进 recencyTail，并保留用户明确授权提醒的例外', async () => {
        const parts = await ChatPrompts.buildSystemPromptParts(
            { id: 'char-companionship', name: '阿一' } as any,
            { name: '条条' } as any,
            [], [], [], [],
        );

        expect(parts.recencyTail).toContain('### 陪伴，不监督（高优先级边界）');
        expect(parts.recencyTail).toContain('通常是在分享近况，不是在把进度交给你管理');
        expect(parts.recencyTail).toContain('这条边界在本次对话后续持续有效');
        expect(parts.recencyTail).toContain('只有对方明确要求你提醒、督促或帮忙安排时');
        expect(parts.recencyTail).toContain('不把一次授权扩展成长期监督，也不反复催促');
    });
});
