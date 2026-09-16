import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { extractJson, parseCharBeat, resolvePlaceId, buildPlacesSection, worldDateOfRound, parseRolledFestivals, parseRolledThresholds, GENERIC_THRESHOLDS, buildHostPresenceSection, buildGhostwritePrompt, parseNpcScene, storyTimeLabel, buildModeRule, buildWorldGapNote, buildWorldCharTurn, buildNpcTurn, parseRolledNpcs, buildNpcRollPrompt, NARRATIVE_STYLES, narrationPersonGuide, realNowSeg, realObserveTarget, worldTimeLabel, formatRealClock, migrateWorldDaySegs, SEGMENTS_PER_DAY, worldNow, worldTzLabel, clampRealClockToNow, alignCharToWorldClock } from './prompts';
import { applyRelationshipDeltas, shareWorldCardTo, collectSeeds, buildSummary, dropDuplicatePosts, mirrorWorldBondsToChars, collectAppointments, buildPendingNotes, settlePendings, scheduleFestivals, buildFestivalNote, collectGifts, takeGifts } from './engine';
import { DB } from '../db';
import { buildGiftTasteNote, buildGiftHistoryNote } from '../characterIdentity';
import { ensureThreads, applyBeatToThreads, applyNpcGroupLines, applyNpcDms, npcInboxes, dmThreadsOf, groupThreadOf, formatThreadForPrompt, dmThreadId, GROUP_THREAD_ID } from './threads';
import { WorldScheduler } from './scheduler';
import type { CharacterProfile, WorldProfile } from '../../types';

// scheduler 的 attachListeners 会访问 document/window（node 环境下没有），补最简 stub。
const g = globalThis as any;
if (typeof g.document === 'undefined') g.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
if (typeof g.window === 'undefined') g.window = { addEventListener() {}, removeEventListener() {} };

const mkChar = (id: string, name: string): CharacterProfile => ({ id, name } as CharacterProfile);

const mkWorld = (overrides: Partial<WorldProfile> = {}): WorldProfile => ({
    id: 'w1', name: '栗子镇', worldview: '海边小镇', mode: 'light',
    memberIds: ['a', 'b'], npcs: [], houses: [], relationships: [],
    storyClock: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
});

describe('storyTimeLabel', () => {
    it('一天四段推进：早上/中午/晚上/凌晨（凌晨按次日称呼）', () => {
        expect(storyTimeLabel(0)).toBe('第1天早上');
        expect(storyTimeLabel(1)).toBe('第1天中午');
        expect(storyTimeLabel(2)).toBe('第1天晚上');
        expect(storyTimeLabel(3)).toBe('第2天凌晨'); // 第1天晚上熬过午夜 = 第2天凌晨
        expect(storyTimeLabel(4)).toBe('第2天早上');
        expect(storyTimeLabel(6)).toBe('第2天晚上');
    });
});

describe('migrateWorldDaySegs（三段制旧存档 → 四段制）', () => {
    it('sim 世界按「保持天数与段位」换算 storyClock/simSummarizedClock', () => {
        // 旧 45 = 第16天早上（45/3=15 天整）→ 新 15*4+0=60，仍是第16天早上
        const w = mkWorld({ timeMode: 'sim', storyClock: 45, simSummarizedClock: 60 });
        expect(migrateWorldDaySegs(w)).toBe(true);
        expect(w.storyClock).toBe(60);
        expect(w.simSummarizedClock).toBe(80); // 旧 60 = 20 天整 → 新 80
        expect(w.clockSegs).toBe(SEGMENTS_PER_DAY);
        expect(storyTimeLabel(w.storyClock)).toBe('第16天早上'); // 迁移前后天数/段位一致
    });
    it('real 世界不换算 storyClock（只是轮次计数），仅打标记', () => {
        const w = mkWorld({ timeMode: 'real', storyClock: 45 });
        expect(migrateWorldDaySegs(w)).toBe(true);
        expect(w.storyClock).toBe(45);
        expect(w.clockSegs).toBe(SEGMENTS_PER_DAY);
    });
    it('已迁移过的不重复处理', () => {
        const w = mkWorld({ timeMode: 'sim', storyClock: 60, clockSegs: SEGMENTS_PER_DAY });
        expect(migrateWorldDaySegs(w)).toBe(false);
        expect(w.storyClock).toBe(60);
    });
});

describe('extractJson', () => {
    it('解析 ```json 围栏', () => {
        expect(extractJson('前导文字\n```json\n{"a":1}\n```\n尾巴')).toEqual({ a: 1 });
    });
    it('解析裸 JSON（夹杂正文）', () => {
        expect(extractJson('我来啦 {"a":1} 完事')).toEqual({ a: 1 });
    });
    it('容忍尾逗号', () => {
        expect(extractJson('{"a":1,}')).toEqual({ a: 1 });
    });
    it('剥掉 <think> 块', () => {
        expect(extractJson('<think>{"x":9}</think>{"a":1}')).toEqual({ a: 1 });
    });
    it('解析失败返回 null', () => {
        expect(extractJson('完全不是 JSON')).toBeNull();
    });
});

describe('parseCharBeat', () => {
    const char = mkChar('a', '小满');
    const members = ['小满', '阿岚'];

    it('完整解析一拍', () => {
        const raw = JSON.stringify({
            location: '同居小屋的厨房',
            narrative: '小满把昨晚剩的汤热了。',
            mood: '松弛',
            statusPanel: { 体力: 72, 心情值: 88 },
            phone: { posts: ['今天的汤'], dms: [{ to: '阿岚', lines: ['汤好了，快回来'] }] },
            relationships: [{ with: '阿岚', delta: 2, reason: '一起吃了早饭' }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.location).toBe('同居小屋的厨房');
        expect(beat.mood).toBe('松弛');
        expect(beat.statusPanel).toEqual({ 体力: 72, 心情值: 88 });
        expect(beat.phone?.dms?.[0].to).toBe('阿岚');
        expect(beat.relationshipDeltas?.[0]).toMatchObject({ withName: '阿岚', delta: 2 });
    });

    it('JSON 解析失败时把原文兜底进 narrative，不丢内容', () => {
        const beat = parseCharBeat('她只是安静地坐在窗边，看了一下午的海。', char, members);
        expect(beat.narrative).toContain('看了一下午的海');
        expect(beat.charName).toBe('小满');
    });

    it('解析时间轴/备忘录/冲动/秘密（schema v3）', () => {
        const raw = JSON.stringify({
            location: '镇上', narrative: 'x'.repeat(50), mood: '复杂',
            timeline: [
                { time: '9:00', place: '画室', event: '画画', shared: true },
                { time: '11:30', place: '酒吧', event: '偷偷喝了一杯', shared: false },
                { event: '' }, // 无效条目被过滤
            ],
            memo: ['买颜料', '别忘了道歉'],
            impulse: { text: '想辞职', options: ['辞', '再忍忍'] },
            secrets: [{ text: '偷偷去了酒吧', hideFrom: ['阿岚', '陌生人'] }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.timeline).toHaveLength(2);
        expect(beat.timeline![1].shared).toBe(false);
        expect(beat.memo).toEqual(['买颜料', '别忘了道歉']);
        expect(beat.impulse).toEqual({ text: '想辞职', options: ['辞', '再忍忍'] });
        // hideFrom 只保留真实成员
        expect(beat.secrets).toEqual([{ text: '偷偷去了酒吧', hideFrom: ['阿岚'] }]);
    });

    it('解析当面对话与群聊发言，过滤非成员的对话对象', () => {
        const raw = JSON.stringify({
            location: '客厅', narrative: 'x', mood: 'y',
            dialogues: [{ with: '阿岚', lines: ['早啊'] }, { with: '路人', lines: ['?'] }],
            phone: { group: ['今天谁做饭'] },
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.dialogues).toEqual([{ with: '阿岚', lines: ['早啊'] }]);
        expect(beat.phone?.group).toEqual(['今天谁做饭']);
    });

    it('过滤非成员的私聊对象与关系对象，delta 截断到 ±4', () => {
        const raw = JSON.stringify({
            location: '镇上', narrative: 'x', mood: 'y',
            phone: { dms: [{ to: '陌生人', lines: ['?'] }, { to: '阿岚', lines: ['在吗'] }] },
            relationships: [{ with: '路人甲', delta: 3 }, { with: '阿岚', delta: 99 }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.phone?.dms).toHaveLength(1);
        expect(beat.relationshipDeltas).toHaveLength(1);
        expect(beat.relationshipDeltas?.[0].delta).toBe(4);
    });
});

describe('parseNpcScene', () => {
    it('解析 scene + hooks + 群聊冒泡', () => {
        const out = parseNpcScene('```json\n{"scene":"面包店飘香。","hooks":["老板娘多烤了一炉"],"groupLines":[{"name":"老板娘","line":"栗子包出炉咯"}]}\n```');
        expect(out.scene).toBe('面包店飘香。');
        expect(out.hooks).toEqual(['老板娘多烤了一炉']);
        expect(out.groupLines).toEqual([{ name: '老板娘', line: '栗子包出炉咯' }]);
    });
    it('解析失败时原文兜底', () => {
        const out = parseNpcScene('镇子很安静。');
        expect(out.scene).toBe('镇子很安静。');
        expect(out.hooks).toEqual([]);
        expect(out.groupLines).toEqual([]);
    });
});

describe('文风预设', () => {
    it('新增「日常轻喜剧」preset 可用', () => {
        expect(NARRATIVE_STYLES.sitcom).toBeTruthy();
        expect(NARRATIVE_STYLES.sitcom.name).toBe('日常轻喜剧');
        expect(NARRATIVE_STYLES.sitcom.guide.length).toBeGreaterThan(20);
    });
});

describe('AI roll NPC', () => {
    it('buildNpcRollPrompt 带上世界观、角色人设、已有 NPC 与数量', () => {
        const prompt = buildNpcRollPrompt({
            worldName: '栗子镇', worldview: '海边小镇',
            members: [{ name: '小满', persona: '画师，怕生' }],
            count: 3, existingNames: ['老板娘'],
        });
        expect(prompt).toContain('栗子镇');
        expect(prompt).toContain('小满：画师，怕生');
        expect(prompt).toContain('老板娘');
        expect(prompt).toContain('3');
    });

    it('parseRolledNpcs：解析 npcs，补默认 emoji，过滤空名/重名/超量', () => {
        const raw = JSON.stringify({
            npcs: [
                { name: '面包店老板娘', persona: '热心肠', emoji: '🥖' },
                { name: '', persona: 'x' },                 // 空名过滤
                { name: '老张', persona: '修鞋的' },          // 无 emoji → 默认
                { name: '老板娘', persona: '重名' },          // 与已有重名过滤
            ],
        });
        const out = parseRolledNpcs(raw, ['老板娘']);
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({ name: '面包店老板娘', persona: '热心肠', emoji: '🥖' });
        expect(out[1].emoji).toBe('🙂');
    });

    it('parseRolledNpcs：裸数组也能解析，解析失败返回空', () => {
        expect(parseRolledNpcs('[{"name":"阿福","persona":"门卫"}]')).toHaveLength(1);
        expect(parseRolledNpcs('不是 JSON')).toEqual([]);
    });
});

describe('关系看法（label）可变 + 叙述人称', () => {
    const char = mkChar('a', '小满');
    const members = ['小满', '阿岚'];

    it('parseCharBeat：重大转折时解析 relabel → newLabel', () => {
        const raw = JSON.stringify({
            location: '镇上', narrative: 'x', mood: 'y',
            relationships: [{ with: '阿岚', delta: 3, reason: '一起扛过事', relabel: '不打不相识的损友' }],
        });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.relationshipDeltas?.[0]).toMatchObject({ withName: '阿岚', delta: 3, newLabel: '不打不相识的损友' });
    });

    it('parseCharBeat：没给 relabel 时 newLabel 为 undefined', () => {
        const raw = JSON.stringify({ location: 'x', narrative: 'x', mood: 'y', relationships: [{ with: '阿岚', delta: 1 }] });
        const beat = parseCharBeat(raw, char, members);
        expect(beat.relationshipDeltas?.[0].newLabel).toBeUndefined();
    });

    it('narrationPersonGuide：随设置切换第一/二/三人称', () => {
        expect(narrationPersonGuide({ narrationPerson: 'first' } as any, '小满')).toContain('第一人称');
        expect(narrationPersonGuide({ narrationPerson: 'second' } as any, '小满')).toContain('第二人称');
        expect(narrationPersonGuide({ narrationPerson: 'third' } as any, '小满')).toContain('第三人称');
        expect(narrationPersonGuide({} as any, '小满')).toContain('第一人称'); // 默认
    });
});

describe('真实时间（跟现实早/中/晚/凌晨同步，错过当天可补、隔天不补）', () => {
    const at = (s: string) => new Date(s);

    it('realNowSeg：按小时分早/中/晚/凌晨（0~5点=凌晨，归属前一天的剧情日）', () => {
        expect(realNowSeg(at('2026-06-15T08:00:00')).seg).toBe(0); // 早
        expect(realNowSeg(at('2026-06-15T13:00:00')).seg).toBe(1); // 中
        expect(realNowSeg(at('2026-06-15T20:00:00')).seg).toBe(2); // 晚
        expect(realNowSeg(at('2026-06-15T13:00:00')).dayKey).toBe('2026-06-15');
        // 6月15日凌晨2点 = 6月14日这个剧情日的下半夜（seg=3），保证段序单调
        expect(realNowSeg(at('2026-06-15T02:00:00'))).toEqual({ dayKey: '2026-06-14', seg: 3 });
        expect(realNowSeg(at('2026-06-01T01:00:00'))).toEqual({ dayKey: '2026-05-31', seg: 3 }); // 跨月
    });

    it('formatRealClock：凌晨显示次日日期', () => {
        expect(formatRealClock({ dayKey: '2026-06-15', seg: 2 })).toBe('2026年6月15日 周一 晚上');
        expect(formatRealClock({ dayKey: '2026-06-15', seg: 3 })).toBe('2026年6月16日 周二 凌晨');
    });

    it('没演过 → 演当前这一段（凌晨也一样）', () => {
        expect(realObserveTarget(mkWorld({ timeMode: 'real' }), at('2026-06-15T13:00:00'))).toEqual({ dayKey: '2026-06-15', seg: 1 });
        expect(realObserveTarget(mkWorld({ timeMode: 'real' }), at('2026-06-15T02:00:00'))).toEqual({ dayKey: '2026-06-14', seg: 3 });
    });

    it('同一天落后 → 补下一段；已追上 → null', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 0 } });
        expect(realObserveTarget(w, at('2026-06-15T20:00:00'))).toEqual({ dayKey: '2026-06-15', seg: 1 }); // 只补一段
        expect(realObserveTarget(mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 2 } }), at('2026-06-15T20:00:00'))).toBeNull();
    });

    it('凌晨接在晚上后面：演过晚上、熬到下半夜 → 补凌晨；演过凌晨 → 追平', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 2 } });
        expect(realObserveTarget(w, at('2026-06-16T01:30:00'))).toEqual({ dayKey: '2026-06-15', seg: 3 });
        const w2 = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 3 } });
        expect(realObserveTarget(w2, at('2026-06-16T03:00:00'))).toBeNull(); // 已追上
        expect(realObserveTarget(w2, at('2026-06-16T08:00:00'))).toEqual({ dayKey: '2026-06-16', seg: 0 }); // 天亮进新一天
    });

    it('隔天没补的丢掉 → 直接跳到今天最早一段', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-13', seg: 1 } });
        expect(realObserveTarget(w, at('2026-06-15T20:00:00'))).toEqual({ dayKey: '2026-06-15', seg: 0 });
    });

    it('worldTimeLabel：real 模式显示已演到的现实段', () => {
        const w = mkWorld({ timeMode: 'real', realClock: { dayKey: '2026-06-15', seg: 2 } });
        expect(worldTimeLabel(w)).toContain('2026年6月15日');
        expect(worldTimeLabel(w)).toContain('晚上');
    });

    it('世界时区决定当前墙上时间与观测段', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-06-11T00:30:00.000Z'));
            const w = mkWorld({ timeMode: 'real', timezone: 'Asia/Tokyo' });
            const now = worldNow(w);
            expect([now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()])
                .toEqual([2026, 6, 11, 9, 30]);
            expect(realObserveTarget(w)).toEqual({ dayKey: '2026-06-11', seg: 0 });
            expect(worldTzLabel(w)).toContain('东京');
        } finally {
            vi.useRealTimers();
        }
    });

    it('往西切时区会把未来的 realClock 压回世界当下', () => {
        const w = mkWorld({
            timeMode: 'real',
            timezone: 'America/Los_Angeles',
            realClock: { dayKey: '2026-06-11', seg: 2 },
        });
        const losAngelesNow = worldNow(w, new Date('2026-06-11T12:00:00.000Z')); // 当地 05:00
        expect(clampRealClockToNow(w, losAngelesNow)).toBe(true);
        expect(w.realClock).toEqual({ dayKey: '2026-06-11', seg: 0 });
        expect(clampRealClockToNow(w, losAngelesNow)).toBe(false);
    });

    it('real 世界用世界时区覆盖角色时区，sim 世界保留角色设置', () => {
        const char = { ...mkChar('a', '阿岚'), customTimezoneEnabled: true, customTimezone: 'Asia/Tokyo' };
        const aligned = alignCharToWorldClock(
            mkWorld({ timeMode: 'real', timezone: 'America/Los_Angeles' }),
            char,
        );
        expect(aligned).not.toBe(char);
        expect(aligned.customTimezoneEnabled).toBe(true);
        expect(aligned.customTimezone).toBe('America/Los_Angeles');
        expect(char.customTimezone).toBe('Asia/Tokyo'); // 不污染角色卡

        const followingDevice = alignCharToWorldClock(mkWorld({ timeMode: 'real' }), char);
        expect(followingDevice.customTimezoneEnabled).toBe(false);
        expect(followingDevice.customTimezone).toBe('');
        expect(alignCharToWorldClock(mkWorld({ timeMode: 'sim' }), char)).toBe(char);
    });
});

