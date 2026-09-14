import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
    DB: {
        getDailySchedule: vi.fn(),
        saveDailySchedule: vi.fn(),
        deleteDailySchedule: vi.fn(),
    },
}));

import { DB } from './db';
import { getDailyScheduleForChar, getLocalDailySchedule } from './dailySchedule';
import type { CharacterProfile, DailySchedule, SchedulePlanningMeta } from '../types';

const originalTimeZone = process.env.TZ;
const getSchedule = vi.mocked(DB.getDailySchedule);
const saveSchedule = vi.mocked(DB.saveDailySchedule);
const deleteSchedule = vi.mocked(DB.deleteDailySchedule);

afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
});

beforeEach(() => {
    process.env.TZ = 'Asia/Shanghai';
    getSchedule.mockReset();
    saveSchedule.mockReset();
    deleteSchedule.mockReset();
});

const schedule = (
    date: string,
    generatedAt: number,
    planningMeta?: SchedulePlanningMeta,
): DailySchedule => ({
    id: `char-1_${date}`,
    charId: 'char-1',
    date,
    slots: [{ startTime: '08:00', activity: '早餐' }],
    generatedAt,
    ...(planningMeta ? { planningMeta } : {}),
});

const planningMeta = (
    date: string,
    extra: Partial<SchedulePlanningMeta> = {},
): SchedulePlanningMeta => ({
    schemaVersion: 1,
    seed: 123,
    generationId: `schedule-char-1-${date}-0-test`,
    rerollIndex: 0,
    variationClass: 'routine',
    careerFocus: 'none',
    ...extra,
});

