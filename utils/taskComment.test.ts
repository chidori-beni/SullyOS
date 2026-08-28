import { describe, expect, it } from 'vitest';
import { extractTaskComment, formatTaskComment, isTaskCommentUsable } from './taskComment';

describe('task comment response cleanup', () => {
    it('rejects a mode name instead of showing it as a comment', () => {
        expect(extractTaskComment('平时用语')).toBeNull();
        expect(extractTaskComment('【平时用语】')).toBeNull();
        expect(extractTaskComment(',留学生 in Tokyo')).toBeNull();
        expect(extractTaskComment('【留学生intokyo】')).toBeNull();
        expect(extractTaskComment('留学生 in Tokyo：便利店')).toBeNull();
        expect(extractTaskComment('想吃')).toBeNull();
        expect(extractTaskComment('还算')).toBeNull();
        expect(extractTaskComment('Due date:')).toBeNull();
        expect(extractTaskComment('Due date: 2026-08-28')).toBeNull();
        expect(extractTaskComment('Deadline')).toBeNull();
        expect(extractTaskComment('萧逸 (Xiao Yi)’s')).toBeNull();
        expect(extractTaskComment('萧逸 (Xiao Yi)’s:')).toBeNull();
        expect(extractTaskComment('萧逸（Xiao Yi）的')).toBeNull();
        expect(extractTaskComment('反派大Boss采购完述')).toBeNull();
        expect(extractTaskComment('挑好想吃的热便当')).toBeNull();
        expect(isTaskCommentUsable('平时用语')).toBe(false);
    });

    it('unwraps metadata labels and keeps the actual sentence', () => {
        expect(extractTaskComment('平时用语：记得带伞，别淋成落汤猫。')).toBe('记得带伞，别淋成落汤猫。');
        expect(extractTaskComment('平时用语\n记得带伞，别淋成落汤猫。')).toBe('记得带伞，别淋成落汤猫。');
        expect(extractTaskComment('{"平时用语":"先把这件事记下，慢慢来。"}')).toBe('先把这件事记下，慢慢来。');
    });

    it('preserves a normal sentence and strips presentation wrappers', () => {
        expect(extractTaskComment('「去买东西的时候，顺手给自己带点喜欢的。」')).toBe('去买东西的时候，顺手给自己带点喜欢的。');
        expect(extractTaskComment('')).toBeNull();
    });

    it('keeps a natural longer sentence instead of truncating it at forty characters', () => {
        const sentence = '今天把这件事完成得很漂亮，先去便利店补充一点喜欢的东西，再回来好好休息吧。';
        expect(extractTaskComment(sentence)).toBe(sentence);
    });

    it('requires a complete sentence and adds the speaker name once', () => {
        expect(extractTaskComment('今天也辛苦了，买完东西就早点回家休息。')).toBe('今天也辛苦了，买完东西就早点回家休息。');
        expect(extractTaskComment('今天也辛苦了，买完东西就早点回家休息')).toBeNull();
        expect(formatTaskComment('萧逸', '今天也辛苦了，买完东西就早点回家休息。')).toBe('萧逸：今天也辛苦了，买完东西就早点回家休息。');
        expect(formatTaskComment('萧逸', '萧逸：今天也辛苦了，买完东西就早点回家休息。')).toBe('萧逸：今天也辛苦了，买完东西就早点回家休息。');
    });
});