describe('buildModeRule（三档 user 存在感）', () => {
    it('轻度：user 依旧是最重要的人', () => {
        expect(buildModeRule('light', '阿月')).toContain('最重要的人');
    });
    it('中度：user 是普通一员', () => {
        expect(buildModeRule('medium', '阿月')).toContain('普通一员');
    });
    it('重度：user 不存在，禁止提及', () => {
        const rule = buildModeRule('heavy', '阿月');
        expect(rule).toContain('不存在');
        expect(rule).toContain('绝对不要提及');
    });

    // ── 第四档「远方」：把「不在场」和「不重要」拆开（异地网友那一格） ──
    it('远方：ta 不住在这个世界，但你们真的认识', () => {
        const rule = buildModeRule('distant', '阿月');
        expect(rule).toContain('不住在这个世界');
        expect(rule).toContain('阿月');
    });

    it('远方 ≠ 重度：不许说 ta 不存在，反而要允许惦记', () => {
        const rule = buildModeRule('distant', '阿月');
        expect(rule).not.toContain('不存在');
        expect(rule).toContain('可以想起');
    });

    it('远方 ≠ 轻度：ta 仍然不许在镇上登场，也不许编造见过面', () => {
        const rule = buildModeRule('distant', '阿月');
        expect(rule).toContain('不要让 ta 登场');
        expect(rule).toContain('不要编造你们见过面');
    });
});

describe('buildWorldGapNote —— 小镇版「好久不见」', () => {
    const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
    const daysAgo = (d: number) => NOW - d * 86400000;

    it('没演过 / 不满一天 → 空串（小镇本就半天一跳，天天提会很廉价）', () => {
        expect(buildWorldGapNote('light', 'real', '阿月', undefined, NOW)).toBe('');
        expect(buildWorldGapNote('light', 'real', '阿月', daysAgo(0.4), NOW)).toBe('');
    });

    it('时间倒流（脏数据）不崩，返回空串', () => {
        expect(buildWorldGapNote('light', 'real', '阿月', NOW + 86400000, NOW)).toBe('');
    });

    it('real + 轻度：既说时间空白，也说好久没 ta 的消息', () => {
        const note = buildWorldGapNote('light', 'real', '阿月', daysAgo(3), NOW);
        expect(note).toContain('3 天');
        expect(note).toContain('阿月');
    });

    it('⛔ real + 重度：说时间空白，但一个字都不许提到 ta（模式铁律）', () => {
        const note = buildWorldGapNote('heavy', 'real', '阿月', daysAgo(3), NOW);
        expect(note).toContain('3 天');
        expect(note).not.toContain('阿月');
    });

    it('real + 中度：只说时间空白——该档明说「ta 不特殊」，硬提反而违背语义', () => {
        const note = buildWorldGapNote('medium', 'real', '阿月', daysAgo(3), NOW);
        expect(note).toContain('3 天');
        expect(note).not.toContain('阿月');
    });

    it('real + 远方：网友口径，会提到好久没消息', () => {
        expect(buildWorldGapNote('distant', 'real', '阿月', daysAgo(5), NOW)).toContain('阿月');
    });

    it('⛔ sim 模式绝不说「过去了 N 天」——剧情时间与现实无关', () => {
        const note = buildWorldGapNote('light', 'sim', '阿月', daysAgo(3), NOW);
        expect(note).not.toContain('3 天');
        expect(note).toContain('阿月');
    });

    it('sim + 重度/中度 → 空串（既不能说天数，也不能提 ta，那就没什么可说的）', () => {
        expect(buildWorldGapNote('heavy', 'sim', '阿月', daysAgo(3), NOW)).toBe('');
        expect(buildWorldGapNote('medium', 'sim', '阿月', daysAgo(3), NOW)).toBe('');
    });

    it('timeMode 缺省（旧世界无此字段）按 real 处理', () => {
        expect(buildWorldGapNote('light', undefined, '阿月', daysAgo(2), NOW)).toContain('2 天');
    });
});

