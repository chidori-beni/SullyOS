import { describe, expect, it } from 'vitest';
import { DatePrompts } from './datePrompts';
import {
    parseObservationSceneClock,
    resolveDialogueSceneClock,
} from './dateObservationClock';

const TIME_ZONE = 'Asia/Tokyo';
const base = DatePrompts.parseSceneClockInput('2026-09-05 19:30', TIME_ZONE)!;

const clockText = (timestamp: number): string => DatePrompts.formatSceneClockInputValue(timestamp, TIME_ZONE).replace('T', ' ');

describe('date observation scene clock', () => {
    it.each([
        ['傍晚七点三十八分', '2026-09-05 19:38'],
        ['19时38分', '2026-09-05 19:38'],
        ['周六 19:38', '2026-09-05 19:38'],
        ['晚上八点左右', '2026-09-05 20:00'],
        ['7:38 PM', '2026-09-05 19:38'],
        ['8分钟后', '2026-09-05 19:38'],
        ['半小时后', '2026-09-05 20:00'],
    ])('解析 %s 为 %s', (value, expected) => {
        const parsed = parseObservationSceneClock(value, base, TIME_ZONE);
        expect(parsed).not.toBeNull();
        expect(clockText(parsed!.sceneClockAt)).toBe(expected);
    });

    it('不把没有时段限定的 1–12 点当成确定时间', () => {
        expect(parseObservationSceneClock('七点三十八分', base, TIME_ZONE)).toBeNull();
        expect(parseObservationSceneClock('一会儿后', base, TIME_ZONE)).toBeNull();
    });

    it('严格完整日期时间复用角色时区解析，并拒绝不可能的墙钟时间', () => {
        const parsed = parseObservationSceneClock('2026-09-05 19:38', base, TIME_ZONE);
        expect(parsed).not.toBeNull();
        expect(clockText(parsed!.sceneClockAt)).toBe('2026-09-05 19:38');
        expect(parseObservationSceneClock('2026-02-31 19:38', base, TIME_ZONE)).toBeNull();
    });

    it('普通回复只接受向前且不超过十二小时的推进', () => {
        const advanced = resolveDialogueSceneClock({
            rawContent: '[normal] 雨声小了。',
            observation: { time: '傍晚七点三十八分' },
            currentAt: base,
            currentAdvancedMs: 0,
            timeZone: TIME_ZONE,
        });
        expect(advanced.resolution).toBe('observation-exact');
        expect(advanced.advanced).toBe(true);
        expect(clockText(advanced.sceneClockAt)).toBe('2026-09-05 19:38');
        expect(advanced.sceneClockAdvancedDeltaMs).toBe(8 * 60_000);

        const backward = resolveDialogueSceneClock({
            rawContent: '正文',
            observation: { time: '晚上七点二十分' },
            currentAt: base,
            timeZone: TIME_ZONE,
        });
        expect(backward.resolution).toBe('backward-rejected');
        expect(backward.sceneClockAt).toBe(base);

        const far = resolveDialogueSceneClock({
            rawContent: '正文',
            observation: { time: '3天后' },
            currentAt: base,
            timeZone: TIME_ZONE,
        });
        expect(far.resolution).toBe('forward-rejected');
        expect(far.sceneClockAt).toBe(base);
    });

    it('同一分钟不因秒数而倒退，标签与观测冲突时不提交', () => {
        const sameMinute = resolveDialogueSceneClock({
            rawContent: '正文',
            observation: { time: '晚上七点三十分' },
            currentAt: base + 45_000,
            timeZone: TIME_ZONE,
        });
        expect(sameMinute.resolution).toBe('unchanged');
        expect(sameMinute.advanced).toBe(false);
        expect(sameMinute.sceneClockAt).toBe(base + 45_000);

        const conflict = resolveDialogueSceneClock({
            rawContent: '正文\n[[SCENE_CLOCK: 2026-09-05 19:40]]',
            observation: { time: '傍晚七点三十八分' },
            currentAt: base,
            timeZone: TIME_ZONE,
        });
        expect(conflict.resolution).toBe('conflict');
        expect(conflict.advanced).toBe(false);
        expect(conflict.content).toBe('正文');
    });

    it('缺失时间保持原时钟，严格标签可在 OBSERVE 缺失时推进', () => {
        const missing = resolveDialogueSceneClock({
            rawContent: '[normal] 继续说话。',
            currentAt: base,
            currentAdvancedMs: 12_000,
            timeZone: TIME_ZONE,
        });
        expect(missing.resolution).toBe('missing');
        expect(missing.sceneClockAt).toBe(base);
        expect(missing.sceneClockAdvancedMs).toBe(12_000);

        const tagged = resolveDialogueSceneClock({
            rawContent: '[normal] 继续说话。\n[[SCENE_CLOCK: 2026-09-05 19:38]]',
            currentAt: base,
            timeZone: TIME_ZONE,
        });
        expect(tagged.resolution).toBe('tag');
        expect(tagged.content).toBe('[normal] 继续说话。');
        expect(clockText(tagged.sceneClockAt)).toBe('2026-09-05 19:38');
    });
});
