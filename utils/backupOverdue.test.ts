/**
 * isBackupOverdue 的行为钉子。
 *
 * 这个判定管的是「桌面上那条常驻提示亮不亮」，跟 shouldShowBackupReminder（管弹窗、
 * 有冷却）分工不同。最要紧的一条：**关掉弹窗不能让它熄灭，只有真备份才能**。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    isBackupOverdue,
    shouldShowBackupReminder,
    markBackupDone,
    markBackupReminderShown,
    setBackupReminderIntervalDays,
    getBackupReminderState,
} from './backupReminder';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

beforeEach(() => {
    localStorage.clear();
});

/** 把「首次见到这台设备」锚到 T0，模拟一个已经用了一阵子的用户。 */
const seed = (over: Partial<{ intervalDays: number; lastBackupAt: number }> = {}) => {
    localStorage.setItem('sullyos_backup_reminder', JSON.stringify({
        intervalDays: over.intervalDays ?? 1,
        lastBackupAt: over.lastBackupAt ?? T0,
        lastRemindedAt: 0,
        firstSeenAt: T0,
    }));
};

describe('isBackupOverdue', () => {
    it('刚备份完 → 不过期', () => {
        seed({ lastBackupAt: T0 });
        expect(isBackupOverdue(T0 + 3600_000)).toBe(false);
    });

    it('间隔设 1 天时，满 24 小时就过期', () => {
        seed({ intervalDays: 1, lastBackupAt: T0 });
        expect(isBackupOverdue(T0 + DAY - 1)).toBe(false);
        expect(isBackupOverdue(T0 + DAY)).toBe(true);
    });

    it('关掉弹窗（markBackupReminderShown）不会让常驻提示熄灭', () => {
        seed({ intervalDays: 1, lastBackupAt: T0 });
        const now = T0 + 3 * DAY;
        expect(isBackupOverdue(now)).toBe(true);

        markBackupReminderShown(now);

        // 弹窗进入冷却了……
        expect(shouldShowBackupReminder(now)).toBe(false);
        // ……但常驻提示照亮不误。这就是这次改动的全部意义。
        expect(isBackupOverdue(now)).toBe(true);
    });

    it('真备份一次才会熄灭', () => {
        seed({ intervalDays: 1, lastBackupAt: T0 });
        const now = T0 + 3 * DAY;
        expect(isBackupOverdue(now)).toBe(true);

        markBackupDone(now); // exportSystem 成功后调的就是它（本地导出 / 云备份都走这条）

        expect(isBackupOverdue(now)).toBe(false);
        expect(getBackupReminderState(now).lastBackupAt).toBe(now);
    });

    it('从未备份过时按 firstSeenAt 起算，新用户不会一进门就亮红灯', () => {
        localStorage.setItem('sullyos_backup_reminder', JSON.stringify({
            intervalDays: 1, lastBackupAt: 0, lastRemindedAt: 0, firstSeenAt: T0,
        }));
        expect(isBackupOverdue(T0 + 3600_000)).toBe(false);
        expect(isBackupOverdue(T0 + 2 * DAY)).toBe(true);
    });

    it('改间隔立刻生效，不用重开 App', () => {
        seed({ intervalDays: 7, lastBackupAt: T0 });
        const now = T0 + 2 * DAY;
        expect(isBackupOverdue(now)).toBe(false);

        setBackupReminderIntervalDays(1, now);

        expect(isBackupOverdue(now)).toBe(true);
    });
});