describe('buildWorldCharTurn', () => {
    it('传递路径：公开行程可见，瞒下的行程/正文/心情不外泄', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({
            world, char: members[1], members, storyTime: '第1天白天', round: 1,
            beatsSoFar: [{
                charId: 'a', charName: '小满', location: '镇上', narrative: '她在酒吧后巷哭了一场。', mood: '低落',
                timeline: [
                    { time: '9:00', place: '画室', event: '画了一上午', shared: true },
                    { time: '11:30', place: '酒吧', event: '偷偷去喝了一杯', shared: false },
                ],
            }],
            userName: '阿月',
        });
        // 传递路径：公开行程可见；瞒下的行程、narrative、mood 都不可见
        expect(turn).toContain('9:00 在画室：画了一上午');
        expect(turn).not.toContain('酒吧');
        expect(turn).not.toContain('哭了一场');
        expect(turn).not.toContain('低落');
    });

    it('当面对话完整传给对话对象，公开动态全员可见', () => {
        const world = mkWorld({ houses: [{ id: 'h1', name: '合租屋', residentIds: ['a', 'b'] }] });
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({
            world, char: members[1], members, storyTime: '第1天白天', round: 1,
            beatsSoFar: [{
                charId: 'a', charName: '小满', location: '合租屋的厨房', narrative: 'x', mood: 'y',
                dialogues: [{ with: '阿岚', lines: ['汤好了，趁热'] }],
            }],
            recentPosts: [{ name: '小满', post: '今天的汤格外香' }],
            userName: '',
        });
        expect(turn).toContain('当面对你说');
        expect(turn).toContain('「汤好了，趁热」');
        expect(turn).toContain('小满：今天的汤格外香'); // 社交媒体公开
    });

    it('伏笔爆发与用户心声注入', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({
            world, char: members[1], members, storyTime: '第2天白天', round: 3, beatsSoFar: [],
            exposures: ['你发现/听说了 小满 一直瞒着的事：偷偷去了酒吧。'],
            directive: { impulseText: '想辞职去学烘焙', text: '去吧，我支持你' },
            userName: '阿月',
        });
        expect(turn).toContain('绕不开的事');
        expect(turn).toContain('偷偷去了酒吧');
        expect(turn).toContain('心里的声音');
        expect(turn).toContain('去吧，我支持你');
        expect(turn).toContain('阿月'); // light 模式：联想到 user
    });

    it('手机段：先演绎角色刚发的私聊/群聊出现在后演绎角色的上下文里，标【刚刚】', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        applyBeatToThreads(world, {
            charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z',
            phone: { dms: [{ to: '阿岚', lines: ['睡了吗'] }], group: ['今晚月色不错'] },
        }, members, 3, '第2天白天');
        const turn = buildWorldCharTurn({ world, char: members[1], members, storyTime: '第2天白天', round: 3, beatsSoFar: [], userName: '' });
        expect(turn).toContain('与 小满 的私聊');
        expect(turn).toContain('【刚刚】 小满：睡了吗');
        expect(turn).toContain('【刚刚】 小满：今晚月色不错');
    });

    it('关系有向：自己的视角带数值，对方对自己只有模糊体感（不泄露数值与关系名）', () => {
        const world = mkWorld({
            relationships: [
                { fromId: 'a', toId: 'b', label: '单恋', value: 85 },
                { fromId: 'b', toId: 'a', label: '普通同事', value: 30 },
            ],
        });
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({ world, char: members[0], members, storyTime: '第1天白天', round: 1, beatsSoFar: [], userName: '' });
        expect(turn).toContain('你对 阿岚');
        expect(turn).toContain('「单恋」');        // 理智上的标签
        expect(turn).toContain('好感 85（亲密无间）'); // 自己的好感数值 + 档位
        expect(turn).toContain('你能隐约感觉到 阿岚 对你的态度：有好感'); // 对方 30 → 有好感（只给档位）
        expect(turn).not.toContain('好感 30');    // 对方的数值是对方的内心，不泄露
        expect(turn).not.toContain('普通同事');   // 对方眼中的关系名同理
    });

    it('凌晨轮注入「深夜更冲动感性」段落，timeline 约束改为 0~5 点', () => {
        const world = mkWorld();
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚')];
        const turn = buildWorldCharTurn({ world, char: members[0], members, storyTime: '第2天凌晨', round: 4, beatsSoFar: [], userName: '' });
        expect(turn).toContain('此刻是凌晨');
        expect(turn).toContain('更**冲动、更感性**');
        expect(turn).toContain('凌晨0点到5点');
        // 白天轮不带凌晨段落
        const dayTurn = buildWorldCharTurn({ world, char: members[0], members, storyTime: '第1天早上', round: 1, beatsSoFar: [], userName: '' });
        expect(dayTurn).not.toContain('此刻是凌晨');
        expect(dayTurn).toContain('清晨到上午');
    });

    it('NPC 世界引擎的凌晨轮带「镇子睡着了」的深夜基调', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        const members = [mkChar('a', '小满')];
        const night = buildNpcTurn({ world, members, storyTime: '第2天凌晨' });
        expect(night).toContain('现在是凌晨');
        expect(night).toContain('镇子基本睡着了');
        const day = buildNpcTurn({ world, members, storyTime: '第1天早上' });
        expect(day).not.toContain('镇子基本睡着了');
    });

    it('独居与同居安排都体现在 prompt 里', () => {
        const world = mkWorld({ houses: [{ id: 'h1', name: '合租屋', residentIds: ['a', 'b'] }], memberIds: ['a', 'b', 'c'] });
        const members = [mkChar('a', '小满'), mkChar('b', '阿岚'), mkChar('c', '十一')];
        const turn = buildWorldCharTurn({ world, char: members[0], members, storyTime: '第1天白天', round: 1, beatsSoFar: [], userName: '' });
        expect(turn).toContain('合租屋：小满、阿岚 同住');
        expect(turn).toContain('十一 独居');
    });
});

describe('世界消息线程（交替传递）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];

    it('A 发的私聊与 B 的回复进同一条 dm 线程，按时间交替', () => {
        const world = mkWorld();
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '阿岚', lines: ['在吗', '想你了'] }] } }, members, 1, '第1天白天');
        applyBeatToThreads(world, { charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '小满', lines: ['刚看到，怎么啦'] }] } }, members, 1, '第1天白天');
        const threads = dmThreadsOf(world, 'a');
        expect(threads).toHaveLength(1);
        expect(threads[0].id).toBe(dmThreadId('a', 'b'));
        expect(threads[0].messages.map(m => `${m.fromName}:${m.text}`)).toEqual([
            '小满:在吗', '小满:想你了', '阿岚:刚看到，怎么啦',
        ]);
        // B 的视角是同一条线程
        expect(dmThreadsOf(world, 'b')[0].id).toBe(threads[0].id);
    });

    it('群聊：成员发言与 NPC 冒泡都进 group_main，NPC 名字必须真实存在', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        ensureThreads(world);
        applyNpcGroupLines(world, [{ name: '老板娘', line: '新出炉的栗子包！' }, { name: '不存在的人', line: 'x' }], 1, '第1天白天');
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { group: ['冲了'] } }, members, 1, '第1天白天');
        const group = groupThreadOf(world)!;
        expect(group.id).toBe(GROUP_THREAD_ID);
        expect(group.messages.map(m => m.fromName)).toEqual(['老板娘', '小满']);
    });

    it('群聊/私聊去重：同一发送者把上一轮的话原样再发一遍会被丢掉（只差空白也算）', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        ensureThreads(world);
        // 第1轮：小满在群里说「今天天气真好」
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { group: ['今天天气真好'] } }, members, 1, '第1天白天');
        // 第2轮：小满又把同一句（只差空白）原样发一遍 → 丢弃；NPC 重复冒泡同句也丢
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { group: [' 今天天气真好 ', '换个新话题'] } }, members, 2, '第1天夜晚');
        applyNpcGroupLines(world, [{ name: '老板娘', line: '新出炉的栗子包！' }, { name: '老板娘', line: '新出炉的栗子包！' }], 2, '第1天夜晚');
        const group = groupThreadOf(world)!;
        expect(group.messages.map(m => m.text)).toEqual(['今天天气真好', '换个新话题', '新出炉的栗子包！']);
    });

    it('formatThreadForPrompt：本轮消息标【刚刚】，历史消息标剧情时间', () => {
        const world = mkWorld();
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '阿岚', lines: ['老消息'] }] } }, members, 1, '第1天白天');
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '阿岚', lines: ['新消息'] }] } }, members, 2, '第1天夜晚');
        const text = formatThreadForPrompt(dmThreadsOf(world, 'b')[0], 'b', 10, 2);
        expect(text).toContain('[第1天白天] 小满：老消息');
        expect(text).toContain('【刚刚】 小满：新消息');
    });
});

describe('NPC 私聊（角色发、NPC 那一轮统一回复）', () => {
    const members = [{ id: 'a', name: '小满' }];

    it('parseCharBeat：可以给 NPC 发私信（to=NPC名也保留）', () => {
        const raw = JSON.stringify({ location: 'x', narrative: 'x', mood: 'y', phone: { dms: [{ to: '老板娘', lines: ['今天还有栗子包吗'] }] } });
        const beat = parseCharBeat(raw, mkChar('a', '小满'), ['小满'], ['老板娘']);
        expect(beat.phone?.dms?.[0]).toEqual({ to: '老板娘', lines: ['今天还有栗子包吗'] });
    });

    it('applyBeatToThreads：角色→NPC 私信落进 char↔npc 线程；npcInboxes 能捞到待回', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '老板娘', lines: ['还有栗子包吗'] }] } }, members, 1, '第1天早上');
        const tid = dmThreadId('a', 'n1');
        expect(dmThreadsOf(world, 'a').some(t => t.id === tid)).toBe(true);
        const inbox = npcInboxes(world);
        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ npcName: '老板娘', memberName: '小满' });
    });

    it('applyNpcDms：NPC 回复后该线程不再算待回', () => {
        const world = mkWorld({ npcs: [{ id: 'n1', name: '老板娘', persona: '面包店' }] });
        applyBeatToThreads(world, { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', phone: { dms: [{ to: '老板娘', lines: ['还有栗子包吗'] }] } }, members, 1, '第1天早上');
        applyNpcDms(world, [{ from: '老板娘', to: '小满', lines: ['刚出炉，给你留俩'] }], members, 1, '第1天早上');
        expect(npcInboxes(world)).toHaveLength(0);
        const thread = dmThreadsOf(world, 'a').find(t => t.id === dmThreadId('a', 'n1'))!;
        expect(thread.messages.map(m => `${m.fromName}:${m.text}`)).toEqual(['小满:还有栗子包吗', '老板娘:刚出炉，给你留俩']);
    });

    it('parseNpcScene：解析 NPC 私信回复', () => {
        const out = parseNpcScene('```json\n{"scene":"x","hooks":[],"groupLines":[],"dms":[{"from":"老板娘","to":"小满","lines":["给你留俩"]}]}\n```');
        expect(out.dms).toEqual([{ from: '老板娘', to: '小满', lines: ['给你留俩'] }]);
    });

    it('parseNpcScene：解析动态点赞/评论（NPC+路人），likes 钳整数', () => {
        const out = parseNpcScene('```json\n{"scene":"x","feedReactions":[{"ref":"3_a_0","likes":"12","comments":[{"from":"街角咖啡师","text":"好可爱！"},{"from":"路人乙"}]}]}\n```');
        expect(out.feedReactions).toHaveLength(1);
        expect(out.feedReactions[0]).toMatchObject({ ref: '3_a_0', likes: 12 });
        expect(out.feedReactions[0].comments).toEqual([{ from: '街角咖啡师', text: '好可爱！' }]); // 无 text 的被过滤
    });
});

