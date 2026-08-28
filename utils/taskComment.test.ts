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
        expect(extractTaskComment('Must end with proper terminal punctuation (. ! ? ......')).toBeNull();
        expect(extractTaskComment('请只输出一句完整台词正文，必须以句末标点结束。')).toBeNull();
        expect(extractTaskComment('Deadline')).toBeNull();
        expect(extractTaskComment('萧逸 (Xiao Yi)’s')).toBeNull();
        expect(extractTaskComment('萧逸 (Xiao Yi)’s:')).toBeNull();
        expect(extractTaskComment('萧逸（Xiao Yi）的')).toBeNull();
        expect(extractTaskComment('反派大Boss采购完述')).toBe('反派大Boss采购完述');
        expect(extractTaskComment('挑好想吃的热便当')).toBe('挑好想吃的热便当');
        expect(isTaskCommentUsable('反派大Boss采购完述')).toBe(false);
        expect(isTaskCommentUsable('挑好想吃的热便当')).toBe(false);
        expect(isTaskCommentUsable('平时用语')).toBe(false);
    });

    it('unwraps metadata labels and keeps the actual sentence', () => {
        expect(extractTaskComment('平时用语：记得带伞，别淋成落汤猫。')).toBe('记得带伞，别淋成落汤猫。');
        expect(extractTaskComment('平时用语\n记得带伞，别淋成落汤猫。')).toBe('记得带伞，别淋成落汤猫。');
        expect(extractTaskComment('{"平时用语":"先把这件事记下，慢慢来。"}')).toBe('先把这件事记下，慢慢来。');
    });

    it('preserves a normal sentence and strips presentation wrappers', () => {
        expect(extractTaskComment('「去买东西的时候，顺手给自己带点喜欢的。」')).toBe('去买东西的时候，顺手给自己带点喜欢的。');
        // Regression: the previous one-sided wrapper regex produced
        // `便利店采购”已经...` by removing only the opening quote.
        expect(extractTaskComment('“便利店采购”已经完成了，辛苦你。')).toBe('便利店采购已经完成了，辛苦你。');
        expect(extractTaskComment('便利店采购”已经完成了，辛苦你。')).toBe('便利店采购已经完成了，辛苦你。');
        expect(extractTaskComment('"便利店采购"已经完成了，辛苦你。')).toBe('便利店采购已经完成了，辛苦你。');
        expect(extractTaskComment('便利店采购已经完成了，辛苦你。')).toBe('便利店采购已经完成了，辛苦你。');
        expect(extractTaskComment('')).toBeNull();
    });

    it('keeps a natural longer sentence instead of truncating it at forty characters', () => {
        const sentence = '今天把这件事完成得很漂亮，先去便利店补充一点喜欢的东西，再回来好好休息吧。';
        expect(extractTaskComment(sentence)).toBe(sentence);
        expect(isTaskCommentUsable(`${sentence}记得给自己留一点开心的时间。`)).toBe(true);
    });

    it('requires a complete sentence and adds the speaker name once', () => {
        expect(extractTaskComment('今天也辛苦了，买完东西就早点回家休息。')).toBe('今天也辛苦了，买完东西就早点回家休息。');
        expect(extractTaskComment('今天也辛苦了，买完东西就早点回家休息')).toBe('今天也辛苦了，买完东西就早点回家休息');
        expect(isTaskCommentUsable('今天也辛苦了，买完东西就早点回家休息')).toBe(false);
        expect(isTaskCommentUsable('今天也辛苦了，买完东西就早点回家休息。')).toBe(true);
        expect(formatTaskComment('萧逸', '今天也辛苦了，买完东西就早点回家休息。')).toBe('萧逸：今天也辛苦了，买完东西就早点回家休息。');
        expect(formatTaskComment('萧逸', '萧逸：今天也辛苦了，买完东西就早点回家休息。')).toBe('萧逸：今天也辛苦了，买完东西就早点回家休息。');
        expect(formatTaskComment('萧逸', '挑好想吃的热便当')).toBe('萧逸：挑好想吃的热便当');
    });
});
