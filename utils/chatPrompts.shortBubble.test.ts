import { describe, it, expect } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { SHORT_BUBBLE_HEADING } from './chatBubbleStyle';

const build = (char: any) => ChatPrompts.buildSystemPromptParts(
    { id: 'char-short-bubble', name: '阿一', ...char } as any,
    { name: '条条' } as any,
    [], [], [], [],
);

describe('聊天「短气泡」开关', () => {
    it('缺省开：recencyTail 里补一句一个气泡的提醒，且排在「回到你自己」之前', async () => {
        const parts = await build({});
        expect(parts.recencyTail).toContain(SHORT_BUBBLE_HEADING);
        expect(parts.recencyTail).toContain('不要用空格把几句话串在同一行里');
        expect(parts.recencyTail.indexOf(SHORT_BUBBLE_HEADING))
            .toBeLessThan(parts.recencyTail.indexOf('### 最后，回到你自己'));
        expect(parts.stable).toContain('偶尔可以发长段');
    });

    it('关掉：不补提醒，回到「允许长句」的旧写法', async () => {
        const parts = await build({ shortBubbleStyleEnabled: false });
        expect(parts.recencyTail).not.toContain(SHORT_BUBBLE_HEADING);
        expect(parts.stable).toContain('允许长句');
    });
});