describe('applyRelationshipDeltas（有向回填）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];

    it('只改"该角色→对方"这条边，反向不动', () => {
        const world = mkWorld({
            relationships: [
                { fromId: 'a', toId: 'b', value: 60 },
                { fromId: 'b', toId: 'a', value: 20 },
            ],
        });
        applyRelationshipDeltas(world, [
            { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', relationshipDeltas: [{ withName: '阿岚', delta: 3 }] },
        ], members);
        expect(world.relationships.find(r => r.fromId === 'a' && r.toId === 'b')!.value).toBe(63);
        expect(world.relationships.find(r => r.fromId === 'b' && r.toId === 'a')!.value).toBe(20);
    });

    it('不存在的边按 0（陌生中立）起步，数值钳在 -100~100（可为负）', () => {
        const world = mkWorld({ relationships: [{ fromId: 'a', toId: 'b', value: 99 }] });
        applyRelationshipDeltas(world, [
            { charId: 'a', charName: '小满', location: 'x', narrative: 'y', mood: 'z', relationshipDeltas: [{ withName: '阿岚', delta: 4 }] },
            { charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z', relationshipDeltas: [{ withName: '小满', delta: -4 }] },
        ], members);
        expect(world.relationships.find(r => r.fromId === 'a' && r.toId === 'b')!.value).toBe(100); // 99+4 钳到 100
        expect(world.relationships.find(r => r.fromId === 'b' && r.toId === 'a')!.value).toBe(-4);  // 新边 0 起步 −4 → 负数
    });
});

describe('伏笔与摘要防泄密', () => {
    it('collectSeeds：显式 secrets + timeline 未声张条目自动补伏笔，不重复', () => {
        const world = mkWorld();
        collectSeeds(world, {
            charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z',
            timeline: [
                { time: '9:00', place: '图书馆', event: '看书', shared: true },
                { time: '22:00', place: '酒吧', event: '偷偷去喝了一杯', shared: false },
                { time: '23:30', place: '河边', event: '一个人坐了很久', shared: false },
            ],
            secrets: [{ text: '偷偷去喝了一杯', hideFrom: ['小满'] }],
        }, 2, '第1天夜晚');
        const seeds = world.seeds!;
        // 显式 secret 1 条 + timeline 自动补 1 条（河边；酒吧已被 secrets 覆盖不重复）
        expect(seeds).toHaveLength(2);
        expect(seeds[0]).toMatchObject({ charName: '阿岚', text: '偷偷去喝了一杯', hideFrom: ['小满'], status: 'pending' });
        expect(seeds[1].text).toContain('河边');
        expect(seeds[1].hideFrom).toEqual([]);
    });

    it('buildSummary 只用公开信息：瞒下的事和正文绝不进全员可见的摘要', () => {
        const summary = buildSummary('第1天夜晚', [{
            charId: 'b', charName: '阿岚', location: '镇上', narrative: '她在酒吧后巷给前任打了电话。', mood: '崩溃',
            timeline: [
                { time: '20:00', place: '餐厅', event: '和同事聚餐', shared: true },
                { time: '22:00', place: '酒吧', event: '偷偷去喝了一杯', shared: false },
            ],
        }], []);
        expect(summary).toContain('和同事聚餐');
        expect(summary).not.toContain('酒吧');
        expect(summary).not.toContain('前任');
        expect(summary).not.toContain('崩溃');
    });
});

describe('动态去重 dropDuplicatePosts', () => {
    it('剔除和最近动态重复的 post（含只差空白/换行的）', () => {
        const beat: any = {
            charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z',
            phone: { posts: ['有些东西揣在怀里沉甸甸的', '今天阳光真好', ' 今天阳光真好 '] },
        };
        dropDuplicatePosts(beat, [{ post: '有些东西揣在怀里沉甸甸的' }]);
        // 与最近动态重复的第一条被剔除；本拍内只差空白的重复也只留一条
        expect(beat.phone.posts).toEqual(['今天阳光真好']);
    });

    it('没有重复时原样保留；空白条目被剔除', () => {
        const beat: any = { charId: 'b', charName: '阿岚', location: 'x', narrative: 'y', mood: 'z', phone: { posts: ['全新的一条', '   '] } };
        dropDuplicatePosts(beat, [{ post: '别的内容' }]);
        expect(beat.phone.posts).toEqual(['全新的一条']);
    });
});

describe('WorldScheduler', () => {
    beforeEach(() => {
        localStorage.removeItem('world_tick_slots');
        localStorage.removeItem('world_tick_fired');
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        WorldScheduler.onTrigger(() => {});
    });

    it('reconcile：今天已过去的时段视为已耗尽，不补火（防止配置完瞬间连烧）', () => {
        vi.setSystemTime(new Date('2026-06-11T15:00:00')); // 15点：凌晨/早/午已过
        const fired: string[] = [];
        WorldScheduler.onTrigger((id) => { fired.push(id); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['latenight', 'morning', 'noon', 'evening'] }]);
        const rec = JSON.parse(localStorage.getItem('world_tick_fired')!).w1;
        expect(rec.fired).toEqual(['latenight', 'morning', 'noon']);
        expect(fired).toEqual([]); // 不立即触发
    });

    it('latenight 时段：凌晨 2 点后起火', () => {
        vi.setSystemTime(new Date('2026-06-11T01:00:00'));
        const fired: string[] = [];
        WorldScheduler.onTrigger((id, trigger) => { fired.push(`${id}:${trigger}`); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['latenight'] }]);
        vi.advanceTimersByTime(61_000); // 1点多：还没到
        expect(fired).toEqual([]);
        vi.setSystemTime(new Date('2026-06-11T02:30:00'));
        vi.advanceTimersByTime(61_000);
        expect(fired).toEqual(['w1:tick']);
    });

    it('到点触发当天未跑的时段，且每时段一天最多一次', () => {
        vi.setSystemTime(new Date('2026-06-11T08:00:00'));
        const fired: string[] = [];
        WorldScheduler.onTrigger((id, trigger) => { fired.push(`${id}:${trigger}`); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['morning'] }]);
        expect(fired).toEqual([]);
        vi.setSystemTime(new Date('2026-06-11T09:30:00'));
        vi.advanceTimersByTime(61_000); // 主线程轮询
        expect(fired).toEqual(['w1:tick']);
        vi.advanceTimersByTime(10 * 61_000); // 同一天不再重复
        expect(fired).toEqual(['w1:tick']);
    });

    it('跨天后时段配额重置', () => {
        vi.setSystemTime(new Date('2026-06-11T10:00:00'));
        const fired: string[] = [];
        WorldScheduler.onTrigger(() => { fired.push('x'); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['morning'] }]); // 10点：morning 已耗尽
        vi.advanceTimersByTime(61_000);
        expect(fired).toHaveLength(0);
        vi.setSystemTime(new Date('2026-06-12T09:30:00')); // 第二天早上
        vi.advanceTimersByTime(61_000);
        expect(fired).toHaveLength(1);
    });

    it('移除世界后清掉残留', () => {
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['evening'] }]);
        expect(JSON.parse(localStorage.getItem('world_tick_slots')!).w1).toBeTruthy();
        WorldScheduler.reconcile([]);
        expect(localStorage.getItem('world_tick_slots')).toBeNull();
    });

    it('每个世界按自己的时区计算日期和已耗尽时段', () => {
        vi.setSystemTime(new Date('2026-06-11T00:30:00.000Z'));
        WorldScheduler.reconcile([
            { worldId: 'tokyo', slots: ['noon'], tz: 'Asia/Tokyo' },
            { worldId: 'los-angeles', slots: ['noon'], tz: 'America/Los_Angeles' },
        ]);
        const fired = JSON.parse(localStorage.getItem('world_tick_fired')!);
        expect(fired.tokyo).toEqual({ date: '2026-06-11', fired: [] }); // 东京 09:30
        expect(fired['los-angeles']).toEqual({ date: '2026-06-10', fired: ['noon'] }); // 洛杉矶 17:30
    });

    it('兼容旧版 slot[] 存储格式', () => {
        vi.setSystemTime(new Date(2026, 5, 11, 9, 30));
        localStorage.setItem('world_tick_slots', JSON.stringify({ legacy: ['morning'] }));
        localStorage.setItem('world_tick_fired', JSON.stringify({
            legacy: { date: '2026-06-11', fired: [] },
        }));
        const fired: string[] = [];
        WorldScheduler.onTrigger((id) => { fired.push(id); });
        expect(fired).toEqual(['legacy']);
    });

    it('同一日内换时区会重算配额，未来时段仍能在新时区触发', () => {
        vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z')); // 东京 21:00，洛杉矶 05:00
        const fired: string[] = [];
        WorldScheduler.onTrigger((id) => { fired.push(id); });
        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['evening'], tz: 'Asia/Tokyo' }]);
        expect(JSON.parse(localStorage.getItem('world_tick_fired')!).w1.fired).toEqual(['evening']);

        WorldScheduler.reconcile([{ worldId: 'w1', slots: ['evening'], tz: 'America/Los_Angeles' }]);
        expect(JSON.parse(localStorage.getItem('world_tick_fired')!).w1.fired).toEqual([]);

        vi.setSystemTime(new Date('2026-06-12T04:30:00.000Z')); // 洛杉矶仍是 6/11，21:30
        vi.advanceTimersByTime(61_000);
        expect(fired).toEqual(['w1']);
    });
});


describe('关系名变更史（阶段 2.3）—— 别再硬覆盖', () => {
    const mkWorldWith = (rel: any) => ({
        id: 'w1', name: '小镇', relationships: rel ? [rel] : [],
    } as any);
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];
    const beatWith = (newLabel?: string, reason?: string) => ([{
        charId: 'a', charName: '小满',
        relationshipDeltas: [{ withName: '阿岚', delta: 5, ...(newLabel ? { newLabel } : {}), ...(reason ? { reason } : {}) }],
    }] as any);

    it('⭐ 改名时把旧名字存进 labelHistory，不再无声丢掉', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 10, label: '死对头' });
        applyRelationshipDeltas(w, beatWith('别扭的同伴', '他救了我一命'), members, 12);
        const rel = w.relationships[0];
        expect(rel.label).toBe('别扭的同伴');
        expect(rel.labelHistory).toHaveLength(1);
        expect(rel.labelHistory[0].label).toBe('死对头');
        expect(rel.labelHistory[0].round).toBe(12);
        expect(rel.labelHistory[0].reason).toBe('他救了我一命');
    });

    it('多次改名按顺序累积，最旧的在最前', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 0, label: '陌生人' });
        applyRelationshipDeltas(w, beatWith('点头之交'), members, 1);
        applyRelationshipDeltas(w, beatWith('朋友'), members, 5);
        applyRelationshipDeltas(w, beatWith('挚友'), members, 9);
        const rel = w.relationships[0];
        expect(rel.label).toBe('挚友');
        expect(rel.labelHistory.map((h: any) => h.label)).toEqual(['陌生人', '点头之交', '朋友']);
    });

    it('⛔ 改成同一个名字不算变更，不会灌进重复历史', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 0, label: '朋友' });
        applyRelationshipDeltas(w, beatWith('朋友'), members, 3);
        expect(w.relationships[0].labelHistory).toBeUndefined();
    });

    it('⛔ 本来就没有名字时不记历史——没有旧名字可丢', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 0 });
        applyRelationshipDeltas(w, beatWith('初识'), members, 2);
        expect(w.relationships[0].label).toBe('初识');
        expect(w.relationships[0].labelHistory).toBeUndefined();
    });

    it('没给 newLabel 时只动好感，名字与历史都不碰', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 10, label: '死对头' });
        applyRelationshipDeltas(w, beatWith(undefined), members, 4);
        expect(w.relationships[0].label).toBe('死对头');
        expect(w.relationships[0].labelHistory).toBeUndefined();
        expect(w.relationships[0].value).toBe(15);
    });

    it('不传 round 也能用（旧调用点不会崩）', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 0, label: '旧' });
        applyRelationshipDeltas(w, beatWith('新'), members);
        expect(w.relationships[0].labelHistory[0].round).toBeUndefined();
    });

    // ── 关系锁（阶段 2.2）──────────────────────────────────────────
    it('⭐ 锁住的边：好感和关系名都不动', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 10, label: '死对头', locked: true });
        applyRelationshipDeltas(w, beatWith('别扭的同伴', '他救了我一命'), members, 12);
        expect(w.relationships[0].value).toBe(10);
        expect(w.relationships[0].label).toBe('死对头');
        expect(w.relationships[0].labelHistory).toBeUndefined();
    });

    it('⭐ 锁是单向的 —— 锁了 a→b 不影响 b→a', () => {
        const w = { id: 'w1', name: '小镇', relationships: [
            { fromId: 'a', toId: 'b', value: 10, label: '死对头', locked: true },
            { fromId: 'b', toId: 'a', value: 10, label: '损友' },
        ] } as any;
        applyRelationshipDeltas(w, [
            { charId: 'a', charName: '小满', relationshipDeltas: [{ withName: '阿岚', delta: 5, newLabel: '同伴' }] },
            { charId: 'b', charName: '阿岚', relationshipDeltas: [{ withName: '小满', delta: 5, newLabel: '挚友' }] },
        ] as any, members, 3);
        expect(w.relationships[0]).toMatchObject({ value: 10, label: '死对头' });   // 锁着
        expect(w.relationships[1]).toMatchObject({ value: 15, label: '挚友' });     // 没锁
    });

    it('⭐ 锁的粒度是「这一对」，同一 beat 里其他关系照常演绎', () => {
        const w = { id: 'w1', name: '小镇', relationships: [
            { fromId: 'a', toId: 'b', value: 10, locked: true },
            { fromId: 'a', toId: 'c', value: 10 },
        ] } as any;
        const three = [...members, { id: 'c', name: '阿澄' }];
        applyRelationshipDeltas(w, [{
            charId: 'a', charName: '小满',
            relationshipDeltas: [{ withName: '阿岚', delta: 5 }, { withName: '阿澄', delta: 5 }],
        }] as any, three, 1);
        expect(w.relationships[0].value).toBe(10);
        expect(w.relationships[1].value).toBe(15);
    });

    it('⛔ 默认不锁 —— 没有这个字段的旧世界照常演绎', () => {
        const w = mkWorldWith({ fromId: 'a', toId: 'b', value: 10, label: '朋友' });
        applyRelationshipDeltas(w, beatWith('挚友'), members, 1);
        expect(w.relationships[0]).toMatchObject({ value: 15, label: '挚友' });
    });

    it('⛔ 锁不会挡住还不存在的边 —— 新边本来就锁不上', () => {
        const w = mkWorldWith(null);
        applyRelationshipDeltas(w, beatWith('初识'), members, 1);
        expect(w.relationships).toHaveLength(1);
        expect(w.relationships[0].locked).toBeUndefined();
    });
});


describe('一起追连载 · shareWorldCardTo（阶段 2.6）', () => {
    const beat = {
        charId: 'aa', charName: '阿岚', location: '厨房', mood: '烦',
        narrative: '她把锅摔了。',
        secrets: [{ text: '其实她是因为看到小满和别人在一起才发火' }],
    } as any;
    const mkWorld = (memberIds: string[]) => ({
        id: 'w1', name: '小镇', mode: 'light', memberIds, houses: [], npcs: [], relationships: [],
    } as any);

    it('⛔⭐ 铁律：镇上的居民不能收 —— 居民开上帝视角会毁掉伏笔系统', async () => {
        const res = await shareWorldCardTo(mkWorld(['aa', 'bb']), beat, 3, '第3天 白天', 'bb');
        expect(res.ok).toBe(false);
        expect(res.reason).toContain('住在镇上');
    });

    it('⛔ 也不能分享给当事人自己', async () => {
        const res = await shareWorldCardTo(mkWorld(['aa']), beat, 3, '第3天 白天', 'aa');
        expect(res.ok).toBe(false);
    });

    it('⭐ 镇外的角色可以收 —— ta 是在读机主写的故事', async () => {
        const res = await shareWorldCardTo(mkWorld(['aa', 'bb']), beat, 3, '第3天 白天', 'outsider');
        expect(res.ok).toBe(true);
    });

    it('memberIds 缺失（旧存档）时不崩，按「不是镇民」处理', async () => {
        const w = { id: 'w1', name: '小镇', mode: 'light', houses: [], npcs: [], relationships: [] } as any;
        const res = await shareWorldCardTo(w, beat, 1, 't', 'x');
        expect(res.ok).toBe(true);
    });
});


