import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
    addReactionToMetadata,
    extractMessageReactionCommands,
    findReactionTarget,
    formatMessageReactionContext,
    getMessageReactions,
    parseReactionShortcutInput,
    stripMessageReactionTags,
    toggleReactionInMetadata,
} from './messageReactions';

const message = (id: number, role: Message['role'], content: string, timestamp = id): Message => ({
    id, charId: 'char-1', role, type: 'text', content, timestamp,
});

describe('message reactions', () => {
    it('提取任意 emoji + 目标片段并从正文移除', () => {
        expect(extractMessageReactionCommands('知道了\n[[REACT: 🫠 | 今天真的好累]]')).toEqual({
            text: '知道了', commands: [{ emoji: '🫠', target: '今天真的好累' }],
        });
        expect(extractMessageReactionCommands('[[REACT：❤️]]').commands).toEqual([{ emoji: '❤️' }]);
        expect(extractMessageReactionCommands('我就知道[REACT: 🙈 | 那好吧，我问吧。]')).toEqual({
            text: '我就知道', commands: [{ emoji: '🙈', target: '那好吧，我问吧。' }],
        });
        expect(extractMessageReactionCommands('[REACT: 🐶 | 蓬头狗面]').text).toBe('');
    });

    it('历史气泡显示时兼容清掉单层和双层 REACT 标签', () => {
        expect(stripMessageReactionTags('前文 [REACT: 🙈 | 目标] 后文 [[REACT: 🐶]]')).toBe('前文  后文 ');
    });

    it('按最新命中片段定位，找不到时回落到最近 user 消息', () => {
        const all = [message(1, 'user', '今天真的好累'), message(2, 'assistant', '抱抱'), message(3, 'user', '但晚饭很好吃')];
        expect(findReactionTarget(all, '好累')?.id).toBe(1);
        expect(findReactionTarget(all, '不存在')?.id).toBe(3);
    });

    it('用户可切换反应，角色添加同一反应时不会重复', () => {
        const once = toggleReactionInMetadata(undefined, '❤️', 'user', 10);
        expect(getMessageReactions(once)).toHaveLength(1);
        expect(getMessageReactions(toggleReactionInMetadata(once, '❤️', 'user', 11))).toEqual([]);
        const assistantOnce = addReactionToMetadata(undefined, '🔥', 'assistant', 12);
        expect(addReactionToMetadata(assistantOnce, '🔥', 'assistant', 13)).toEqual(assistantOnce);
    });

    it('反应成为可读历史上下文；快捷栏接受连续或空格分隔 emoji', () => {
        const withReaction = { ...message(1, 'assistant', '好'), metadata: toggleReactionInMetadata(undefined, '🥺', 'user', 10) };
        expect(formatMessageReactionContext(withReaction, '小鹿', '小明')).toContain('小明用 🥺 回应了小鹿');
        expect(parseReactionShortcutInput('❤️ 🫠 👍')).toEqual(['❤️', '🫠', '👍']);
        expect(parseReactionShortcutInput('❤️😂')).toEqual(['❤️', '😂']);
    });
});
