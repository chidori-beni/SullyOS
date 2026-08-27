import { describe, it, expect } from 'vitest';
import {
    buildXinshengContinuityBlock,
    buildXinshengInstruction,
    selectXinshengContinuity,
} from './xinshengPrompt';
import type { XinshengEntry } from './xinshengData';

const entry = (over: Partial<XinshengEntry>): XinshengEntry => ({
    innerVoice: '', statusText: '', temperature: '36.5°C', emotionLevel: 70,
    moodDelta: null, weather: null, location: null, activity: null, raw: null,
    ...over,
});

describe('buildXinshengInstruction', () => {
    it('关着时一个字都不加', () => {
        expect(buildXinshengInstruction({ enabled: false, customPrompt: 'x' })).toBe('');
    });

    it('内置指令带上锚点与字段规则', () => {
        const s = buildXinshengInstruction({ enabled: true });
        expect(s).toContain('{"t":"xinsheng"');
        expect(s).toContain('innerVoice');
        expect(s).toContain('emotionLevel');
        expect(s).toContain('Chinese');
    });

    it('自定义提示词会被包上「最后一行 + 必须以 {"t":"xinsheng" 开头」两条硬约束', () => {
        const s = buildXinshengInstruction({ enabled: true, customPrompt: '  只输出 27 个字段  ' });
        expect(s).toContain('It MUST start with {"t":"xinsheng"');
        expect(s).toContain('LAST line');
        expect(s).toContain('只输出 27 个字段');
        // 自定义时不再塞内置字段说明，否则模型会两套字段混着写
        expect(s).not.toContain('emotional body temp');
    });
});

describe('selectXinshengContinuity', () => {
    const now = Date.parse('2026-08-27T12:00:00Z');
    const history = {
        xs_1756000000000_aaa: entry({ innerVoice: '最旧', _at: now - 3 * 3600_000 }),
        xs_1756000100000_bbb: entry({ innerVoice: '中间', statusText: '看窗外', _at: now - 30 * 60_000 }),
        xs_1756000200000_ccc: entry({ innerVoice: '最新', _at: now - 30_000 }),
        xs_1755000000000_ddd: entry({ innerVoice: '更旧', _at: now - 5 * 3600_000 }),
    };

    it('留空 = 一条都不给（角色完全看不到自己的心声）', () => {
        expect(selectXinshengContinuity(history, '', now)).toEqual([]);
        expect(selectXinshengContinuity(history, '   ', now)).toEqual([]);
    });

    it('只取最近 3 轮，从新到旧', () => {
        const r = selectXinshengContinuity(history, 'innerVoice', now);
        expect(r.map(x => x.fields.innerVoice)).toEqual(['最新', '中间', '最旧']);
    });

    it('只挑列出的字段', () => {
        const r = selectXinshengContinuity(history, 'innerVoice, statusText', now);
        expect(r[1].fields).toEqual({ innerVoice: '中间', statusText: '看窗外' });
        expect(r[0].fields).toEqual({ innerVoice: '最新' });
    });

    it('字段全空的那一轮直接跳过', () => {
        const r = selectXinshengContinuity({ xs_1: entry({ _at: now }) } as any, 'innerVoice', now);
        expect(r).toEqual([]);
    });

    it('ageMin 按分钟算', () => {
        const r = selectXinshengContinuity(history, 'innerVoice', now);
        expect(r[0].ageMin).toBe(1);  // 30 秒 → 四舍五入 1 分钟
        expect(r[1].ageMin).toBe(30);
        expect(r[2].ageMin).toBe(180);
    });
});

describe('buildXinshengContinuityBlock', () => {
    it('没内容就返回空串', () => {
        expect(buildXinshengContinuityBlock([])).toBe('');
        expect(buildXinshengContinuityBlock([{ fields: {}, ageMin: 1 }])).toBe('');
    });

    it('渲染成 [INNER-CONTINUITY] 段，时间用人话', () => {
        const s = buildXinshengContinuityBlock([
            { fields: { innerVoice: '想你' }, ageMin: 0 },
            { fields: { innerVoice: '累了' }, ageMin: 45 },
            { fields: { innerVoice: '还好' }, ageMin: 200 },
            { fields: { innerVoice: '很久前' }, ageMin: 3000 },
        ]);
        expect(s).toContain('[INNER-CONTINUITY]');
        expect(s).toContain('· (just now) innerVoice="想你"');
        expect(s).toContain('(45min ago)');
        expect(s).toContain('(3h ago)');
        expect(s).toContain('(2d ago)');
    });

    it('字段值里的双引号被转义，不会撑破这行的引号配对', () => {
        const s = buildXinshengContinuityBlock([{ fields: { innerVoice: '他说"好"' }, ageMin: 1 }]);
        expect(s).toContain('innerVoice="他说\\"好\\""');
    });

    it('超长字段被截断到 80 字', () => {
        const s = buildXinshengContinuityBlock([{ fields: { innerVoice: 'あ'.repeat(200) }, ageMin: 1 }]);
        expect(s).toContain('あ'.repeat(80));
        expect(s).not.toContain('あ'.repeat(81));
    });
});