describe('全局关系镜像 · mirrorWorldBondsToChars（阶段 2.4）', () => {
    const members = [{ id: 'm_a', name: '小满' }, { id: 'm_b', name: '阿岚' }];
    const mkWorld = (rels: any[]) => ({ id: 'w_mirror', name: '小镇', relationships: rels } as any);

    beforeEach(async () => {
        for (const m of members) {
            await DB.saveCharacter({ id: m.id, name: m.name } as any);
        }
    });

    it('⭐ 镇上的关系镜像进各自角色卡，出了小镇也认得', async () => {
        await mirrorWorldBondsToChars(mkWorld([
            { fromId: 'm_a', toId: 'm_b', value: 30, label: '别扭的同伴' },
        ]), members, 5);
        const a = await DB.getCharacter('m_a');
        expect(a!.charBonds).toHaveLength(1);
        expect(a!.charBonds![0]).toMatchObject({ toId: 'm_b', toName: '阿岚', label: '别扭的同伴', value: 30, fromWorldId: 'w_mirror' });
    });

    it('⛔⭐ 铁律：只镜像 from=自己 那一侧，ta 不知道对方怎么看 ta', async () => {
        await mirrorWorldBondsToChars(mkWorld([
            { fromId: 'm_a', toId: 'm_b', value: 30, label: '损友' },
            { fromId: 'm_b', toId: 'm_a', value: -40, label: '讨厌鬼' },
        ]), members, 1);
        const a = await DB.getCharacter('m_a');
        const b = await DB.getCharacter('m_b');
        // 各自只有一条，且都是自己那一侧
        expect(a!.charBonds!.map(x => x.label)).toEqual(['损友']);
        expect(b!.charBonds!.map(x => x.label)).toEqual(['讨厌鬼']);
    });

    it('⛔ 幂等：没变就不写，重复跑不会刷历史', async () => {
        const w = mkWorld([{ fromId: 'm_a', toId: 'm_b', value: 10, label: '朋友' }]);
        await mirrorWorldBondsToChars(w, members, 1);
        await mirrorWorldBondsToChars(w, members, 2);
        await mirrorWorldBondsToChars(w, members, 3);
        const a = await DB.getCharacter('m_a');
        expect(a!.charBonds![0].history).toBeUndefined();
    });

    it('⭐ 关系名变了才记历史，可回退', async () => {
        await mirrorWorldBondsToChars(mkWorld([{ fromId: 'm_a', toId: 'm_b', value: 0, label: '死对头' }]), members, 1);
        await mirrorWorldBondsToChars(mkWorld([{ fromId: 'm_a', toId: 'm_b', value: 0, label: '损友' }]), members, 9);
        const a = await DB.getCharacter('m_a');
        expect(a!.charBonds![0].label).toBe('损友');
        expect(a!.charBonds![0].history).toHaveLength(1);
        expect(a!.charBonds![0].history![0]).toMatchObject({ label: '死对头', round: 9 });
    });

    it('⭐ 全局那把锁锁住后，小镇再怎么变都同步不过来', async () => {
        await mirrorWorldBondsToChars(mkWorld([{ fromId: 'm_a', toId: 'm_b', value: 0, label: '朋友' }]), members, 1);
        const a0 = await DB.getCharacter('m_a');
        await DB.saveCharacter({ ...a0!, charBonds: a0!.charBonds!.map(b => ({ ...b, locked: true })) });
        await mirrorWorldBondsToChars(mkWorld([{ fromId: 'm_a', toId: 'm_b', value: 99, label: '恋人' }]), members, 2);
        const a1 = await DB.getCharacter('m_a');
        expect(a1!.charBonds![0]).toMatchObject({ label: '朋友', value: 0, locked: true });
    });

    it('⛔ 指向非成员的边不镜像（NPC / 已退镇的人）', async () => {
        await mirrorWorldBondsToChars(mkWorld([
            { fromId: 'm_a', toId: 'npc_x', value: 50, label: '面馆老板' },
        ]), members, 1);
        const a = await DB.getCharacter('m_a');
        expect(a!.charBonds || []).toHaveLength(0);
    });
});


describe('固定地点表（阶段 3.1）', () => {
    const places = [
        { id: 'p1', name: '城南河堤', blurb: '傍晚有人遛狗' },
        { id: 'p2', name: '面馆' },
        { id: 'p3', name: '图书馆', regularIds: ['m_a'] },
    ];
    const members = [{ id: 'm_a', name: '小满' }, { id: 'm_b', name: '阿岚' }];

    describe('resolvePlaceId —— 把自由文本对到清单', () => {
        it('完全同名直接对上', () => {
            expect(resolvePlaceId('面馆', places)).toBe('p2');
        });

        it('空白不影响匹配', () => {
            expect(resolvePlaceId('  面 馆 ', places)).toBe('p2');
        });

        it('⭐ 一方包含另一方也算（模型常只写半个名字）', () => {
            expect(resolvePlaceId('河堤', places)).toBe('p1');
            expect(resolvePlaceId('城南河堤旁边', places)).toBe('p1');
        });

        it('⭐ 包含匹配取最长的那条，不会对到更短的泛称上', () => {
            const two = [{ id: 'short', name: '河' }, { id: 'long', name: '城南河堤' }];
            expect(resolvePlaceId('城南河堤', two)).toBe('long');
        });

        it('⛔⭐ 对不上就是 undefined —— 这不是错误，角色本来就能去新地方', () => {
            expect(resolvePlaceId('隔壁市的机场', places)).toBeUndefined();
            expect(resolvePlaceId('', places)).toBeUndefined();
            expect(resolvePlaceId(undefined, places)).toBeUndefined();
        });

        it('⛔ 没建地点表的旧世界一律 undefined，不崩', () => {
            expect(resolvePlaceId('面馆', undefined)).toBeUndefined();
            expect(resolvePlaceId('面馆', [])).toBeUndefined();
        });
    });

    describe('buildPlacesSection —— 清单那段提示词', () => {
        it('列出名字和说明', () => {
            const t = buildPlacesSection({ places } as any, members);
            expect(t).toContain('城南河堤：傍晚有人遛狗');
            expect(t).toContain('面馆');
        });

        it('带上「谁平时在这儿上班/上学」（§5.7：具体但不引入数值）', () => {
            const t = buildPlacesSection({ places } as any, members);
            expect(t).toContain('小满平时在这儿上班/上学');
            // ⛔ 不能冒出职位/工资/等级这类数值化的东西
            for (const forbidden of ['职位', '工资', '薪水', '升职', '等级']) {
                expect(t).not.toContain(forbidden);
            }
        });

        it('⛔⭐ 措辞红线：必须明写「不是封闭名单」，否则会把「鼓励意外」那段废掉', () => {
            const t = buildPlacesSection({ places } as any, members);
            expect(t).toContain('不是一份封闭名单');
            expect(t).toContain('完全可以去清单上没有的地方');
        });

        it('⭐ 也要说清为什么要复用名字', () => {
            expect(buildPlacesSection({ places } as any, members)).toContain('别把同一个地方每次换个叫法');
        });

        it('⛔ 没建地点表 → 空串，旧世界提示词零变化', () => {
            expect(buildPlacesSection({} as any, members)).toBe('');
            expect(buildPlacesSection({ places: [] } as any, members)).toBe('');
        });

        it('常驻成员已退镇（查不到名字）时不留空括号', () => {
            const t = buildPlacesSection({ places: [{ id: 'x', name: '面馆', regularIds: ['已删除'] }] } as any, members);
            expect(t).not.toContain('（）');
            expect(t).not.toContain('平时在这儿');
        });
    });

    describe('parseCharBeat 顺带解析 placeId', () => {
        const char = { id: 'm_a', name: '小满' } as any;
        const raw = (loc: string) => JSON.stringify({ location: loc, narrative: '正文', mood: '平静' });

        it('⭐ 对上清单就带 placeId 出来（将来上地图靠这个）', () => {
            const b = parseCharBeat(raw('面馆'), char, ['小满'], [], places);
            expect(b.location).toBe('面馆');
            expect(b.placeId).toBe('p2');
        });

        it('⛔ 对不上就没有 placeId，location 原样保留', () => {
            const b = parseCharBeat(raw('隔壁市的机场'), char, ['小满'], [], places);
            expect(b.location).toBe('隔壁市的机场');
            expect(b.placeId).toBeUndefined();
        });

        it('⛔ 不传地点表（老调用点）行为完全不变', () => {
            const b = parseCharBeat(raw('面馆'), char, ['小满']);
            expect(b.location).toBe('面馆');
            expect(b.placeId).toBeUndefined();
        });

        it('模型没给 JSON 时的兜底也会尝试对一次（住处可能就在清单上）', () => {
            const home = [{ id: 'home', name: '住处' }];
            expect(parseCharBeat('胡言乱语', char, ['小满'], [], home).placeId).toBe('home');
            expect(parseCharBeat('胡言乱语', char, ['小满'], [], places).placeId).toBeUndefined();
        });
    });
});