describe('local daily schedule compatibility', () => {
    const losAngelesChar = {
        id: 'char-1',
        customTimezoneEnabled: true,
        customTimezone: 'America/Los_Angeles',
    } as CharacterProfile;

    it('loads the character-local date key instead of the phone date', async () => {
        const at = new Date('2026-07-20T16:30:00.000Z'); // 北京 7/21 00:30，洛杉矶 7/20 09:30
        const current = schedule('2026-07-20', at.getTime());
        getSchedule.mockResolvedValueOnce(current);

        await expect(getDailyScheduleForChar(losAngelesChar, at)).resolves.toBe(current);
        expect(getSchedule).toHaveBeenCalledWith('char-1', '2026-07-20');
    });

    it('rekeys a phone-date record when generatedAt belongs to the character-local day', async () => {
        const at = new Date('2026-07-20T16:30:00.000Z');
        const phoneKeyed = schedule('2026-07-21', at.getTime());
        getSchedule.mockResolvedValueOnce(null).mockResolvedValueOnce(phoneKeyed);

        const result = await getDailyScheduleForChar(losAngelesChar, at);
        expect(getSchedule).toHaveBeenNthCalledWith(1, 'char-1', '2026-07-20');
        expect(getSchedule).toHaveBeenNthCalledWith(2, 'char-1', '2026-07-21');
        expect(result?.date).toBe('2026-07-20');
        expect(saveSchedule).toHaveBeenCalledWith(expect.objectContaining({
            id: 'char-1_2026-07-20',
            date: '2026-07-20',
        }));
    });

    it('loads the China-local key directly', async () => {
        const at = new Date('2026-07-20T16:30:00.000Z'); // 北京 7/21 00:30
        const current = schedule('2026-07-21', at.getTime());
        getSchedule.mockResolvedValueOnce(current);

        await expect(getLocalDailySchedule('char-1', at)).resolves.toBe(current);
        expect(getSchedule).toHaveBeenCalledWith('char-1', '2026-07-21');
        expect(saveSchedule).not.toHaveBeenCalled();
    });

    it('rekeys a legacy UTC record only when generated on the current local day', async () => {
        const at = new Date('2026-07-20T16:30:00.000Z');
        const legacy = schedule('2026-07-20', at.getTime());
        getSchedule.mockResolvedValueOnce(null).mockResolvedValueOnce(legacy);

        const result = await getLocalDailySchedule('char-1', at);
        expect(result?.date).toBe('2026-07-21');
        expect(result?.id).toBe('char-1_2026-07-21');
        expect(saveSchedule).toHaveBeenCalledWith(expect.objectContaining({
            id: 'char-1_2026-07-21',
            date: '2026-07-21',
        }));
    });

    it('迁移是搬走旧 key，不是留一份副本', async () => {
        const at = new Date('2026-07-20T16:30:00.000Z');
        const phoneKeyed = schedule('2026-07-21', at.getTime());
        getSchedule.mockResolvedValueOnce(null).mockResolvedValueOnce(phoneKeyed);

        await getDailyScheduleForChar(losAngelesChar, at);

        // 留着 char-1_2026-07-21 的话，等洛杉矶日历翻到 7/21 会被再取一次，
        // 同一份日程就被当成 7/20 和 7/21 两天用了。
        expect(deleteSchedule).toHaveBeenCalledWith('char-1', '2026-07-21');
    });

    it('key 撞上了但内容是角色那边昨天生成的，不能直接拿来用', async () => {
        // 开自定义时区之前按手机日写下 char-1_2026-07-21：
        // 写入那刻北京是 7/21 00:30，洛杉矶还是 7/20 09:30。
        const writtenAt = new Date('2026-07-20T16:30:00.000Z');
        const staleButSameKey = schedule('2026-07-21', writtenAt.getTime());
        // 读取时洛杉矶已经翻到 7/21，localKey 正好等于那份残留记录的 key。
        const readAt = new Date('2026-07-21T18:00:00.000Z'); // 洛杉矶 7/21 11:00
        getSchedule.mockResolvedValue(staleButSameKey);

        await expect(getDailyScheduleForChar(losAngelesChar, readAt)).resolves.toBeNull();
        expect(saveSchedule).not.toHaveBeenCalled();
    });

    it('跨过角色午夜后保留带明确标记的明日预排表', async () => {
        const preplanned = schedule(
            '2026-07-21',
            new Date('2026-07-20T16:30:00.000Z').getTime(),
            planningMeta('2026-07-21', {
                planningAhead: true,
                targetDate: '2026-07-21',
            }),
        );
        const readAt = new Date('2026-07-21T18:00:00.000Z');
        getSchedule.mockResolvedValue(preplanned);

        await expect(getDailyScheduleForChar(losAngelesChar, readAt)).resolves.toBe(preplanned);
        expect(saveSchedule).not.toHaveBeenCalled();
        expect(deleteSchedule).not.toHaveBeenCalled();
    });

    it('不把目标日不一致的预排标记当成今天的日程', async () => {
        const mismatched = schedule(
            '2026-07-21',
            new Date('2026-07-20T16:30:00.000Z').getTime(),
            planningMeta('2026-07-21', {
                planningAhead: true,
                targetDate: '2026-07-22',
            }),
        );
        const readAt = new Date('2026-07-21T18:00:00.000Z');
        getSchedule.mockResolvedValue(mismatched);

        await expect(getDailyScheduleForChar(losAngelesChar, readAt)).resolves.toBeNull();
        expect(saveSchedule).not.toHaveBeenCalled();
    });

    it('兼容已上传旧版生成的无标记明日预排表，且不回写标记', async () => {
        const oldFormatPreplanned = schedule(
            '2026-09-16',
            new Date('2026-09-15T20:00:00.000Z').getTime(),
            planningMeta('2026-09-16'),
        );
        const readAt = new Date('2026-09-16T18:00:00.000Z');
        getSchedule.mockResolvedValue(oldFormatPreplanned);

        await expect(getDailyScheduleForChar(losAngelesChar, readAt)).resolves.toBe(oldFormatPreplanned);
        expect(saveSchedule).not.toHaveBeenCalled();
        expect(deleteSchedule).not.toHaveBeenCalled();
    });

    it('不把预排功能上线前的无标记旧表当成明日预排', async () => {
        const beforePreplanFeature = schedule(
            '2026-09-15',
            new Date('2026-09-14T07:00:00.000Z').getTime(),
            planningMeta('2026-09-15'),
        );
        const readAt = new Date('2026-09-15T18:00:00.000Z');
        getSchedule.mockResolvedValue(beforePreplanFeature);

        await expect(getDailyScheduleForChar(losAngelesChar, readAt)).resolves.toBeNull();
        expect(saveSchedule).not.toHaveBeenCalled();
    });

    it('does not rewrite a genuinely historical legacy record', async () => {
        const at = new Date('2026-07-20T16:30:00.000Z');
        const historical = schedule('2026-07-20', new Date('2026-07-20T02:00:00.000Z').getTime());
        getSchedule.mockResolvedValueOnce(null).mockResolvedValueOnce(historical);

        await expect(getLocalDailySchedule('char-1', at)).resolves.toBeNull();
        expect(saveSchedule).not.toHaveBeenCalled();
    });
});
