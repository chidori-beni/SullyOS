import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { memoryDayKey, readableContextMemories, recentMemoryWindowStart } from './contextMemories';
import { ContextBuilder } from './context';
import { runRecall } from './agenticTools';
import { buildToolPack } from './amsgToolPack';

const user = { name: '测试用户', bio: '', avatar: '' } as UserProfile;
const base = new Date(2026, 8, 28, 12, 0, 0); // 2026-09-28 本地中午
const mem = (date: string, summary: string) => ({ id: summary, date, summary, mood: '好' });
const character = (extra: Partial<CharacterProfile> = {}) => ({
    id: 'recent', name: '角色', avatar: '', systemPrompt: '设定',
    activeMemoryMonths: ['2026-08', '2026-09'],
    memories: [
        mem('2026-08-30', '八月底'),
        mem('2026年9月1日', '九月初'),
        mem('2026/9/22', '七天前'),
        mem('2026-09-27', '昨天'),
        mem('2026-09-28', '今天'),
        mem('2026-09', '没有日'),
    ],
    ...extra,
} as CharacterProfile);

describe('小眼睛 · 只发最近 N 天', () => {
    it('parses the three date spellings', () => {
        expect(memoryDayKey('2026年9月1日')).toBe('2026-09-01');
        expect(memoryDayKey('2026/9/22')).toBe('2026-09-22');
        expect(memoryDayKey('2026-09-27')).toBe('2026-09-27');
        expect(memoryDayKey('2026-09')).toBeNull();
    });

    it('unset / 0 keeps the whole month (old behaviour)', () => {
        for (const extra of [{}, { recentMemoryDays: 0 }]) {
            const daily = readableContextMemories(character(extra), true, base).daily;
            expect(daily.flatMap(g => g.entries).map(e => e.summary)).toEqual(['八月底', '九月初', '七天前', '昨天', '今天', '没有日']);
        }
    });

    it('N=7 counts today as day 1 and applies across open months', () => {
        const char = character({ recentMemoryDays: 7 });
        expect(recentMemoryWindowStart(char, base)).toBe('2026-09-22');
        const daily = readableContextMemories(char, true, base).daily;
        expect(daily.find(g => g.month === '2026-08')!.entries).toHaveLength(0);
        // 读不出「日」的条目保留，宁可多发不悄悄丢
        expect(daily.find(g => g.month === '2026-09')!.entries.map(e => e.summary)).toEqual(['七天前', '昨天', '今天', '没有日']);
    });

    it('window reaches into last month when that eye is still open', () => {
        const daily = readableContextMemories(character({ recentMemoryDays: 30 }), true, base).daily;
        expect(daily.find(g => g.month === '2026-08')!.entries.map(e => e.summary)).toEqual(['八月底']);
    });

    it('closed eyes still send nothing; monthly summaries unaffected', () => {
        const char = character({ recentMemoryDays: 3, activeMemoryMonths: [], refinedMemories: { '2026-08': '八月总结' } });
        const out = readableContextMemories(char, true, base);
        expect(out.daily).toHaveLength(0);
        expect(out.monthly).toEqual([{ date: '2026-08', summary: '八月总结' }]);
    });

    it('prompt tells the model the window is partial', () => {
        const text = ContextBuilder.buildCharacterContext({ char: character({ recentMemoryDays: 3 }), user }).coreContext;
        expect(text).toContain('仅最近 3 天');
    });

    it('RECALL of an eye-open month still returns the whole month when windowed', async () => {
        const windowed = await runRecall({ year: '2026', month: '9' }, { char: character({ recentMemoryDays: 3 }) } as any);
        expect(windowed.ok && !windowed.alreadyActive && windowed.logsText).toContain('九月初');
        const whole = await runRecall({ year: '2026', month: '9' }, { char: character() } as any);
        expect(whole.ok && whole.alreadyActive).toBe(true);
    });

    it('tool pack carries the window only when set', () => {
        expect(buildToolPack(character({ recentMemoryDays: 7 })).recentMemoryDays).toBe(7);
        expect('recentMemoryDays' in buildToolPack(character())).toBe(false);
    });
});
