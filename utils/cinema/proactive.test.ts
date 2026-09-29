import { describe, expect, it } from 'vitest';
import {
    appendCinemaNote, buildCinemaInstruction, isPictureMovingSince, mergeCinemaStatus, buildProactiveNudge, CINEMA_NOTES_KEEP, decideProactive, isSilentReply,
    PROACTIVE_GAP_MS, PROACTIVE_PAUSE_MS, PROACTIVE_USER_QUIET_MS, type ProactiveState,
} from './cinema';

const now = 100_000_000;
const gap = PROACTIVE_GAP_MS.normal;
const base = (over: Partial<ProactiveState> = {}): ProactiveState => ({
    level: 'normal', now,
    lastUserAt: now - gap * 3, lastCharAt: now - gap - 1,
    scenesSinceChar: 0, paused: false, pauseHandled: false, blocked: false,
    ...over,
});

describe('该不该主动开口', () => {
    it('换过场景、离上次开口够久 → 因为换场景开口', () => {
        expect(decideProactive(base({ scenesSinceChar: 2 }))).toBe('scene');
    });

    it('离上次开口不够久就不说', () => {
        expect(decideProactive(base({ scenesSinceChar: 2, lastCharAt: now - gap + 1000 }))).toBeNull();
    });

    it('没换场景，但两人很久没说话 → 找点话说', () => {
        expect(decideProactive(base({ lastCharAt: now - gap * 2 - 1 }))).toBe('silence');
        expect(decideProactive(base())).toBeNull();
    });

    it('用户刚说过话、正在打字 / 角色正在回 / 电脑没连上，都不开口', () => {
        expect(decideProactive(base({ scenesSinceChar: 1, lastUserAt: now - PROACTIVE_USER_QUIET_MS + 1 }))).toBeNull();
        expect(decideProactive(base({ scenesSinceChar: 1, blocked: true }))).toBeNull();
    });

    it('「不主动」就永远不开口', () => {
        expect(decideProactive(base({ level: 'off', scenesSinceChar: 5, lastCharAt: 0 }))).toBeNull();
    });

    it('暂停超过 15 秒问一句，同一次暂停只问一次，暂停中不因为换场景开口', () => {
        const pausedLong = { paused: true, pausedSince: now - PROACTIVE_PAUSE_MS - 1 };
        expect(decideProactive(base(pausedLong))).toBe('pause');
        expect(decideProactive(base({ ...pausedLong, pauseHandled: true, scenesSinceChar: 3 }))).toBeNull();
        expect(decideProactive(base({ paused: true, pausedSince: now - 5000 }))).toBeNull();
    });

    it('话痨比安静说得勤', () => {
        const at = (level: ProactiveState['level'], ago: number) => decideProactive(base({ level, scenesSinceChar: 1, lastCharAt: now - ago }));
        expect(at('chatty', PROACTIVE_GAP_MS.chatty + 1)).toBe('scene');
        expect(at('quiet', PROACTIVE_GAP_MS.chatty + 1)).toBeNull();
    });
});

describe('角色选择安静', () => {
    it('只回「[安静]」算安静，混在话里不算', () => {
        expect(isSilentReply('[安静]')).toBe(true);
        expect(isSilentReply('  【安静】 ')).toBe(true);
        expect(isSilentReply('<think>没啥好说</think>[安静]')).toBe(true);
        expect(isSilentReply('这里好安静啊')).toBe(false);
    });
});

describe('主动开口的提示词', () => {
    it('临时提示写明没人说话、为什么、附了画面', () => {
        expect(buildProactiveNudge('scene', true)).toBe('（这一轮没有人跟你说话。画面换了一个场景，这是此刻屏幕上的画面。）');
    });

    it('带上最近的画面笔记和「可以选择安静」', () => {
        const notes = Array.from({ length: 12 }, (_, i) => ({ at: i, videoTime: i * 60, text: `笔记${i}` }));
        const text = buildCinemaInstruction({
            userName: '千夜', charName: '萧逸', hasFrame: true, status: null,
            session: { title: '钟表馆事件', spoiler: 'first' }, notes, proactive: 'silence',
        });
        expect(text).toContain('最近的画面笔记');
        expect(text).toContain('笔记11');
        expect(text).not.toContain('笔记3'); // 只带最近 8 条
        expect(text).toContain('这一轮没人跟你说话');
        expect(text).toContain('[安静]');
    });

    it('用户自己说话那一轮，不出现主动开口那段', () => {
        const text = buildCinemaInstruction({ userName: '千夜', charName: '萧逸', hasFrame: false, status: null, session: { title: 'x', spoiler: 'first' } });
        expect(text).not.toContain('这一轮没人跟你说话');
    });

    it('笔记最多存 30 条', () => {
        let notes: any[] = [];
        for (let i = 0; i < 40; i += 1) notes = appendCinemaNote(notes, { at: i, text: String(i) });
        expect(notes).toHaveLength(CINEMA_NOTES_KEEP);
        expect(notes[0].text).toBe('10');
    });
});

describe('画面在动就不算暂停（09-30 实测：没点暂停，角色却问「怎么停在这了」）', () => {
    const t = 50_000_000;
    const share = { mode: 'share' as const, sharing: true, at: t };
    const stalePaused = { mode: 'site' as const, site: 'B站', time: 300, paused: true, at: t - 10 * 60_000 };

    it('小插件说暂停之后画面又换了两次场景 → 不信它', () => {
        const scenes = [t - 60_000, t - 20_000];
        expect(isPictureMovingSince(scenes, stalePaused.at)).toBe(true);
        expect(mergeCinemaStatus(share, stalePaused, t, scenes)).toBe(share);
    });

    it('刚按暂停时弹出暂停图标算一次换场景，一次不够推翻暂停', () => {
        const justPaused = { ...stalePaused, at: t - 10_000 };
        expect(mergeCinemaStatus(share, justPaused, t, [t - 5000])).toMatchObject({ paused: true });
    });

    it('没有换场景就照信小插件的暂停', () => {
        expect(mergeCinemaStatus(share, stalePaused, t, [])).toMatchObject({ paused: true, site: 'B站' });
    });

    it('小插件说在播放，画面动不动都照信', () => {
        const playing = { ...stalePaused, paused: false, at: t - 5000 };
        expect(mergeCinemaStatus(share, playing, t, [t - 1000, t - 500])).toMatchObject({ paused: false, time: 300 });
    });
});