describe('待发生事件底座（阶段 3）', () => {
    const members = [
        { id: 'a', name: '小满' },
        { id: 'b', name: '阿岚' },
        { id: 'c', name: '阿澄' },
    ];
    const mkWorld = (pendings: any[] = []) => ({
        id: 'w1', name: '小镇', storyClock: 10, relationships: [], pendings,
    } as any);
    const beatWith = (appointments: any[]) => ({
        charId: 'a', charName: '小满', location: '住处', narrative: 'x', mood: '平静', appointments,
    } as any);

    describe('collectAppointments —— 约定落表', () => {
        it('⭐ 说定的事变成一条待发生事件，双方共用一条', () => {
            const w = mkWorld();
            collectAppointments(w, beatWith([{ with: '阿岚', what: '一起去看那个展', where: '美术馆', inRounds: 2 }]), members, 10);
            expect(w.pendings).toHaveLength(1);
            expect(w.pendings[0]).toMatchObject({
                kind: 'appointment', text: '一起去看那个展', placeName: '美术馆',
                dueRound: 12, status: 'scheduled', createdRound: 10,
            });
            // ⛔ 一条记录两个人，不是各落一条 —— 否则 A 那条 fired 了 B 那条还躺着
            expect([...w.pendings[0].charIds].sort()).toEqual(['a', 'b']);
        });

        it('⭐ 默认提前 1 轮预热 —— 约定与兑现之间那点忐忑正是它比随机相遇好玩的地方', () => {
            const w = mkWorld();
            collectAppointments(w, beatWith([{ with: '阿岚', what: '看展', inRounds: 3 }]), members, 10);
            expect(w.pendings[0].leadRounds).toBe(1);
        });

        it('⭐ 对上地点表就带 placeId（给将来上地图用）', () => {
            const w = { ...mkWorld(), places: [{ id: 'p_m', name: '美术馆' }] } as any;
            collectAppointments(w, beatWith([{ with: '阿岚', what: '看展', where: '美术馆', inRounds: 1 }]), members, 10);
            expect(w.pendings[0].placeId).toBe('p_m');
        });

        it('⛔⭐ 去重：A 和 B 各自写下同一个约定，只留一条', () => {
            const w = mkWorld();
            collectAppointments(w, beatWith([{ with: '阿岚', what: '一起去看那个展', inRounds: 2 }]), members, 10);
            const bBeat = {
                charId: 'b', charName: '阿岚', location: 'x', narrative: 'x', mood: 'x',
                appointments: [{ with: '小满', what: '一起去看那个展', inRounds: 2 }],
            } as any;
            collectAppointments(w, bBeat, members, 10);
            expect(w.pendings).toHaveLength(1);
        });

        it('⛔ 和不存在的人 / 和自己约的一律丢掉', () => {
            const w = mkWorld();
            collectAppointments(w, beatWith([
                { with: '查无此人', what: '看展', inRounds: 1 },
                { with: '小满', what: '自言自语', inRounds: 1 },
            ]), members, 10);
            expect(w.pendings).toHaveLength(0);
        });

        it('⛔ 没有约定时不建表、不写脏数据', () => {
            const w = mkWorld();
            collectAppointments(w, beatWith([]), members, 10);
            expect(w.pendings).toHaveLength(0);
            const w2 = { id: 'w', name: 'x', storyClock: 1, relationships: [] } as any;
            collectAppointments(w2, { charId: 'a', charName: '小满', location: 'x', narrative: 'x', mood: 'x' } as any, members, 1);
            expect(w2.pendings).toBeUndefined();
        });
    });

    describe('buildPendingNotes —— 注入文案', () => {
        const pend = (over: any = {}) => ({
            id: 'p1', kind: 'appointment', charIds: ['a', 'b'], text: '一起去看那个展',
            dueRound: 12, leadRounds: 1, status: 'scheduled', createdRound: 10, ...over,
        });

        it('⭐ 到点那轮进 due', () => {
            const notes = buildPendingNotes(mkWorld([pend()]), 'a', 12, members);
            expect(notes.due).toHaveLength(1);
            expect(notes.due[0]).toContain('阿岚');
            expect(notes.due[0]).toContain('一起去看那个展');
            expect(notes.preheat).toHaveLength(0);
        });

        it('⭐⛔ 预热轮只进 preheat，绝不能进 due —— 否则角色会提前把事办了，期待感归零', () => {
            const notes = buildPendingNotes(mkWorld([pend()]), 'a', 11, members);
            expect(notes.due).toHaveLength(0);
            expect(notes.preheat).toHaveLength(1);
            // 措辞在第十六批改成了口语的「就这两天 / 还有 N 天」——比「再过 1 个半天」自然
            expect(notes.preheat[0]).toContain('就这两天');
            expect(notes.preheat[0]).toContain('一起去看那个展');
        });

        it('⛔ 还早的时候两边都不出现，不提前剧透', () => {
            const notes = buildPendingNotes(mkWorld([pend({ dueRound: 20 })]), 'a', 10, members);
            expect(notes.due).toHaveLength(0);
            expect(notes.preheat).toHaveLength(0);
        });

        it('⛔ 不相干的人收不到', () => {
            expect(buildPendingNotes(mkWorld([pend()]), 'c', 12, members).due).toHaveLength(0);
        });

        it('⭐ charIds 空 = 全镇的事，谁都收得到（节日将来走这条）', () => {
            const notes = buildPendingNotes(mkWorld([pend({ charIds: [], text: '灯会' })]), 'c', 12, members);
            expect(notes.due).toHaveLength(1);
            expect(notes.due[0]).toContain('灯会');
        });

        it('⛔ 已经 fired / cancelled 的不再念', () => {
            expect(buildPendingNotes(mkWorld([pend({ status: 'fired' })]), 'a', 12, members).due).toHaveLength(0);
            expect(buildPendingNotes(mkWorld([pend({ status: 'cancelled' })]), 'a', 12, members).due).toHaveLength(0);
        });

        it('没有 leadRounds 就不预热，到点才说', () => {
            const notes = buildPendingNotes(mkWorld([pend({ leadRounds: undefined })]), 'a', 11, members);
            expect(notes.preheat).toHaveLength(0);
        });

        it('⛔ 没有待发生事件的旧世界 → 两个空数组，提示词一个字不多', () => {
            const w = { id: 'w', name: 'x', storyClock: 1, relationships: [] } as any;
            expect(buildPendingNotes(w, 'a', 5, members)).toEqual({ due: [], preheat: [] });
        });
    });

    describe('settlePendings —— 一轮之后结算', () => {
        const pend = (over: any = {}) => ({
            id: 'p1', kind: 'appointment', charIds: ['a', 'b'], text: '看展',
            dueRound: 12, status: 'scheduled', createdRound: 10, ...over,
        });

        it('⭐ 到点注入过就记 fired，下一轮不再重复念', () => {
            const w = mkWorld([pend()]);
            settlePendings(w, 12);
            expect(w.pendings[0].status).toBe('fired');
        });

        it('⛔⭐ 不判断角色到底有没有真去 —— 爽约本身就是戏，系统不替用户裁定', () => {
            // 角色那一拍完全没提这件事，照样记 fired；要不要当成失约由用户自己读剧情判断
            const w = mkWorld([pend()]);
            settlePendings(w, 12);
            expect(w.pendings[0].status).toBe('fired');
            expect(w.pendings[0].status).not.toBe('missed');
        });

        it('⛔ 没到点的不动', () => {
            const w = mkWorld([pend({ dueRound: 20 })]);
            settlePendings(w, 12);
            expect(w.pendings[0].status).toBe('scheduled');
        });

        it('⛔ 用户取消过的不会被改回来', () => {
            const w = mkWorld([pend({ status: 'cancelled' })]);
            settlePendings(w, 99);
            expect(w.pendings[0].status).toBe('cancelled');
        });

        it('旧世界没有这张表也不崩', () => {
            const w = { id: 'w', name: 'x', storyClock: 1, relationships: [] } as any;
            expect(() => settlePendings(w, 5)).not.toThrow();
        });
    });

    describe('parseCharBeat 解析 appointments', () => {
        const char = { id: 'a', name: '小满' } as any;
        const raw = (aps: any) => JSON.stringify({ location: '住处', narrative: 'x', mood: 'x', appointments: aps });

        it('收下合法的约定', () => {
            const b = parseCharBeat(raw([{ with: '阿岚', what: '看展', where: '美术馆', inRounds: 2 }]), char, ['小满', '阿岚']);
            expect(b.appointments).toEqual([{ with: '阿岚', what: '看展', where: '美术馆', inRounds: 2 }]);
        });

        it('⛔ with 不是成员就丢掉 —— 对不上号的话到点也没法注入给对方', () => {
            const b = parseCharBeat(raw([{ with: '路人甲', what: '看展', inRounds: 1 }]), char, ['小满', '阿岚']);
            expect(b.appointments).toBeUndefined();
        });

        it('inRounds 夹在 1~8：0 不是约定，太远的注定被忘', () => {
            const b = parseCharBeat(raw([
                { with: '阿岚', what: 'A', inRounds: 0 },
                { with: '阿岚', what: 'B', inRounds: 999 },
            ]), char, ['小满', '阿岚']);
            expect(b.appointments!.map(a => a.inRounds)).toEqual([1, 8]);
        });

        it('⛔ 没写 appointments 的旧输出照常解析，字段为 undefined', () => {
            const b = parseCharBeat(JSON.stringify({ location: '住处', narrative: 'x', mood: 'x' }), char, ['小满']);
            expect(b.appointments).toBeUndefined();
        });
    });
});


