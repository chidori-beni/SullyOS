import { describe, expect, it } from 'vitest';
import { splitStoryQuotes } from './storyQuoteHighlight';

const quotes = (text: string) => splitStoryQuotes(text).filter(s => s.quote).map(s => s.text);

describe('splitStoryQuotes', () => {
    it('四种引号都认', () => {
        expect(quotes('他说“你好”，又说「走吧」，‘嗯’，『好』。')).toEqual(['“你好”', '「走吧」', '‘嗯’', '『好』']);
    });

    it('切完拼回去和原文一字不差', () => {
        const text = '雨停了。“走吧。”他说。\n「等等」她回头';
        expect(splitStoryQuotes(text).map(s => s.text).join('')).toBe(text);
    });

    it('嵌套取最外层', () => {
        expect(quotes('「他说『好』就走了」')).toEqual(['「他说『好』就走了」']);
    });

    it('没配对的引号不跨行吞掉后文', () => {
        expect(quotes('“没说完\n第二段“这句”')).toEqual(['“这句”']);
    });

    it('没有引号时整段原样', () => {
        expect(splitStoryQuotes('安静的夜。')).toEqual([{ text: '安静的夜。', quote: false }]);
    });
});
