import { describe, expect, it } from 'vitest';
import type { DailySchedule } from '../types';
import {
    buildScheduleFingerprint,
    buildSchedulePlan,
    formatSchedulePlanPrompt,
    normalizeScheduleRequirement,
} from './schedulePlanner';

const racer = {
    id: 'racer-1',
    description: '职业赛车手，生活规律但不喜欢每天一模一样。',
    systemPrompt: '重视车队训练和赛道测试，也要处理公开活动。',
    worldview: '',
    writerPersona: '',
    scheduleStyle: 'lifestyle' as const,
};

const commercialWorldbook = {
    id: 'career-book',
    content: '赛车手除了车辆测试和模拟训练，也会参加赞助商沟通、品牌拍摄和媒体采访。',
};

const schedule = (date: string, variationClass?: DailySchedule['planningMeta'] extends infer T
    ? T extends { variationClass: infer V } ? V : never : never): DailySchedule => ({
    id: `racer-1_${date}`,
    charId: 'racer-1',
    date,
    generatedAt: Date.parse(`${date}T08:00:00Z`),
    slots: [{ startTime: '10:00', activity: '车辆测试', description: '检查赛车设置' }],
    ...(variationClass ? {
        planningMeta: {
            schemaVersion: 1,
            seed: 1,
            generationId: `g-${date}`,
            rerollIndex: 0,
            variationClass,
            careerFocus: 'core' as const,
        },
    } : {}),
});

describe('日程本地规划器', () => {
    it('同一角色、日期和重抽次数得到同一计划，重抽会换种子', () => {
        const first = buildSchedulePlan({ char: racer, today: '2026-08-31', worldbookEntries: [commercialWorldbook] });
        const same = buildSchedulePlan({ char: racer, today: '2026-08-31', worldbookEntries: [commercialWorldbook] });
        const rerolled = buildSchedulePlan({ char: racer, today: '2026-08-31', rerollIndex: 1, worldbookEntries: [commercialWorldbook] });

        expect(same).toEqual(first);
        expect(rerolled.seed).not.toBe(first.seed);
    });

    it('职业设定明确有商业事务且近期没有出现时，要求安排次级职业活动', () => {
        const plan = buildSchedulePlan({
            char: racer,
            today: '2026-08-31',
            worldbookEntries: [commercialWorldbook],
            recentSchedules: [],
        });

        expect(plan.careerFocus).toBe('secondary');
        expect(plan.commercialActivityRequested).toBe(true);
        expect(formatSchedulePlanPrompt(plan)).toContain('必须在 slots 中安排至少一项商业');
    });

    it('没有职业或商业依据时不凭空要求职业活动', () => {
        const plan = buildSchedulePlan({
            char: { id: 'quiet-1', description: '喜欢看云和发呆', systemPrompt: '性格安静。' },
            today: '2026-08-31',
        });

        expect(plan.careerFocus).toBe('none');
        expect(plan.commercialActivityRequested).toBe(false);
    });

    it('会带出近期活动提示，并尽量避开最近的变化类型', () => {
        const first = buildSchedulePlan({ char: racer, today: '2026-08-30', worldbookEntries: [commercialWorldbook] });
        const next = buildSchedulePlan({
            char: racer,
            today: '2026-08-31',
            worldbookEntries: [commercialWorldbook],
            recentSchedules: [schedule('2026-08-30', first.variationClass)],
        });

        expect(next.recentActivityHints).toContain('车辆测试');
        expect(next.variationClass).not.toBe(first.variationClass);
    });

    it('日程指纹只依赖时间和活动，供去重使用', () => {
        expect(buildScheduleFingerprint([
            { startTime: '08:00', activity: '车辆测试' },
        ])).toBe(buildScheduleFingerprint([
            { startTime: '08:00', activity: '车辆测试' },
        ]));
        expect(buildScheduleFingerprint([
            { startTime: '08:00', activity: '车辆测试' },
        ])).not.toBe(buildScheduleFingerprint([
            { startTime: '08:00', activity: '品牌拍摄' },
        ]));
    });

    it('按角色当地星期和当前墙钟生成周末/时间约束，普通赛车手默认仍需睡眠', () => {
        const plan = buildSchedulePlan({
            char: racer,
            today: '2026-09-05',
            localWeekday: 6,
            wallClockMinutes: 4 * 60 + 7,
        });

        expect(plan.calendarMode).toBe('weekend');
        expect(plan.currentLocalTime).toBe('04:07');
        expect(plan.sleepMode).toBe('normal');
        expect(formatSchedulePlanPrompt(plan)).toContain('角色当地的周末');
        expect(formatSchedulePlanPrompt(plan)).toContain('当前时间是 04:07');
        expect(formatSchedulePlanPrompt(plan)).toContain('7-9 小时');
    });

    it('只有显式 no-sleep 配置才会关闭睡眠约束，普通职业设定不会自动豁免', () => {
        const plan = buildSchedulePlan({
            char: { ...racer, scheduleSleepMode: 'no-sleep' },
            today: '2026-09-02',
            localWeekday: 3,
        });

        expect(plan.sleepMode).toBe('no-sleep');
        expect(formatSchedulePlanPrompt(plan)).toContain('明确配置为 no-sleep');
    });

    it('一次性重抽要求会限长并只出现在提示词，不进入计划对象', () => {
        const plan = buildSchedulePlan({ char: racer, today: '2026-09-02' });
        const requirement = `  希望正常睡觉\n${'额外要求'.repeat(300)}  `;
        const normalized = normalizeScheduleRequirement(requirement);
        const prompt = formatSchedulePlanPrompt(plan, 'lifestyle', { rerollRequirement: requirement });

        expect(normalized).toBeTruthy();
        expect(normalized!.length).toBeLessThanOrEqual(500);
        expect(prompt).toContain('<schedule_user_request>');
        expect(prompt).toContain(normalized!);
        expect((plan as any).rerollRequirement).toBeUndefined();
    });
});