describe('节日（阶段 3.2）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];
    const simWorld = (over: any = {}) => ({
        id: 'w1', name: '小镇', relationships: [], timeMode: 'sim',
        simStartDate: { year: 2026, month: 3, day: 1 }, storyClock: 0, ...over,
    } as any);

    describe('worldDateOfRound —— 某一轮是哪天', () => {
        it('sim：起始日 + 轮/4 天（一天四段）', () => {
            const w = simWorld();
            expect(worldDateOfRound(w, 0)).toEqual({ year: 2026, month: 3, day: 1 });
            expect(worldDateOfRound(w, 3)).toEqual({ year: 2026, month: 3, day: 1 });
            expect(worldDateOfRound(w, 4)).toEqual({ year: 2026, month: 3, day: 2 });
            expect(worldDateOfRound(w, 40)).toEqual({ year: 2026, month: 3, day: 11 });
        });

        it('sim：会翻月', () => {
            expect(worldDateOfRound(simWorld({ simStartDate: { year: 2026, month: 3, day: 30 } }), 8))
                .toEqual({ year: 2026, month: 4, day: 1 });
        });

        it('real：以已演到的那天为基准按轮差折算', () => {
            const w = { id: 'w', name: 'x', relationships: [], timeMode: 'real',
                realClock: { dayKey: '2026-09-16', seg: 1 }, storyClock: 20 } as any;
            expect(worldDateOfRound(w, 20)).toEqual({ year: 2026, month: 9, day: 16 });
            expect(worldDateOfRound(w, 24)).toEqual({ year: 2026, month: 9, day: 17 });
        });

        it('⛔ 还没有日历的新世界返回 null —— 没日历自然过不了节', () => {
            expect(worldDateOfRound({ id: 'w', name: 'x', relationships: [], timeMode: 'sim', storyClock: 0 } as any, 0)).toBeNull();
            expect(worldDateOfRound({ id: 'w', name: 'x', relationships: [], timeMode: 'real', storyClock: 0 } as any, 0)).toBeNull();
        });
    });

    describe('scheduleFestivals —— 排进待发生事件表', () => {
        const fest = (over: any = {}) => ({ id: 'f1', name: '渡灯节', blurb: '把旧灯笼放进河里漂走', month: 3, day: 3, ...over });

        it('⭐ 快到的节日会排进表，全镇的事（charIds 空）', () => {
            const w = simWorld({ festivals: [fest()] });
            scheduleFestivals(w, 0);   // 3/1 第一段，3/3 在 8~11 轮
            expect(w.pendings).toHaveLength(1);
            expect(w.pendings[0]).toMatchObject({ kind: 'festival', charIds: [], dueRound: 8, dueUntilRound: 11 });
            expect(w.pendings[0].text).toContain('渡灯节');
            expect(w.pendings[0].text).toContain('把旧灯笼放进河里漂走');
        });

        it('⭐⛔ 节日占满那一整天（4 段），不是挂在某一段上', () => {
            const w = simWorld({ festivals: [fest()] });
            scheduleFestivals(w, 0);
            const p = w.pendings[0];
            expect(p.dueUntilRound! - p.dueRound).toBe(3);
        });

        it('⭐ 默认提前 6 轮（约一天半）预热 —— 好玩的是期待感不是当天', () => {
            const w = simWorld({ festivals: [fest()] });
            scheduleFestivals(w, 0);
            expect(w.pendings[0].leadRounds).toBe(6);
        });

        it('⛔ 幂等：每轮都调也只排一次', () => {
            const w = simWorld({ festivals: [fest()] });
            scheduleFestivals(w, 0);
            scheduleFestivals(w, 1);
            scheduleFestivals(w, 2);
            expect(w.pendings).toHaveLength(1);
        });

        it('⛔ 还远的节日先不排（看太远 real 模式会越算越偏）', () => {
            const w = simWorld({ festivals: [fest({ month: 12, day: 25 })] });
            scheduleFestivals(w, 0);
            expect(w.pendings || []).toHaveLength(0);
        });

        it('⛔ 关掉的节日不排', () => {
            const w = simWorld({ festivals: [fest({ enabled: false })] });
            scheduleFestivals(w, 0);
            expect(w.pendings || []).toHaveLength(0);
        });

        it('⛔ 没有节日律法 / 没有日历时什么都不做，不崩', () => {
            const w1 = simWorld();
            scheduleFestivals(w1, 0);
            expect(w1.pendings).toBeUndefined();
            const w2 = { id: 'w', name: 'x', relationships: [], timeMode: 'sim', storyClock: 0, festivals: [fest()] } as any;
            expect(() => scheduleFestivals(w2, 0)).not.toThrow();
            expect(w2.pendings || []).toHaveLength(0);
        });

        it('明年同一天会重新排一次（source 带年份）', () => {
            const w = simWorld({ festivals: [fest({ month: 3, day: 2 })] });
            scheduleFestivals(w, 0);
            expect(w.pendings).toHaveLength(1);
            // 跳到快一年后的同一天前夕
            w.storyClock = 4 * 365;
            scheduleFestivals(w, 4 * 365);
            expect(w.pendings.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('节日的注入措辞', () => {
        const festPending = (over: any = {}) => ({
            id: 'p1', kind: 'festival', charIds: [], text: '渡灯节——把旧灯笼放进河里漂走',
            dueRound: 8, dueUntilRound: 11, leadRounds: 6, status: 'scheduled', createdRound: 0, ...over,
        });
        const w = (p: any[]) => ({ id: 'w', name: 'x', relationships: [], storyClock: 0, pendings: p } as any);

        it('⭐ 正日子那天全镇的人都收到', () => {
            for (const r of [8, 9, 10, 11]) {
                const notes = buildPendingNotes(w([festPending()]), 'a', r, members);
                expect(notes.due).toHaveLength(1);
                expect(notes.due[0]).toContain('今天是镇上的');
            }
        });

        it('⭐ 预热说「还有几天」而不是「还有几个半天」', () => {
            const notes = buildPendingNotes(w([festPending()]), 'a', 3, members);
            expect(notes.preheat[0]).toContain('还有 1 天');
            expect(notes.preheat[0]).not.toContain('个半天');
        });

        it('⭐⛔ 预热那句要明说「还没到」，别让角色提前把节过了', () => {
            const notes = buildPendingNotes(w([festPending()]), 'a', 3, members);
            expect(notes.due).toHaveLength(0);
            expect(notes.preheat[0]).toContain('镇上已经有动静了');
        });

        it('⛔ 过完最后一段才收 —— 否则灯会只在早上有', () => {
            const p = w([festPending()]);
            settlePendings(p, 9);
            expect(p.pendings[0].status).toBe('scheduled');
            settlePendings(p, 11);
            expect(p.pendings[0].status).toBe('fired');
        });
    });

    describe('buildFestivalNote —— 喂给世界引擎的公共场景（补充②）', () => {
        const w = (p: any[]) => ({ id: 'w', name: 'x', relationships: [], storyClock: 0, pendings: p } as any);
        const festPending = (over: any = {}) => ({
            id: 'p1', kind: 'festival', charIds: [], text: '渡灯节——把旧灯笼放进河里漂走',
            dueRound: 8, dueUntilRound: 11, leadRounds: 6, status: 'scheduled', createdRound: 0, ...over,
        });

        it('⭐ 正日子标「今天就是正日子」', () => {
            expect(buildFestivalNote(w([festPending()]), 9)).toContain('今天就是正日子');
        });

        it('⭐⛔ 预热期要明写「别提前把节过了」', () => {
            const note = buildFestivalNote(w([festPending()]), 3);
            expect(note).toContain('别提前把节过了');
        });

        it('⛔ 没节日 / 还早 → 空串，世界引擎提示词一个字不多', () => {
            expect(buildFestivalNote(w([]), 5)).toBe('');
            expect(buildFestivalNote(w([festPending()]), 0)).toBe('');
        });

        it('⛔ 约定不会混进世界引擎 —— 那是两个人私下的事，不是全镇的公共场景', () => {
            const appointment = { id: 'p2', kind: 'appointment', charIds: ['a', 'b'], text: '看展',
                dueRound: 2, status: 'scheduled', createdRound: 0 };
            expect(buildFestivalNote(w([appointment]), 2)).toBe('');
        });
    });

    describe('parseRolledFestivals', () => {
        it('收下合法的节日', () => {
            const raw = JSON.stringify({ festivals: [{ name: '渡灯节', blurb: '放灯', month: 3, day: 3 }] });
            expect(parseRolledFestivals(raw)).toEqual([{ name: '渡灯节', blurb: '放灯', month: 3, day: 3 }]);
        });

        it('⛔ 日期不合法整条丢掉 —— 瞎猜一个日子会让节日落在莫名其妙的时候', () => {
            const raw = JSON.stringify({ festivals: [
                { name: 'A', month: 13, day: 1 },
                { name: 'B', month: 3, day: 40 },
                { name: 'C', month: 3, day: 3 },
            ] });
            expect(parseRolledFestivals(raw).map(f => f.name)).toEqual(['C']);
        });

        it('⛔ 重名的不收（含已有的）', () => {
            const raw = JSON.stringify({ festivals: [{ name: '渡灯节', month: 1, day: 1 }] });
            expect(parseRolledFestivals(raw, ['渡灯节'])).toHaveLength(0);
        });

        it('模型吐裸数组也认（同 parseRolledNpcs 的兜底）', () => {
            expect(parseRolledFestivals('[{"name":"落雪祭","month":12,"day":1}]')).toHaveLength(1);
        });

        it('⛔ 垃圾输入返回空数组，不崩', () => {
            expect(parseRolledFestivals('胡言乱语')).toEqual([]);
            expect(parseRolledFestivals('')).toEqual([]);
        });
    });
});


describe('好感阈值大事件（阶段 3.3）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];
    const th = (over: any = {}) => ({
        id: 't1', name: '心意压不住了', value: 60, direction: 'up' as const,
        text: '你发现这份心意已经压不住了', ...over,
    });
    const mkWorld = (thresholds: any[], rel: any) => ({
        id: 'w1', name: '小镇', storyClock: 5, thresholds, relationships: [rel],
    } as any);
    const beat = (delta: number) => ([{
        charId: 'a', charName: '小满',
        relationshipDeltas: [{ withName: '阿岚', delta }],
    }] as any);

    describe('越线检测', () => {
        it('⭐ 涨过线时排一条大事件', () => {
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            expect(w.pendings).toHaveLength(1);
            expect(w.pendings[0]).toMatchObject({ kind: 'threshold', charIds: ['a'], dueRound: 7, status: 'scheduled' });
            expect(w.pendings[0].text).toContain('压不住');
        });

        it('⭐ 文案里带上对方是谁 —— 光说「有件事该说清楚了」角色不知道跟谁', () => {
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            expect(w.pendings[0].text).toContain('阿岚');
        });

        it('⛔⭐ 判据是「越过」不是「达到」—— 否则好感在线上下抖一抖会反复触发', () => {
            // 已经在线上方，再涨不算越线
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 70 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            expect(w.pendings || []).toHaveLength(0);
        });

        it('⭐ 跌破那一档（敌对线）也能触发', () => {
            const w = mkWorld([th({ value: -45, direction: 'down', text: '这段关系撑不住了' })],
                { fromId: 'a', toId: 'b', value: -42 });
            applyRelationshipDeltas(w, beat(-4), members, 5);
            expect(w.pendings).toHaveLength(1);
            expect(w.pendings[0].text).toContain('撑不住');
        });

        it('⛔ 方向不对不触发（好感在涨，不该触发「跌破」那条）', () => {
            const w = mkWorld([th({ value: 60, direction: 'down' })], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            expect(w.pendings || []).toHaveLength(0);
        });

        it('⛔⭐ 同一对人 + 同一条线只触发一次 —— 恋爱线不该每次越线都重演', () => {
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);           // 越过
            w.relationships[0].value = 55;                              // 掉回来
            applyRelationshipDeltas(w, beat(10), members, 9);           // 又越过
            expect(w.pendings).toHaveLength(1);
        });

        it('⛔ 连已经演完 / 被取消的也算过一次', () => {
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            w.pendings[0].status = 'cancelled';
            w.relationships[0].value = 55;
            applyRelationshipDeltas(w, beat(10), members, 9);
            expect(w.pendings).toHaveLength(1);
        });

        it('⛔⭐ 锁住的关系永不触发 —— 好感根本不动，白拿的保护（2.2）', () => {
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 58, locked: true });
            applyRelationshipDeltas(w, beat(40), members, 5);
            expect(w.relationships[0].value).toBe(58);
            expect(w.pendings || []).toHaveLength(0);
        });

        it('⛔ 关掉的那条不触发', () => {
            const w = mkWorld([th({ enabled: false })], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            expect(w.pendings || []).toHaveLength(0);
        });

        it('⛔ 没配转折点的世界什么都不会触发（旧世界零变化）', () => {
            const w = { id: 'w', name: 'x', relationships: [{ fromId: 'a', toId: 'b', value: 58 }] } as any;
            applyRelationshipDeltas(w, beat(40), members, 5);
            expect(w.pendings).toBeUndefined();
        });

        it('⛔⭐ 只给产生变化的那一方 —— 关系是有向的，两边都塞会凭空造出双向默契', () => {
            const w = mkWorld([th()], { fromId: 'a', toId: 'b', value: 58 });
            applyRelationshipDeltas(w, beat(4), members, 5);
            expect(w.pendings[0].charIds).toEqual(['a']);
            expect(w.pendings[0].charIds).not.toContain('b');
        });

        it('A→B 和 B→A 各算各的（两条独立的边）', () => {
            const w = {
                id: 'w1', name: '小镇', storyClock: 5, thresholds: [th()],
                relationships: [
                    { fromId: 'a', toId: 'b', value: 58 },
                    { fromId: 'b', toId: 'a', value: 58 },
                ],
            } as any;
            applyRelationshipDeltas(w, [
                { charId: 'a', charName: '小满', relationshipDeltas: [{ withName: '阿岚', delta: 4 }] },
                { charId: 'b', charName: '阿岚', relationshipDeltas: [{ withName: '小满', delta: 4 }] },
            ] as any, members, 5);
            expect(w.pendings).toHaveLength(2);
            expect(w.pendings.map((p: any) => p.charIds[0]).sort()).toEqual(['a', 'b']);
        });
    });

    describe('注入措辞', () => {
        const pend = (over: any = {}) => ({
            id: 'p1', kind: 'threshold', charIds: ['a'], text: '你发现这份心意已经压不住了（对方是阿岚）',
            dueRound: 7, leadRounds: 2, status: 'scheduled', createdRound: 5, ...over,
        });
        const w = (p: any[]) => ({ id: 'w', name: 'x', relationships: [], storyClock: 5, pendings: p } as any);

        it('⭐⛔ 只把事摆到桌上，不规定结果 —— 「今天必须告白」会把角色演崩', () => {
            const notes = buildPendingNotes(w([pend()]), 'a', 7, members);
            expect(notes.due).toHaveLength(1);
            expect(notes.due[0]).toContain('不得不面对');
            expect(notes.due[0]).toContain('别为了推进剧情而勉强自己');
            // 措辞里明确留了「没说出口」这条路
            expect(notes.due[0]).toContain('又一次没说出口');
        });

        it('⭐ 预热期是「压在心里还没到摊开的时候」，不是提前演', () => {
            const notes = buildPendingNotes(w([pend()]), 'a', 6, members);
            expect(notes.due).toHaveLength(0);
            expect(notes.preheat[0]).toContain('还没到摊开的时候');
        });

        it('⛔ 不相干的人收不到', () => {
            expect(buildPendingNotes(w([pend()]), 'b', 7, members).due).toHaveLength(0);
        });

        it('⛔ 不会混进喂给世界引擎的公共场景 —— 这是一个人心里的事', () => {
            expect(buildFestivalNote(w([pend()]), 7)).toBe('');
        });
    });

    describe('parseRolledThresholds', () => {
        it('收下合法的', () => {
            const raw = JSON.stringify({ thresholds: [{ name: 'A', value: 60, direction: 'up', text: '你……' }] });
            expect(parseRolledThresholds(raw)).toEqual([{ name: 'A', value: 60, direction: 'up', text: '你……' }]);
        });

        it('⛔ 数值非法整条丢掉 —— 越线判据全靠这个数', () => {
            const raw = JSON.stringify({ thresholds: [
                { name: 'A', value: 200, direction: 'up', text: 'x' },
                { name: 'B', value: 'abc', direction: 'up', text: 'x' },
                { name: 'C', value: -50, direction: 'down', text: 'x' },
            ] });
            expect(parseRolledThresholds(raw).map(t => t.name)).toEqual(['C']);
        });

        it('direction 只认 down，其余一律当 up', () => {
            const raw = JSON.stringify({ thresholds: [{ name: 'A', value: 1, direction: '乱写', text: 'x' }] });
            expect(parseRolledThresholds(raw)[0].direction).toBe('up');
        });

        it('⛔ 没有 text 的不收 —— 光有个名字注入不进去', () => {
            expect(parseRolledThresholds(JSON.stringify({ thresholds: [{ name: 'A', value: 1 }] }))).toHaveLength(0);
        });

        it('⛔ 垃圾输入返回空数组，不崩', () => {
            expect(parseRolledThresholds('胡言乱语')).toEqual([]);
        });
    });

    describe('GENERIC_THRESHOLDS —— 点了才有的通用三条', () => {
        it('三条里有涨有跌，不是只有恋爱线', () => {
            expect(GENERIC_THRESHOLDS.some(t => t.direction === 'up')).toBe(true);
            expect(GENERIC_THRESHOLDS.some(t => t.direction === 'down')).toBe(true);
        });

        it('⛔⭐ 措辞是「该发生的事」而不是结局 —— 不替角色做决定', () => {
            for (const t of GENERIC_THRESHOLDS) {
                expect(t.text).toContain('你');
                for (const forbidden of ['告白了', '在一起了', '绝交了', '分手了']) {
                    expect(t.text).not.toContain(forbidden);
                }
            }
        });

        it('数值都在合法范围内', () => {
            for (const t of GENERIC_THRESHOLDS) {
                expect(t.value).toBeGreaterThanOrEqual(-100);
                expect(t.value).toBeLessThanOrEqual(100);
            }
        });
    });
});


describe('送礼（阶段 3.4）', () => {
    const members = [{ id: 'a', name: '小满' }, { id: 'b', name: '阿岚' }];
    const mkWorld = () => ({ id: 'w1', name: '小镇', storyClock: 5, relationships: [] } as any);
    const beatWith = (gifts: any[]) => ({
        charId: 'a', charName: '小满', location: '住处', narrative: 'x', mood: '平静', gifts,
    } as any);

    describe('collectGifts —— 投递', () => {
        it('⭐ 送给镇上的人 → 落进对方收件箱', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([{ to: '阿岚', what: '一束晒干的薰衣草', why: '她提过喜欢那个味道' }]), members, 5);
            expect(w.giftInbox).toHaveLength(1);
            expect(w.giftInbox[0]).toMatchObject({ toId: 'b', fromId: 'a', fromName: '小满', what: '一束晒干的薰衣草' });
        });

        it('⭐ 送给机主 → 另走一条路，等机主自己点反应', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([{ to: '颜千夜', what: '一张纸条' }]), members, 5, '颜千夜');
            expect(w.giftInbox).toBeUndefined();
            expect(w.giftsForHost).toHaveLength(1);
            expect(w.giftsForHost[0]).toMatchObject({ fromId: 'a', fromName: '小满', what: '一张纸条' });
        });

        it('⛔ 送给查无此人 / 送给自己的丢掉', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([
                { to: '路人甲', what: 'x' },
                { to: '小满', what: '自己送自己' },
            ]), members, 5);
            expect(w.giftInbox || []).toHaveLength(0);
        });

        it('⛔ 没送东西时不建表', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([]), members, 5);
            expect(w.giftInbox).toBeUndefined();
        });

        it('⛔ 没传机主名时，机主名不会被当成成员', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([{ to: '颜千夜', what: 'x' }]), members, 5);
            expect(w.giftInbox || []).toHaveLength(0);
            expect(w.giftsForHost).toBeUndefined();
        });
    });

    describe('takeGifts —— 领取', () => {
        it('⭐ 收礼方那一轮取走，文案带上是谁送的、为什么', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([{ to: '阿岚', what: '薰衣草', why: '她提过喜欢' }]), members, 5);
            const notes = takeGifts(w, 'b');
            expect(notes).toHaveLength(1);
            expect(notes[0]).toContain('小满');
            expect(notes[0]).toContain('薰衣草');
            expect(notes[0]).toContain('她提过喜欢');
        });

        it('⛔⭐ 取走即清除 —— 留着会每轮重复念', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([{ to: '阿岚', what: '薰衣草' }]), members, 5);
            expect(takeGifts(w, 'b')).toHaveLength(1);
            expect(takeGifts(w, 'b')).toHaveLength(0);
        });

        it('⛔ 只取自己那份，别人的留着', () => {
            const w = mkWorld();
            collectGifts(w, beatWith([{ to: '阿岚', what: 'x' }]), members, 5);
            expect(takeGifts(w, 'a')).toHaveLength(0);
            expect(w.giftInbox).toHaveLength(1);
        });

        it('⛔ 没有收件箱的旧世界不崩', () => {
            expect(takeGifts(mkWorld(), 'a')).toEqual([]);
        });
    });

    describe('parseCharBeat 解析 gifts', () => {
        const char = { id: 'a', name: '小满' } as any;
        const raw = (gifts: any) => JSON.stringify({ location: '住处', narrative: 'x', mood: 'x', gifts });

        it('收下合法的', () => {
            const b = parseCharBeat(raw([{ to: '阿岚', what: '薰衣草', why: '她提过' }]), char, ['小满', '阿岚']);
            expect(b.gifts).toEqual([{ to: '阿岚', what: '薰衣草', why: '她提过' }]);
        });

        it('⭐ 传了机主名才能送给机主', () => {
            const withHost = parseCharBeat(raw([{ to: '颜千夜', what: 'x' }]), char, ['小满'], [], undefined, '颜千夜');
            expect(withHost.gifts).toHaveLength(1);
            const without = parseCharBeat(raw([{ to: '颜千夜', what: 'x' }]), char, ['小满']);
            expect(without.gifts).toBeUndefined();
        });

        it('⛔ 送给查无此人的丢掉 —— 没人收得到', () => {
            expect(parseCharBeat(raw([{ to: '路人甲', what: 'x' }]), char, ['小满', '阿岚']).gifts).toBeUndefined();
        });

        it('⛔ 没写 gifts 的旧输出照常解析', () => {
            expect(parseCharBeat(JSON.stringify({ location: 'x', narrative: 'x', mood: 'x' }), char, ['小满']).gifts).toBeUndefined();
        });
    });

    describe('buildGiftTasteNote —— ta 自己的口味', () => {
        const char = { giftTaste: {
            love: ['有人记得她随口提过的事'], like: ['手写的信'], meh: ['吃的'],
            dislike: ['贵重的东西'], hate: ['不打招呼就上门'],
        } } as any;

        it('五档都列出来', () => {
            const note = buildGiftTasteNote(char);
            for (const x of ['有人记得她随口提过的事', '手写的信', '吃的', '贵重的东西', '不打招呼就上门']) {
                expect(note).toContain(x);
            }
        });

        it('⛔⭐ 不注入数值、不规定好感加减多少 —— 一写数字模型就开始算分', () => {
            const note = buildGiftTasteNote(char);
            for (const forbidden of ['好感 +', '好感+', '加 5', '扣 5', '分']) {
                expect(note).not.toContain(forbidden);
            }
        });

        it('⭐ 明说「不喜欢也别硬夸」，但要不要表现出来看性格', () => {
            const note = buildGiftTasteNote(char);
            expect(note).toContain('别硬夸');
            expect(note).toContain('取决于你是个什么样的人');
        });

        it('用户手写的补充会带上', () => {
            expect(buildGiftTasteNote({ giftTaste: { note: '对花粉过敏' } } as any)).toContain('对花粉过敏');
        });

        it('⛔ 没填 → 空串，旧角色零变化', () => {
            expect(buildGiftTasteNote({} as any)).toBe('');
            expect(buildGiftTasteNote({ giftTaste: {} } as any)).toBe('');
            expect(buildGiftTasteNote({ giftTaste: { love: ['  ', ''] } } as any)).toBe('');
        });
    });

    describe('buildGiftHistoryNote —— 反馈回路', () => {
        it('⭐ 把机主的反应说清楚，ta 下次才知道该往哪送', () => {
            const note = buildGiftHistoryNote({ giftsToHost: [
                { what: '薰衣草', at: 1, reaction: 'love' },
                { what: '一本旧书', at: 2, reaction: 'dislike' },
            ] } as any, '颜千夜');
            expect(note).toContain('薰衣草');
            expect(note).toContain('非常喜欢');
            expect(note).toContain('一本旧书');
            expect(note).toContain('不太喜欢');
        });

        it('⛔⭐ 还没表态的要明说「你还不知道」—— 不说模型会默认送对了', () => {
            const note = buildGiftHistoryNote({ giftsToHost: [{ what: '纸条', at: 1 }] } as any, '颜千夜');
            expect(note).toContain('还不知道');
        });

        it('只留最近几条', () => {
            const many = { giftsToHost: Array.from({ length: 20 }, (_, i) => ({ what: `礼物${i}`, at: i })) } as any;
            const note = buildGiftHistoryNote(many, '颜千夜', 3);
            expect(note.split(String.fromCharCode(10)).filter(l => l.startsWith('- ')).length).toBe(3);
            expect(note).toContain('礼物19');
            expect(note).not.toContain('礼物0】');
        });

        it('⛔ 没送过 → 空串', () => {
            expect(buildGiftHistoryNote({} as any, '颜千夜')).toBe('');
            expect(buildGiftHistoryNote({ giftsToHost: [] } as any, '颜千夜')).toBe('');
        });
    });
});


