/**
 * 把剧情正文按引号切段：“…” 「…」 ‘…’ 『…』 包住的部分（连同引号）标成 quote，
 * 其余是普通文字。只切段，不管样式——粗体 / 底色 / 字色由剧情外观面板决定。
 *
 * 引号不跨行：没配对的半个引号不会把后面几段全吞成高亮。
 * 嵌套时取最外层（「他说『好』」整段算一处）。
 */

export interface StoryTextSegment {
    text: string;
    quote: boolean;
}

const QUOTE_PATTERN = /“[^”\n]*”|「[^」\n]*」|‘[^’\n]*’|『[^』\n]*』/g;

export function splitStoryQuotes(text: string): StoryTextSegment[] {
    const segments: StoryTextSegment[] = [];
    let last = 0;
    for (const match of text.matchAll(QUOTE_PATTERN)) {
        const start = match.index ?? 0;
        if (start > last) segments.push({ text: text.slice(last, start), quote: false });
        segments.push({ text: match[0], quote: true });
        last = start + match[0].length;
    }
    if (last < text.length) segments.push({ text: text.slice(last), quote: false });
    return segments;
}
