import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    'utf8',
).replace(/\r\n?/g, '\n');

describe('日程重抽临时要求接线', () => {
    it('点击重抽先打开可空的自定义输入层，不直接调用生成器', () => {
        const modals = read('../components/chat/ChatModals.tsx');

        expect(modals).toContain('scheduleRerollPromptOpen');
        expect(modals).toContain('maxLength={SCHEDULE_REROLL_REQUIREMENT_MAX_LENGTH}');
        expect(modals).toContain('onReroll={onScheduleReroll ? () => setScheduleRerollPromptOpen(true) : undefined}');
        expect(modals).toContain('这个要求只影响本次日程，不会改角色设定');
        expect(modals).toContain('onScheduleReroll?.(requirement)');
    });

    it('聊天侧把临时要求作为一次性生成参数传下去', () => {
        const chat = read('../apps/Chat.tsx');
        const generator = read('./scheduleGenerator.ts');

        expect(chat).toContain('rerollRequirement?: string');
        expect(chat).toContain('rerollRequirement ? { rerollRequirement } : undefined');
        expect(generator).toContain('options?: { rerollRequirement?: string }');
        expect(generator).toContain('userRequirementApplied: Boolean(rerollRequirement)');
        expect(generator).not.toContain('rerollRequirement: rerollRequirement');
    });
});
