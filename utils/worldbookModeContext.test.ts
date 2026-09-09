import { describe, expect, it } from 'vitest';
import { ContextBuilder } from './context';
import { resolveWorldbookEntries } from './worldbook';

const character = {
    id: 'char-1',
    name: '阿澈',
    description: '',
    systemPrompt: '保持角色设定。',
    worldview: '',
    mountedWorldbooks: [
        { id: 'all', title: '共有规则', content: '两边都能看见。', category: '测试', mode: 'all' },
        { id: 'online', title: '线上规则', content: '线上不要使用标点。', category: '测试', mode: 'online' },
        { id: 'offline', title: '线下规则', content: '线下保留自然标点。', category: '测试', mode: 'offline' },
        { id: 'schedule-only', title: '日程规则', content: '日程专用哨兵：安排赛车训练。', category: '测试', mode: 'schedule' },
    ],
} as any;

const user = { id: 'user-1', name: '小雨', bio: '' } as any;

describe('worldbook mode in shared context builder', () => {
    it('keeps online corrections out of face-to-face prompts', () => {
        const online = ContextBuilder.buildCoreContext(character, user, true, undefined, undefined, {
            skipTimeAwareness: true,
            worldbookMode: 'online',
        });
        const offline = ContextBuilder.buildCoreContext(character, user, true, undefined, undefined, {
            skipTimeAwareness: true,
            worldbookMode: 'offline',
        });

        expect(online).toContain('两边都能看见。');
        expect(online).toContain('线上不要使用标点。');
        expect(online).not.toContain('线下保留自然标点。');
        expect(online).not.toContain('日程专用哨兵');
        expect(offline).toContain('两边都能看见。');
        expect(offline).toContain('线下保留自然标点。');
        expect(offline).not.toContain('线上不要使用标点。');
        expect(offline).not.toContain('日程专用哨兵');
    });

    it('日程作用域可以读取角色绑定的日程专用世界书', () => {
        const schedule = ContextBuilder.buildCoreContext(character, user, true, undefined, undefined, {
            skipTimeAwareness: true,
            worldbookMode: 'online',
            worldbookContextPurpose: 'schedule',
        });

        expect(schedule).toContain('日程专用哨兵：安排赛车训练。');
    });

    it('群聊共享块也不会把日程专用世界书提升为共有设定', () => {
        const shared = ContextBuilder.buildGroupSharedScene([
            character,
            { ...character, id: 'char-2', name: '乙' },
        ], user);

        expect(shared.text).not.toContain('日程专用哨兵');
    });

    it('日程可把位置4的提醒作为参考块读取，深度0不会让它消失', () => {
        const mounted = [{
            id: 'depth-zero',
            title: '临时提醒',
            content: '今天记得留意一个小小的变化。',
            mode: 'online',
            constant: true,
            position: 4,
            depth: 0,
        }] as any;
        const resolved = resolveWorldbookEntries(mounted, [], '阿澈', '小雨', 'online');
        const scheduleContext = ContextBuilder.buildCoreContext(
            { ...character, mountedWorldbooks: [] },
            user,
            true,
            undefined,
            undefined,
            {
                skipTimeAwareness: true,
                worldbookMode: 'online',
                resolvedWorldbookEntries: resolved,
                includeAtDepthWorldbooks: true,
            },
        );
        expect(scheduleContext).toContain('今天记得留意一个小小的变化。');
        expect(scheduleContext).toContain('指定深度提醒');
    });
});