describe('你住进小镇（阶段 4.1）', () => {
    const U = '颜千夜';

    describe('buildHostPresenceSection', () => {
        it('⛔ absent / 缺省 → 空串，行为与阶段 4 之前完全一致', () => {
            expect(buildHostPresenceSection('absent', U)).toBe('');
            expect(buildHostPresenceSection(undefined, U)).toBe('');
            expect(buildHostPresenceSection(undefined, U, { text: '写了也没用' })).toBe('');
        });

        it('⭐⛔ 静默档必须明说「不要替 ta 说话或行动」', () => {
            const t = buildHostPresenceSection('silent', U);
            expect(t).toContain(U);
            expect(t).toContain('不要替 ta 说话');
            expect(t).toContain('没有发生任何互动');
        });

        it('⭐ 写了大纲 → 原样给出去，并要求只依据写出来的部分反应', () => {
            const t = buildHostPresenceSection('outline', U, { text: '我去咖啡厅坐了一下午' });
            expect(t).toContain('我去咖啡厅坐了一下午');
            expect(t).toContain('别替 ta 补充没写的动作');
        });

        it('⭐⛔ 必须明说「别把话头留在那儿等回应」—— 这是「不许来回」的提示词侧', () => {
            const t = buildHostPresenceSection('outline', U, { text: '我去找他了' });
            expect(t).toContain('别把话头留在那儿等');
            expect(t).toContain('就这一次');
        });

        it('⛔⭐ 选了写大纲却没写 → 退回「在场但没动作」，绝不让模型自己发挥', () => {
            for (const p of ['outline', 'ghostwrite'] as const) {
                const t = buildHostPresenceSection(p, U, null);
                expect(t).toContain('不要替 ta 说话');
                expect(t).not.toContain('这半天做了什么');
            }
            expect(buildHostPresenceSection('outline', U, { text: '   ' })).toContain('不要替 ta 说话');
        });

        it('代笔写出来的和自己写的走同一条路（下游不区分）', () => {
            const mine = buildHostPresenceSection('outline', U, { text: '同一句话' });
            const ai = buildHostPresenceSection('ghostwrite', U, { text: '同一句话', byAi: true });
            expect(ai).toBe(mine);
        });
    });

    describe('buildModeRule 撞上「住进小镇」', () => {
        it('⛔⭐ 不住的时候，四档措辞一个字都没变（回归保护）', () => {
            expect(buildModeRule('heavy', U)).toContain('不存在');
            expect(buildModeRule('distant', U)).toContain('不住在这个世界');
            expect(buildModeRule('light', U)).toContain('此刻 ta 不在场');
            expect(buildModeRule('medium', U)).toContain('此刻 ta 不在场');
        });

        it('⛔⭐ 住进来之后，「ta 不存在 / 不在场」这类话必须消失 —— 那是直接的自相矛盾', () => {
            for (const mode of ['light', 'medium', 'heavy', 'distant'] as const) {
                const t = buildModeRule(mode, U, 'outline');
                expect(t).toContain('就住在这个镇上');
                for (const forbidden of ['不存在', '不在场', '不要凭空让 ta 登场', '不住在这个世界', '上辈子的梦']) {
                    expect(t).not.toContain(forbidden);
                }
            }
        });

        it('⭐ 轻度住进来仍然保留「你最重要的人」那半句', () => {
            expect(buildModeRule('light', U, 'silent')).toContain('最重要的人');
        });

        it('⭐ 中度住进来仍然保留「不围着 ta 转」', () => {
            expect(buildModeRule('medium', U, 'silent')).toContain('不围着 ta 转');
        });

        it('重度 / 远方住进来 → 按普通镇民处理（冲突交给界面提示）', () => {
            for (const mode of ['heavy', 'distant'] as const) {
                expect(buildModeRule(mode, U, 'ghostwrite')).toContain('一个居民');
            }
        });
    });

    describe('buildGhostwritePrompt', () => {
        const args = {
            world: { name: '小镇', worldview: '一个安静的小世界' },
            userName: U,
            storyTime: '第3天 白天',
            memberNames: ['小满', '阿岚'],
        };

        it('⭐⛔ 必须明写「别写成讨好」—— 这是代笔档唯一的写作要求', () => {
            const t = buildGhostwritePrompt(args);
            expect(t).toContain('别写成讨好');
            expect(t).toContain('平淡的半天完全合格');
        });

        it('⛔ 必须禁止替镇上的角色写反应', () => {
            expect(buildGhostwritePrompt(args)).toContain('别替镇上的角色写反应');
        });

        it('带上世界观、剧情时间、镇上还有谁', () => {
            const t = buildGhostwritePrompt(args);
            expect(t).toContain('一个安静的小世界');
            expect(t).toContain('第3天 白天');
            expect(t).toContain('小满');
        });

        it('机主的自我介绍会带上（有才带）', () => {
            expect(buildGhostwritePrompt({ ...args, userPersona: '话很少的人' })).toContain('话很少的人');
            expect(buildGhostwritePrompt(args)).not.toContain('是个什么样的人');
        });
    });
});
