import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../../types';
import {
    autonomousRetryDelayMinutes,
    computeDailyCheckpoint,
    computeNaturalDelayMinutes,
    createVRAutonomyPlan,
    deriveVRAutonomyProfile,
    getCharacterLocalDayKey,
    isVRAutonomyPlanDue,
    normalizeVRAutonomyPlan,
} from './autonomy';

const role = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-autonomy',
    name: '角色',
    description: '一个普通角色',
    systemPrompt: '',
    memories: [],
    ...overrides,
} as CharacterProfile);

describe('彼方角色自主活动画像', () => {
    it('性格只调节自然频率，不会把角色变成永不活动', () => {
        const outgoing = deriveVRAutonomyProfile(role({ description: '外向、好奇、精力旺盛，喜欢热闹和探索。' }));
        const quiet = deriveVRAutonomyProfile(role({ description: '安静、慢热，喜欢独处，习惯规律生活。' }));
        expect(outgoing.baseDelayMinutes).toBeLessThan(quiet.baseDelayMinutes);
        expect(outgoing.minDelayMinutes).toBeGreaterThanOrEqual(75);
        expect(outgoing.maxDelayMinutes).toBeLessThanOrEqual(8 * 60);
    });

    it('空闲时比轻度忙碌更容易安排下一次活动', () => {
        const profile = deriveVRAutonomyProfile(role());
        expect(computeNaturalDelayMinutes(profile, 'free', () => 0.5))
            .toBeLessThan(computeNaturalDelayMinutes(profile, 'light', () => 0.5));
    });
});

describe('彼方自主计划的每日软保障', () => {
    const now = Date.parse('2026-09-15T10:00:00Z');

    it('按角色时区计算当地日期和检查点', () => {
        const char = role({ customTimezoneEnabled: true, customTimezone: 'Asia/Tokyo' });
        expect(getCharacterLocalDayKey(now, 'Asia/Tokyo')).toBe('2026-09-15');
        const profile = deriveVRAutonomyProfile(char);
        const checkpoint = computeDailyCheckpoint(char.id, '2026-09-15', profile, 'Asia/Tokyo');
        expect(getCharacterLocalDayKey(checkpoint, 'Asia/Tokyo')).toBe('2026-09-15');
    });

    it('当天已经成功活动时，当前检查点移到下一当地日', () => {
        const char = role({ customTimezoneEnabled: true, customTimezone: 'Asia/Tokyo' });
        const plan = createVRAutonomyPlan({ char, now, lastActiveAt: now - 30 * 60_000, random: () => 0.5 });
        const normalized = normalizeVRAutonomyPlan(plan, { char, now: now + 2 * 60 * 60_000, lastActiveAt: now + 90 * 60_000 });
        expect(getCharacterLocalDayKey(normalized.dailyCheckpointAt, 'Asia/Tokyo'))
            .toBe('2026-09-16');
    });

    it('检查点已过但当天没有成功活动时，只安排一个短暂抖动，不回放旧账', () => {
        const char = role();
        const plan = createVRAutonomyPlan({ char, now, random: () => 0.5 });
        const late = Date.parse('2026-09-15T10:50:00Z');
        const overdue = createVRAutonomyPlan({ char, now: late, random: () => 0.5 });
        expect(overdue.dailyCheckpointAt - late).toBeGreaterThanOrEqual(5 * 60_000);
        expect(overdue.dailyCheckpointAt - late).toBeLessThanOrEqual(20 * 60_000);
        expect(isVRAutonomyPlanDue({ ...plan, dailyCheckpointAt: late - 1 }, late)).toBe(true);
    });
});

describe('彼方自主活动的顺延', () => {
    it('忙碌/睡眠重查比不可用状态更快，且不会变成零间隔重试', () => {
        expect(autonomousRetryDelayMinutes('schedule-busy', () => 0)).toBe(30);
        expect(autonomousRetryDelayMinutes('schedule-sleep', () => 0)).toBe(60);
        expect(autonomousRetryDelayMinutes('schedule-unavailable', () => 0)).toBe(90);
        expect(autonomousRetryDelayMinutes('schedule-busy', () => 0)).toBeGreaterThan(0);
    });
});
