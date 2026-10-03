/**
 * 见面立绘模式「编辑当前这句」的纯逻辑：屏幕上这句 → 原消息的第几行，以及把那一行换掉。
 *
 * 立绘台词队列里只有清洗后的文字（去掉了 [emotion] / [v:xxx] 等标签），没有记它来自哪一行，
 * 所以反查用「同一个解析器把每一行单独解析一遍，看谁吐出这句」。同一句话在本批里出现多次时，
 * 按它是第几次出现去对原文里第几次出现。行首的标签原样保留，用户只改正文。
 */

export interface DateLineSource {
    id: number;
    role: string;
    content: string;
}

export interface LocatedDateLine<M extends DateLineSource> {
    message: M;
    lineIndex: number;
    /** 行首的 [emotion] [v:xxx] 等标签（含其后的空格），保存时原样拼回去 */
    prefix: string;
    /** 用户可编辑的正文部分 */
    body: string;
}

const LEADING_TAGS_RE = /^(\s*(?:\[[^\]\n]*\]\s*)*)([\s\S]*)$/;

export const locateDateDialogueLine = <M extends DateLineSource>(args: {
    /** 按时间正序的消息；只在角色消息里找，越新越优先 */
    messages: M[];
    batchTexts: string[];
    index: number;
    parseLine: (line: string) => Array<{ text: string }>;
    /** 额外排除的消息（比如见面里的手机消息桥接） */
    exclude?: (message: M) => boolean;
    maxMessages?: number;
}): LocatedDateLine<M> | null => {
    const text = args.index >= 0 ? args.batchTexts[args.index] : undefined;
    if (!text) return null;
    const occurrence = args.batchTexts.slice(0, args.index).filter(other => other === text).length;
    const candidates = args.messages
        .filter(message => message.role === 'assistant' && typeof message.content === 'string' && !args.exclude?.(message))
        .slice(-(args.maxMessages ?? 40))
        .reverse();
    for (const message of candidates) {
        const lines = message.content.split('\n');
        let seen = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (!args.parseLine(lines[lineIndex]).some(parsed => parsed.text === text)) continue;
            if (seen < occurrence) { seen += 1; continue; }
            const match = lines[lineIndex].match(LEADING_TAGS_RE);
            return { message, lineIndex, prefix: match?.[1] ?? '', body: match?.[2] ?? lines[lineIndex] };
        }
    }
    return null;
};

/** 把定位到的那一行换成「原标签 + 新正文」；正文里的换行压成空格（一行一念，换行会拆成两句）。 */
export const replaceDateDialogueLine = (content: string, lineIndex: number, prefix: string, body: string): string | null => {
    const cleaned = body.replace(/\n+/g, ' ').trim();
    if (!cleaned) return null;
    const lines = content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return null;
    lines[lineIndex] = `${prefix}${cleaned}`;
    return lines.join('\n');
};
