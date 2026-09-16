import { loadCharacterContextMessages } from '../chatContextRange';
/**
 * 「家园」演绎引擎 —— 一轮"观测"的完整闭环。
 *
 * 成本模型（刻意不做真实时间常驻运行）：
 *   - 用户每次"观测"（手动推进）或每日有限次离线 tick 触发一轮演绎
 *   - 一轮 = 1 次 NPC 世界引擎调用（一口气演完所有 NPC，NPC 无记忆）
 *          + N 次角色调用（链式，每角色一次，确保没人开上帝视角）
 *   - 一轮推进半天剧情时间；"我不看的时候世界慢慢走，我一看就加速"
 *
 * 每个角色的调用复用聊天主链路 buildChatRequestPayload：
 *   ContextBuilder 人设 + 角色设定的私聊上下文条数 + 记忆宫殿
 *   （召回 query 注入"同世界其他角色"，让角色记得自己跟他们的过往）。
 *
 * 产出注入：每个成员的 1v1 聊天各落一条 world_card（可解析 metadata），
 * 与彼方 vr_card 同构，天然进入上下文与记忆管线。
 */

import type {
    CharacterProfile, UserProfile, GroupProfile, RealtimeConfig, APIConfig,
    WorldProfile, WorldEpisode, WorldCharBeat, WorldCardMeta, WorldCardShareMeta, WorldRelationship,
} from '../../types';
import { DB } from '../db';
import { applyBondChange, buildBondChangeNotice, applyCharBondChange } from '../characterIdentity';
import { buildChatRequestPayload } from '../chatRequestPayload';
import { safeFetchJson } from '../safeApi';
import { processNewMessagesWithAutoArchive } from '../memoryPalace/autoArchive';
import { getDailyScheduleForChar } from '../dailySchedule';
import {
    worldTimeLabel, buildWorldSystemAddendum, buildWorldCharTurn, buildNpcTurn,
    parseCharBeat, parseNpcScene, realObserveTarget, formatRealClock, migrateWorldDaySegs, resolvePlaceId,
    worldDateOfRound, SEGMENTS_PER_DAY, buildGhostwritePrompt,
    alignCharToWorldClock,
} from './prompts';
import { ensureThreads, applyBeatToThreads, applyNpcGroupLines, applyNpcDms, npcInboxes } from './threads';
import { shouldCloseChapter, summarizeChapter, SIM_CHAPTER_CLOCKS } from './chapters';

interface MemoryConfigLike {
    embedding?: { baseUrl?: string; apiKey?: string; model?: string; dimensions?: number };
    lightLLM?: { baseUrl?: string; apiKey?: string; model?: string };
}

export interface WorldEpisodeDeps {
    world: WorldProfile;
    characters: CharacterProfile[];
    apiConfig: APIConfig;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    memoryPalaceConfig?: MemoryConfigLike;
    trigger: 'observe' | 'tick';
}

export interface WorldEpisodeResult {
    ok: boolean;
    reason?: string;
    episode?: WorldEpisode;
}

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const running = new Set<string>();

/** 读家园全局 API（设置弹窗写入 localStorage 的 'world_home_api'；不设返回 null）。 */
function readWorldHomeApiOverride(): { baseUrl: string; apiKey: string; model: string } | null {
    try {
        const s = typeof localStorage !== 'undefined' ? localStorage.getItem('world_home_api') : null;
        const c = s ? JSON.parse(s) : null;
        return c?.baseUrl ? c : null;
    } catch { return null; }
}

export function isWorldRunning(worldId: string): boolean {
    return running.has(worldId);
}

const dispatch = (name: string, detail: any) => {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* SSR */ }
};

/**
 * 关系 delta 回填。关系有向：A 的演绎里"和 B 关系 +2"只代表 **A 对 B** 的好感变了，
 * B 对 A 怎么想由 B 自己的演绎轮决定——两边完全可以不对等。不存在的边按 50 起步。
 */
/** 角色这一轮对**机主**的关系定位变了（阶段 2.1 的 `hostBond.toHost`）。 */
export interface HostBondDelta {
    charId: string;
    charName: string;
    /** 新的定位（角色给的 relabel） */
    newLabel: string;
    reason?: string;
}

export function applyRelationshipDeltas(
    world: WorldProfile,
    beats: WorldCharBeat[],
    members: { id: string; name: string }[],
    /** 第几轮改的——只用于写进 labelHistory，便于用户回滚时认得出是哪次转折。 */
    round?: number,
    /**
     * 机主名。给了才会把「对机主」那条**挑出来**（它不是镇民，不能进 world.relationships）。
     * 挑出来的部分从返回值拿，由调用方落到 `CharacterProfile.hostBond`——
     * 这里是纯函数，不碰 DB。
     */
    hostName?: string,
): HostBondDelta[] {
    const idOf = (name: string) => members.find(m => m.name === name)?.id;
    const host = (hostName || '').trim();
    const hostDeltas: HostBondDelta[] = [];
    for (const beat of beats) {
        for (const rd of beat.relationshipDeltas || []) {
            // 「对机主」那条：机主不是镇民，落进 world.relationships 会变成一条指向
            // 不存在成员的悬空边。挑出来交给调用方写进 hostBond.toHost。
            if (host && rd.withName?.trim() === host) {
                const label = rd.newLabel?.trim();
                if (label) {
                    hostDeltas.push({
                        charId: beat.charId,
                        charName: beat.charName,
                        newLabel: label,
                        ...(rd.reason ? { reason: rd.reason } : {}),
                    });
                }
                continue;
            }
            const otherId = idOf(rd.withName);
            if (!otherId || otherId === beat.charId) continue;
            let rel = world.relationships.find(r => r.fromId === beat.charId && r.toId === otherId);
            // 关系锁（阶段 2.2）：这条有向边冻着，value 和 label 都不动。
            // 放在建边之前 —— 还不存在的边不可能锁着，所以先找、锁了就走。
            // 注意只跳过这一条 delta：同一 beat 里其他关系照常演绎，
            // 锁的粒度是「这一对」，不是「这个角色这一轮」。
            if (rel?.locked) continue;
            if (!rel) {
                // 没记录的边按「陌生中立」0 起步（不是凭空友善）
                rel = { fromId: beat.charId, toId: otherId, value: 0 };
                world.relationships.push(rel);
            }
            // 好感范围 -100 ~ +100（可为负 = 嫌隙/敌意）
            const before = rel.value;
            rel.value = Math.max(-100, Math.min(100, rel.value + rd.delta));
            // 阶段 3.3：好感越过某条线 → 往待发生事件表里排一段大事件。
            // ⛔ 锁住的边在上面就 continue 了，好感根本不动，自然越不过线 —— 白拿的，别再判一次。
            scheduleThresholdEvents(world, rel, before, rel.value, members, round ?? 0);
            // 重大转折时，角色对这段关系的看法（label）也会变。
            // ⚠️ 改名前必须把旧名字存进 labelHistory —— 早先这里是硬覆盖，
            // 剧情改一次名，原来那个就永久没了，用户想反悔也回不去
            // （交接说明 §6.3：「历史 = 事后后悔药」，没有历史那条设计就是空的）。
            if (rd.newLabel && rd.newLabel !== rel.label) {
                if (rel.label) {
                    (rel.labelHistory ||= []).push({
                        label: rel.label,
                        replacedAt: Date.now(),
                        ...(round !== undefined ? { round } : {}),
                        ...(rd.reason ? { reason: rd.reason } : {}),
                    });
                }
                rel.label = rd.newLabel;
            }
        }
    }
    return hostDeltas;
}

/**
 * 把「对机主」的关系变化落到角色身上，并往聊天里留一条**只给用户看**的提示。
 *
 * 用户 2026-09-11 定的形态：**角色不在台词里演这件事**（那会显得被下了指令），
 * 改动静悄悄发生；但也不能让用户错过，所以在聊天窗口留一道痕
 * —— 且这条痕**不进角色上下文、不进记忆**（`UiNoticeMeta`）。
 */
export async function applyHostBondDeltas(deltas: HostBondDelta[]): Promise<void> {
    for (const d of deltas) {
        try {
            const char = await DB.getCharacter(d.charId);
            if (!char) continue;
            const changed = applyBondChange(char.hostBond, d.newLabel, 'world', d.reason);
            if (!changed) continue;   // 同一句话 → 什么都不做，免得每轮刷提示
            await DB.saveCharacter({ ...char, hostBond: changed.hostBond });
            await DB.saveMessage({
                charId: d.charId, role: 'system', type: 'text',
                content: buildBondChangeNotice(d.charName, changed.to, changed.from),
                metadata: { uiNotice: true, noticeKind: 'bond_changed' },
            } as any);
        } catch (e) {
            console.error('[WorldHome] hostBond 落库失败:', e);
        }
    }
}

/**
 * 把这个小镇里的 char↔char 关系**镜像**一份到各角色的全局 `charBonds`（阶段 2.4）。
 *
 * 为什么要镜像而不是让别处直接读 world：一个角色可能同时在好几个小镇里，
 * 而群聊 / 彼方 / 私聊拿不到「该读哪个 world」这个信息，也不该为了取一条关系
 * 去把所有世界都载进内存。镜像之后，非小镇场景只认角色卡这一处，读起来是 O(1)。
 *
 * ⛔ **只镜像 from=自己 的那一侧** —— 铁律「镇上居民不能开上帝视角」。
 * 世界里 A→B 和 B→A 本来就是两条独立记录，各自镜像进各自的角色卡，谁也看不到对方那条。
 *
 * ⛔ **调用方必须先判 `entersMemory`**：sim（模拟时间）小镇是平行宇宙，
 * 说好了「删掉重开，角色身上干干净净」，一个字都不能往角色卡上写。
 *
 * 幂等：没变的关系不写库（`applyCharBondChange` 返回 null），所以每轮调用不会刷历史。
 */
export async function mirrorWorldBondsToChars(
    world: WorldProfile,
    members: { id: string; name: string }[],
    round?: number,
): Promise<void> {
    const nameOf = (id: string) => members.find(m => m.id === id)?.name;
    // 按「谁的卡」归拢，一个角色只读写一次库
    const byOwner = new Map<string, WorldRelationship[]>();
    for (const rel of world.relationships || []) {
        if (!members.some(m => m.id === rel.fromId) || !members.some(m => m.id === rel.toId)) continue;
        const arr = byOwner.get(rel.fromId) || [];
        arr.push(rel);
        byOwner.set(rel.fromId, arr);
    }
    for (const [ownerId, rels] of byOwner) {
        try {
            const char = await DB.getCharacter(ownerId);
            if (!char) continue;
            let bonds = char.charBonds;
            let dirty = false;
            for (const rel of rels) {
                // 小镇那条边锁着 → 它本来就没变，这里也就没什么可同步的。
                // 全局那条锁着 → applyCharBondChange 自己会拦（返回 null）。
                const changed = applyCharBondChange(
                    bonds,
                    {
                        toId: rel.toId,
                        toName: nameOf(rel.toId),
                        label: rel.label,
                        value: rel.value,
                        fromWorldId: world.id,
                    },
                    'world',
                    undefined,
                    round,
                );
                if (!changed) continue;
                bonds = changed.bonds;
                dirty = true;
            }
            if (dirty) await DB.saveCharacter({ ...char, charBonds: bonds });
        } catch (e) {
            console.error('[WorldHome] charBonds 镜像失败:', e);
        }
    }
}

/**
 * 机械拼接本轮梗概（喂给下一轮所有人，不再额外烧一次 LLM）。
 * ⚠️ 只能用公开信息：shared 行程 + 位置。narrative/mood/secrets 是私人的，
 * 切进 summary 等于把瞒下的事广播给所有人，伏笔就废了。
 */
export function buildSummary(storyTime: string, beats: WorldCharBeat[], npcHooks: string[]): string {
    const parts = beats.map(b => {
        const sharedEvents = (b.timeline || []).filter(tl => tl.shared).map(tl => tl.event);
        return sharedEvents.length > 0
            ? `${b.charName}（${b.location}）：${sharedEvents.join('→')}`
            : `${b.charName} 主要在${b.location}`;
    });
    const hookPart = npcHooks.length > 0 ? ` ／镇上：${npcHooks.join('；')}` : '';
    return `${storyTime}：${parts.join(' ／ ')}${hookPart}`.slice(0, 1200);
}

/** 公开社交媒体：上一轮 + 本轮已演绎角色的动态（公开可见，传给每个角色）。 */
function collectRecentPosts(lastBeats: WorldCharBeat[], beatsSoFar: WorldCharBeat[]): { name: string; post: string }[] {
    const out: { name: string; post: string }[] = [];
    for (const b of [...lastBeats, ...beatsSoFar]) {
        for (const p of b.phone?.posts || []) out.push({ name: b.charName, post: p });
    }
    return out.slice(-10);
}

/** 动态去重用的归一化（去掉空白，避免「同一条只差换行/空格」漏判）。 */
const normalizePost = (s: string): string => s.replace(/\s+/g, '').trim();

/**
 * 把这一拍里和「最近动态」重复的 post 丢掉——模型偶尔会把上一轮的动态原样再发一遍，
 * 落库前先剔除，免得手机动态里同一条文案在不同时间反复刷屏。
 */
export function dropDuplicatePosts(beat: WorldCharBeat, recent: { post: string }[]): void {
    if (!beat.phone?.posts?.length) return;
    const seen = new Set(recent.map(r => normalizePost(r.post)));
    const kept: string[] = [];
    for (const p of beat.phone.posts) {
        const n = normalizePost(p);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        kept.push(p);
    }
    beat.phone = { ...beat.phone, posts: kept };
}

/**
 * 把 beat 里瞒下的事收进伏笔栏（pending）。
 * 显式 secrets 优先；timeline 里 shared=false 但没写进 secrets 的条目自动补一条。
 */
export function collectSeeds(world: WorldProfile, beat: WorldCharBeat, round: number, storyTime: string): void {
    if (!world.seeds) world.seeds = [];
    const texts = new Set<string>();
    for (const s of beat.secrets || []) {
        texts.add(s.text);
        world.seeds.push({
            id: genId('seed'), charId: beat.charId, charName: beat.charName,
            text: s.text, hideFrom: s.hideFrom || [], round, storyTime, status: 'pending',
        });
    }
    for (const tl of beat.timeline || []) {
        if (tl.shared) continue;
        const text = `${tl.time} 在${tl.place}：${tl.event}`;
        // 已被显式 secrets 覆盖（粗匹配事件文本）就不重复
        if ([...texts].some(t => t.includes(tl.event.slice(0, 20)) || tl.event.includes(t.slice(0, 20)))) continue;
        world.seeds.push({
            id: genId('seed'), charId: beat.charId, charName: beat.charName,
            text, hideFrom: [], round, storyTime, status: 'pending',
        });
    }
    // 伏笔栏只留最近 30 条 pending/armed；resolved 留 20 条供回看
    const active = world.seeds.filter(s => s.status !== 'resolved').slice(-30);
    const resolved = world.seeds.filter(s => s.status === 'resolved').slice(-20);
    world.seeds = [...resolved, ...active];
}

/** 按 armed 伏笔为某角色生成"绕不开的事"注入文案。 */
function buildExposures(world: WorldProfile, charId: string, charName: string): string[] {
    const out: string[] = [];
    for (const seed of world.seeds || []) {
        if (seed.status !== 'armed') continue;
        if (seed.charId === charId) {
            out.push(`你之前瞒下的事（${seed.text}）这半天藏不住了——有人察觉了端倪，正面处理它带来的局面。`);
        } else if (seed.hideFrom.length === 0 || seed.hideFrom.includes(charName)) {
            out.push(`你发现/听说了 ${seed.charName} 一直瞒着的事：${seed.text}。这件事此刻摆在你面前，按你的性格去消化或对质。`);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 待发生事件表（阶段 3 底座）—— 节日 / 约定 / 阈值大事件共用
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把这一拍里角色**说定的约定**落进 `world.pendings`（阶段 3.5）。
 *
 * ⛔ **一条约定只落一条记录，两个人共用。** 早期写法是给双方各落一条，
 * 结果 A 爽约时 B 那条还是 scheduled，界面上一条约定裂成两条状态不一样的 ——
 * 所以 `charIds` 是数组，两人同进同出。
 *
 * ⛔ **去重**：A 和 B 都可能在各自那一拍写下同一个约定
 * （「我约了 B 去看展」/「我和 A 约了去看展」）。同一对人 + 同一轮 + 意思相近就只留一条，
 * 否则到点那天提示词里会重复念两遍。
 */
export function collectAppointments(
    world: WorldProfile,
    beat: WorldCharBeat,
    members: { id: string; name: string }[],
    round: number,
): void {
    if (!beat.appointments || beat.appointments.length === 0) return;
    if (!world.pendings) world.pendings = [];
    const idOf = (name: string) => members.find(m => m.name === name)?.id;
    for (const ap of beat.appointments) {
        const otherId = idOf(ap.with);
        if (!otherId || otherId === beat.charId) continue;
        const dueRound = round + Math.max(1, ap.inRounds || 1);
        const pair = [beat.charId, otherId].sort().join('|');
        const gist = ap.what.replace(/\s+/g, '');
        const dup = world.pendings.some(p =>
            p.kind === 'appointment'
            && p.status === 'scheduled'
            && [...p.charIds].sort().join('|') === pair
            && Math.abs(p.dueRound - dueRound) <= 1
            && (p.text.replace(/\s+/g, '').includes(gist) || gist.includes(p.text.replace(/\s+/g, '').slice(0, 10))));
        if (dup) continue;
        const placeId = resolvePlaceId(ap.where, world.places);
        world.pendings.push({
            id: genId('wpd'),
            kind: 'appointment',
            charIds: [beat.charId, otherId],
            text: ap.what,
            ...(ap.where ? { placeName: ap.where } : {}),
            ...(placeId ? { placeId } : {}),
            dueRound,
            // 约定默认提前 1 轮预热：约定与兑现之间那点忐忑正是它比随机相遇好玩的地方
            leadRounds: 1,
            status: 'scheduled',
            createdRound: round,
            source: `${beat.charName} 和 ${ap.with} 约的`,
        });
    }
    // 只留最近 40 条还没过去的 + 30 条已结束的，免得老世界无限膨胀
    const live = world.pendings.filter(p => p.status === 'scheduled').slice(-40);
    const done = world.pendings.filter(p => p.status !== 'scheduled').slice(-30);
    world.pendings = [...done, ...live];
}

/**
 * 把这一拍送出去的礼物投递出去（阶段 3.4）。
 *
 * ⛔ **系统不判档、不加减好感。** 礼物就是一句自由文本，落进收礼方的收件箱，
 * 由**收礼方自己那一轮**对照自己的好恶清单去演（`buildGiftTasteNote` 已经常驻注入）。
 * 既省一次 LLM 调用，又比系统判档更像那个人。
 *
 * 送给**机主**的那份另走一条路：机主的喜好系统不可能知道，
 * 所以落进 `world.giftsForHost` 等机主自己点一个反应，再写回送礼角色的 `giftsToHost`
 * —— 那就是反馈回路（见 `buildGiftHistoryNote`）。
 */
export function collectGifts(
    world: WorldProfile,
    beat: WorldCharBeat,
    members: { id: string; name: string }[],
    round: number,
    hostName?: string,
): void {
    if (!beat.gifts || beat.gifts.length === 0) return;
    const host = (hostName || '').trim();
    for (const g of beat.gifts) {
        const to = (g.to || '').trim();
        if (!to) continue;
        if (host && to === host) {
            (world.giftsForHost ||= []).push({
                id: genId('gfh'),
                fromId: beat.charId,
                fromName: beat.charName,
                what: g.what,
                ...(g.why ? { why: g.why } : {}),
                round,
                at: Date.now(),
            });
            continue;
        }
        const target = members.find(m => m.name === to);
        if (!target || target.id === beat.charId) continue;
        (world.giftInbox ||= []).push({
            toId: target.id,
            fromId: beat.charId,
            fromName: beat.charName,
            what: g.what,
            ...(g.why ? { why: g.why } : {}),
            round,
        });
    }
    // 收件箱只留最近 20 条：没人来取的（比如那个角色退镇了）不该无限堆
    if (world.giftInbox && world.giftInbox.length > 20) world.giftInbox = world.giftInbox.slice(-20);
    if (world.giftsForHost && world.giftsForHost.length > 30) world.giftsForHost = world.giftsForHost.slice(-30);
}

/**
 * 取走某个角色收件箱里的礼物，转成注入文案（阶段 3.4）。
 *
 * **取走即清除**：礼物只该被收到一次，留着会每轮重复念。
 * 同一轮里还没演的人当场就能收到（同 `threads` 的即时传递）。
 */
export function takeGifts(world: WorldProfile, charId: string): string[] {
    const inbox = world.giftInbox || [];
    if (inbox.length === 0) return [];
    const mine = inbox.filter(g => g.toId === charId);
    if (mine.length === 0) return [];
    world.giftInbox = inbox.filter(g => g.toId !== charId);
    return mine.map(g => `${g.fromName} 送了你：${g.what}${g.why ? `（${g.fromName}说：${g.why}）` : ''}`);
}

/**
 * 为某个角色生成这一轮的待发生事件注入文案（阶段 3 底座）。
 *
 * `due`（今天到点）和 `preheat`（快到了）分开返回，提示词里也是两段 ——
 * 预热要是写成「必须处理」，角色会在预热轮就把事办了，**期待感当场归零**，
 * 而期待感正是节日/约定好玩的地方（交接说明 §3.2 补充①）。
 */
export function buildPendingNotes(
    world: WorldProfile,
    charId: string,
    round: number,
    members: { id: string; name: string }[],
): { due: string[]; preheat: string[] } {
    const due: string[] = [];
    const preheat: string[] = [];
    const nameOf = (id: string) => members.find(m => m.id === id)?.name;
    for (const p of world.pendings || []) {
        if (p.status !== 'scheduled') continue;
        // charIds 空 = 全镇的事（节日），谁都收得到
        if (p.charIds.length > 0 && !p.charIds.includes(charId)) continue;
        const others = p.charIds.filter(id => id !== charId).map(nameOf).filter(Boolean) as string[];
        const withWho = others.length > 0 ? `和${others.join('、')}` : '';
        const where = p.placeName ? `在${p.placeName}` : '';
        const lastRound = p.dueUntilRound ?? p.dueRound;
        if (round >= p.dueRound && round <= lastRound) {
            if (p.kind === 'festival') {
                due.push(`今天是镇上的「${p.text}」。这一天大家都在过节，你也在这个节日里过这半天。`);
            } else if (p.kind === 'threshold') {
                // ⛔ 只把事摆到桌上，不规定结果。写成「今天必须告白」会把角色演崩 ——
                // 该不该说、说不说得出口、说了之后怎样，全是角色自己的事。
                due.push(`${p.text}——这半天，这件事到了不得不面对的时候。`
                    + `怎么面对、面不面对得了，完全按你这个人的性格来：可以说出口，也可以又一次没说出口，`
                    + `也可以用一件别的事把它岔开。**别为了推进剧情而勉强自己**。`);
            } else {
                due.push(`今天你${withWho}${where}说好了：${p.text}。`);
            }
        } else if (p.leadRounds && round >= p.dueRound - p.leadRounds) {
            const left = p.dueRound - round;
            // 说「还有几天」比「还有几个半天」自然得多；不足一天就说「就这两天」
            const when = left >= SEGMENTS_PER_DAY ? `还有 ${Math.floor(left / SEGMENTS_PER_DAY)} 天` : '就这两天';
            if (p.kind === 'festival') {
                preheat.push(`${when}就是「${p.text}」。镇上已经有动静了，你也开始有点感觉——想做点什么、想约谁、或者不想过。`);
            } else if (p.kind === 'threshold') {
                preheat.push(`${p.text}——这件事最近一直压在你心里，还没到摊开的时候，但你知道它快了。`);
            } else {
                preheat.push(`${when}，你${withWho}${where}约好了：${p.text}。`);
            }
        }
    }
    return { due, preheat };
}

/**
 * 按节日律法往待发生事件表里排期（阶段 3.2）。
 *
 * 每轮开演前跑一次，只往前看 `leadRounds + 一天` 那么远：
 * real 模式下「第 N 轮是哪天」是按轮差折算的，看太远会越算越偏
 * （用户可能几天不观测，现实日期跑到前头去）。看得近就不会积误差。
 *
 * ⛔ **节日占满那一整天**（`dueRound` ~ `dueUntilRound`），不是挂在某一段上 ——
 * 一天有 4 段，只挂一段的话同一个灯会早上有、晚上没有，很怪。
 *
 * 幂等：同一个节日同一天只排一次（按 `source` 去重），所以每轮调用都安全。
 */
export function scheduleFestivals(world: WorldProfile, round: number): void {
    const festivals = (world.festivals || []).filter(f => f.enabled !== false);
    if (festivals.length === 0) return;
    if (!world.pendings) world.pendings = [];
    for (const f of festivals) {
        const lead = f.leadRounds ?? 6;
        // 往前看到「预热期开始那天再往后一天」，足够把这个节日排进来
        for (let r = round; r <= round + lead + SEGMENTS_PER_DAY; r++) {
            const date = worldDateOfRound(world, r);
            if (!date) return;            // 这个世界还没有日历 —— 整个排期都做不了
            if (date.month !== f.month || date.day !== f.day) continue;
            // 找到节日那天了。往回退到那天的第一段，再占满 4 段。
            const firstOfDay = r - (r % SEGMENTS_PER_DAY);
            const dueRound = Math.max(round, firstOfDay);
            const source = `${f.id}@${date.year}-${date.month}-${date.day}`;
            if (world.pendings.some(p => p.source === source)) break;   // 已经排过
            world.pendings.push({
                id: genId('wpd'),
                kind: 'festival',
                charIds: [],              // 空 = 全镇的事
                text: f.blurb ? `${f.name}——${f.blurb}` : f.name,
                dueRound,
                dueUntilRound: firstOfDay + SEGMENTS_PER_DAY - 1,
                ...(lead > 0 ? { leadRounds: lead } : {}),
                status: 'scheduled',
                createdRound: round,
                source,
            });
            break;
        }
    }
}

/**
 * 好感越线 → 排一段大事件（阶段 3.3）。
 *
 * 判据是**越过**而不是「达到」：`before` 在线的这边、`after` 在线的那边才算。
 * 否则好感在 60 上下反复抖一抖，同一条线会被反复触发。
 *
 * ⛔ **同一对人 + 同一条线只触发一次**（按 `source` 去重，且连已经 fired 的也算）。
 * 恋爱线不该每次越线都重演一遍。想再来一次，用户删掉那条 pending 即可。
 *
 * ⛔ **锁住的关系不会走到这里** —— `applyRelationshipDeltas` 在更上游就跳过了锁住的边。
 */
export function scheduleThresholdEvents(
    world: WorldProfile,
    rel: WorldRelationship,
    before: number,
    after: number,
    members: { id: string; name: string }[],
    round: number,
): void {
    const thresholds = (world.thresholds || []).filter(t => t.enabled !== false);
    if (thresholds.length === 0 || before === after) return;
    const nameOf = (id: string) => members.find(m => m.id === id)?.name || '';
    for (const t of thresholds) {
        const crossed = t.direction === 'up'
            ? (before < t.value && after >= t.value)
            : (before > t.value && after <= t.value);
        if (!crossed) continue;
        const source = `th:${t.id}:${rel.fromId}->${rel.toId}`;
        // 连 fired/cancelled 的也查：一段恋爱线不该每次越线都重演
        if ((world.pendings || []).some(p => p.source === source)) continue;
        const lead = t.leadRounds ?? 2;
        if (!world.pendings) world.pendings = [];
        world.pendings.push({
            id: genId('wpd'),
            kind: 'threshold',
            // ⚠️ 只给**产生这个变化的那一方**。关系是有向的：A 对 B 的好感越了线，
            // 不代表 B 对 A 也到了那一步 —— 两边都塞会凭空造出一段双向的默契。
            charIds: [rel.fromId],
            text: t.text,
            dueRound: round + lead,
            ...(lead > 0 ? { leadRounds: lead } : {}),
            status: 'scheduled',
            createdRound: round,
            source,
        });
        // 顺手把对方的名字塞进文案里 —— 光说「有件事该说清楚了」角色不知道跟谁
        const last = world.pendings[world.pendings.length - 1];
        const other = nameOf(rel.toId);
        if (other) last.text = `${last.text}（对方是${other}）`;
    }
}

/**
 * 这一段镇上正在过 / 快到的节日，喂给**世界引擎**（阶段 3.2 补充②）。
 *
 * ⭐ 必须先让世界引擎生成**公共场景**，再让各角色在其中演自己那份 ——
 * 否则十个角色会各写各的灯会（谁挂的灯、在哪条街、什么时辰全对不上）。
 * `npcScene` / `npcHooks` 本来就是喂给所有角色的「镇上动静」，节日走同一条路，零新机制。
 */
export function buildFestivalNote(world: WorldProfile, round: number): string {
    const lines: string[] = [];
    for (const p of world.pendings || []) {
        if (p.kind !== 'festival' || p.status !== 'scheduled') continue;
        const lastRound = p.dueUntilRound ?? p.dueRound;
        if (round >= p.dueRound && round <= lastRound) {
            lines.push(`【今天就是正日子】${p.text}`);
        } else if (p.leadRounds && round >= p.dueRound - p.leadRounds) {
            const left = p.dueRound - round;
            const when = left >= SEGMENTS_PER_DAY ? `还有 ${Math.floor(left / SEGMENTS_PER_DAY)} 天` : '就这两天';
            lines.push(`【${when}】${p.text}——镇上开始有准备的动静了（还没到正日子，别提前把节过了）`);
        }
    }
    return lines.join(String.fromCharCode(10));
}

/**
 * 一轮演完之后结算待发生事件（阶段 3 底座）。
 *
 * 到点的那一轮注入过了就记 `fired` —— **不判断角色到底有没有真去**。
 * 爽约本身就是戏（交接说明 §3.5），系统不该替用户裁定「这算不算失约」；
 * 已经过了点还躺着 `scheduled` 的记 `missed`，让它从提示词里退场，不再每轮重复念。
 */
export function settlePendings(world: WorldProfile, round: number): void {
    for (const p of world.pendings || []) {
        if (p.status !== 'scheduled') continue;
        // 跨多段的事（节日占满一整天）要等最后一段过完才收 —— 否则灯会只在早上有
        if (round >= (p.dueUntilRound ?? p.dueRound)) p.status = 'fired';
    }
}

/** 单个角色的 world_card 文本（注入本人的 1v1 聊天与记忆——本人的视角，含自己瞒的事）。 */
function buildCardContent(world: WorldProfile, storyTime: string, beat: WorldCharBeat): string {
    const lines = [
        `「家园 · ${world.name}」${storyTime}`,
        `${beat.charName} 在${beat.location}（${beat.mood}）`,
    ];
    if (beat.timeline?.length) {
        lines.push('这半天的行程：');
        for (const tl of beat.timeline) lines.push(`· ${tl.time} ${tl.place}：${tl.event}${tl.shared ? '' : '（没声张）'}`);
    }
    lines.push(beat.narrative);
    if (beat.memo?.length) {
        for (const m of beat.memo) lines.push(`备忘录：${m}`);
    }
    if (beat.impulse) lines.push(`心里的冲动：${beat.impulse.text}`);
    if (beat.dialogues?.length) {
        for (const d of beat.dialogues) lines.push(`当面对 ${d.with} 说：${d.lines.join(' / ')}`);
    }
    if (beat.phone?.posts?.length) {
        for (const p of beat.phone.posts) lines.push(`发了动态：${p}`);
    }
    if (beat.phone?.dms?.length) {
        for (const d of beat.phone.dms) lines.push(`给 ${d.to} 发消息：${d.lines.join(' / ')}`);
    }
    if (beat.phone?.group?.length) {
        lines.push(`在世界群聊里说：${beat.phone.group.join(' / ')}`);
    }
    return lines.join('\n');
}

/**
 * 阶段 2.6：分享给**镇外角色**看的版本 —— 比当事人那版还多，因为 ta 是**读者**。
 *
 * ⚠️ 别把这个版本发给镇上的居民。引擎铁律是「每个角色只看得到自己那份，伏笔才成立」；
 * 而镇外的角色不是居民，ta 是在读机主写的故事 —— **读者本来就该比角色知道得多**。
 * 「你看 aa 和 bb 今天吵架了」——ta 知道 bb 为什么生气，而 aa 不知道，这正是要的效果。
 */
function buildSharedCardContent(world: WorldProfile, storyTime: string, beat: WorldCharBeat): string {
    const lines = [buildCardContent(world, storyTime, beat)];
    if (beat.secrets?.length) {
        lines.push('');
        lines.push('（只有你这个"读者"知道的部分——镇上没人知道）：');
        for (const s of beat.secrets) lines.push(`· ${s.text}`);
    }
    return lines.join('\n');
}

/** 组装某一拍的 world_card metadata（与彼方 vr_card 同构，注入聊天 / 进记忆用）。 */
export function buildWorldCardMeta(world: WorldProfile, beat: WorldCharBeat, round: number, storyTime: string): WorldCardMeta {
    return {
        worldCard: true,
        worldId: world.id,
        worldName: world.name,
        mode: world.mode,
        round,
        storyTime,
        location: beat.location,
        mood: beat.mood,
        narrative: beat.narrative,
        statusPanel: beat.statusPanel,
        timeline: beat.timeline,
        memo: beat.memo,
        impulse: beat.impulse,
        phonePosts: beat.phone?.posts,
        phoneGroup: beat.phone?.group,
    };
}

/**
 * 演绎某角色时补注 ta 今天的**全天**日程（防行为冲突）。
 * 聊天主链路（buildChatRequestPayload）注入的日程只有「当前时段 + 下一个」，
 * 家园一拍演的是半天，只看当前时段不够——这里把整天蓝图给足。
 * 软参考：世界里的突发事件可以合理打断日程，但不许"没看见"就硬撞。
 * sim（虚拟时间）番外与真实日程无关，跳过。
 */
async function buildFullDayScheduleBlock(world: WorldProfile, char: CharacterProfile): Promise<string> {
    if ((world.timeMode ?? 'real') === 'sim') return '';
    try {
        const s = await getDailyScheduleForChar(char);
        if (!s?.slots?.length) return '';
        const lines = s.slots
            .map(x => `- ${x.startTime} ${x.activity}${x.location ? `（${x.location}）` : ''}`)
            .join('\n');
        return `\n\n## 你今天的日程表（既定安排）\n${lines}\n（演绎这半天时以此为参照，行为别和既定安排无故冲突；世界里的事件可以合理打断日程，但要有交代。）`;
    } catch {
        return '';
    }
}

/**
 * 把某一拍作为 world_card 注入这名角色的 1v1 聊天（进上下文与记忆）。
 * 自动演绎、单拍补发都走这里——保证格式一致，也方便 UI 做「手动发送保底」。
 */
export async function injectWorldCard(world: WorldProfile, beat: WorldCharBeat, round: number, storyTime: string): Promise<void> {
    await DB.saveMessage({
        charId: beat.charId, role: 'assistant', type: 'world_card',
        content: buildCardContent(world, storyTime, beat),
        metadata: buildWorldCardMeta(world, beat, round, storyTime),
    });
}

/**
 * 阶段 2.6「一起追连载」：把某个镇民这一拍**分享给镇外的另一个角色**。
 *
 * 用户 A 明确提出的玩法：
 * 「我其实挺想和角色讨论我创作的角色的，比如和他说『你看 aa 和 bb 今天吵架了』
 *  『cc 和 dd 怎么在一起了！』」
 *
 * 此前做不到：`injectWorldCard` 写死落到 `beat.charId`，
 * Sully 萧逸不是那个镇的成员，他不知道 aa/bb 发生了什么，你说了他接不上话。
 *
 * **⛔ 收件人必须是镇外的角色。** 发给镇上的居民会破坏伏笔系统
 * （居民只该看得到自己那份）。调用方负责过滤，这里再兜一道。
 */
export async function shareWorldCardTo(
    world: WorldProfile,
    beat: WorldCharBeat,
    round: number,
    storyTime: string,
    toCharId: string,
): Promise<{ ok: boolean; reason?: string }> {
    if (toCharId === beat.charId) return { ok: false, reason: '这就是 ta 自己的事' };
    if ((world.memberIds || []).includes(toCharId)) {
        // 兜底：镇民开上帝视角会毁掉伏笔
        return { ok: false, reason: '这个角色就住在镇上，不能让 ta 看别人的内心戏' };
    }
    const share: WorldCardShareMeta = { sharedFrom: beat.charName, asReader: true };
    await DB.saveMessage({
        charId: toCharId, role: 'assistant', type: 'world_card',
        content: buildSharedCardContent(world, storyTime, beat),
        metadata: { ...buildWorldCardMeta(world, beat, round, storyTime), ...share },
    });
    return { ok: true };
}

/**
 * 阶段 2.5：把**已经注入过**的那张 world_card 就地改成新内容。
 *
 * 修的漏点：重演（`rerollWorldCharBeat`）只在「之前缺这拍」时才注入卡片，
 * 于是**重演一拍已有的演绎时，小镇里换成了新版本，而角色聊天与记忆里留着旧版本**——
 * 两边就此永久分叉。而 `real` 模式下 world_card 是要进记忆的，
 * 也就是说角色会**一直记着一段你已经改掉的经历**。
 *
 * 用 `worldId + round` 定位该角色那张卡（一个世界一轮只会有一张）。
 * 找不到就当没注入过，交由调用方决定要不要新建——**绝不在这里补插**，
 * 否则重演几次就攒出几张同一轮的卡。
 *
 * @returns 是否真的改到了一张卡
 */
export async function updateInjectedWorldCard(
    world: WorldProfile,
    beat: WorldCharBeat,
    round: number,
    storyTime: string,
): Promise<boolean> {
    const msgs = await DB.getMessagesByCharId(beat.charId, true);
    const target = [...msgs].reverse().find(m => {
        if ((m.type as string) !== 'world_card') return false;
        const meta = m.metadata as any;
        return meta?.worldId === world.id && meta?.round === round;
    });
    if (!target || typeof target.id !== 'number') return false;
    await DB.updateMessage(target.id, buildCardContent(world, storyTime, beat));
    await DB.updateMessageMetadata(target.id, () => buildWorldCardMeta(world, beat, round, storyTime));
    return true;
}

export async function runWorldEpisode(deps: WorldEpisodeDeps): Promise<WorldEpisodeResult> {
    const { world, characters, apiConfig, userProfile, groups, realtimeConfig, memoryPalaceConfig, trigger } = deps;

    if (running.has(world.id)) return { ok: false, reason: 'busy' };

    // 旧存档（一天三段制）防御性迁移到四段制（含凌晨）：启动 sweep 可能还没跑完就被 tick 抢跑，
    // 这里原地换算，storyClock/clockSegs 随本轮结束的 saveWorld 一并持久化。
    migrateWorldDaySegs(world);

    const members = world.memberIds
        .map(id => characters.find(c => c.id === id))
        .filter(Boolean) as CharacterProfile[];
    if (members.length === 0) return { ok: false, reason: 'no-members' };

    // API 优先级：世界私有覆盖（旧数据）> 家园全局设置（localStorage）> 全局聊天默认
    const worldHomeApi = readWorldHomeApiOverride();
    const api = world.api?.baseUrl ? world.api : (worldHomeApi || apiConfig);
    if (!api.baseUrl) return { ok: false, reason: 'no-api' };
    const baseUrl = api.baseUrl.replace(/\/+$/, '');

    // real 模式：演的那一段跟着真实时钟走，且只能补当天错过的段；已追上现实就没东西可演
    const realTarget = world.timeMode !== 'sim' ? realObserveTarget(world) : null;
    if (world.timeMode !== 'sim' && !realTarget) return { ok: false, reason: 'caught-up' };

    running.add(world.id);
    const storyTime = realTarget ? formatRealClock(realTarget) : worldTimeLabel(world);
    const round = world.storyClock + 1;
    // sim 模式不进记忆/聊天——演绎攒在家园里，靠每 20 天的结卷总结沉淀
    const entersMemory = world.timeMode !== 'sim' && world.injectToChat !== false;
    // sim 模式：已结卷归档的原文不再喂；最新一卷的单视角总结 + 氛围作为上文
    const latestChapter = (world.chapters || [])[(world.chapters?.length || 0) - 1];
    // 线程容器就位：本轮所有消息（NPC 群聊冒泡 / 角色私聊与群聊）都即时落在 world.threads 上，
    // 链式后续角色构建上下文时直接读到——消息在同一轮内就完成传递。
    ensureThreads(world);
    // 节日排期：本轮开演前先把「快到的节日」排进待发生事件表（阶段 3.2）。
    // 放在这里而不是结算时，是因为**预热要在本轮就生效** —— 排完这一轮就能注入。
    scheduleFestivals(world, round);
    dispatch('world-episode-start', { worldId: world.id, worldName: world.name, storyTime, total: members.length });

    try {
        const lastEpisodes = await DB.getWorldEpisodes(world.id, 2);
        // 给一点纵深：最近两轮的梗概都喂进去，世界才有"昨天"的概念。
        // sim 模式下，已归档（round ≤ simSummarizedClock）的原文不再喂——交给章节总结。
        const sinceClock = world.simSummarizedClock || 0;
        const summarySource = world.timeMode === 'sim'
            ? lastEpisodes.filter(e => e.round > sinceClock)
            : lastEpisodes;
        const lastSummary = summarySource.length > 0
            ? summarySource.slice().reverse().map(e => e.summary).join('\n')
            : undefined;

        // ── 阶段 4.1：机主住进小镇 ────────────────────────────────────
        // 「代笔」档：这一轮还没有大纲的话，先烧一次小调用替机主写这半天。
        // ⛔ 失败不拖垮整轮 —— 退回「在场但没动作」的口径（buildHostPresenceSection 自己兜底），
        //    绝不能让角色自己脑补机主做了什么。
        if (world.hostPresence === 'ghostwrite' && world.hostOutline?.round !== round) {
            try {
                const ghost = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: api.model,
                        messages: [{ role: 'user', content: buildGhostwritePrompt({
                            world,
                            userName: userProfile?.name || '用户',
                            userPersona: (userProfile?.bio || '').replace(/\s+/g, ' ').trim().slice(0, 400),
                            storyTime,
                            lastSummary,
                            memberNames: members.map(m => m.name),
                        }) }],
                        temperature: 0.95, stream: false,
                    }),
                }, 2, 0, { appName: '家园', purpose: `代笔 · ${world.name}` });
                const text = (ghost.choices?.[0]?.message?.content || '')
                    .replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 600);
                if (text) world.hostOutline = { round, text, byAi: true };
            } catch (e) {
                console.error('[WorldHome] 代笔失败，这半天按「在场但没动作」处理:', e);
            }
        }

        // NPC 引擎改到角色之后跑（见 ── 2.5 ──）：这样 NPC 能看到角色这一轮刚发的私聊/动态/
        // 群聊，当轮就回应。角色这一轮看到的「镇上动静」用上一轮 NPC 的产出——和角色彼此错一
        // 轮接话是一致的模型。本轮 NPC 的产出存进 episode、并在下一轮被角色接住。
        const lastNpcScene = lastEpisodes[0]?.npcScene;
        const lastNpcHooks = lastEpisodes[0]?.npcHooks || [];
        let npcScene: string | undefined;
        let npcHooks: string[] = [];

        // ── 1. 链式角色演绎（每角色一次独立调用，后者能"看到"前者的公开行为） ──
        const memberNames = members.map(m => m.name);
        const lastBeats = lastEpisodes[0]?.beats || [];
        const beats: WorldCharBeat[] = [];
        const consumedDirectiveIds: string[] = [];
        let anyCharOk = false;
        for (let i = 0; i < members.length; i++) {
            const char = members[i];
            try {
                const others = memberNames.filter(n => n !== char.name);
                // 与彼方同款的名字加权召回：让向量记忆召回"我和这些人的关系"，
                // 而不是被世界观情景词淹没。query = 当前世界的其他角色。
                const recallQueryHint = others.length > 0
                    ? [
                        `此刻在「${world.name}」共同生活的人：${others.join('、')}。`,
                        `${others.join(' ')} ${others.join(' ')}`,
                        `我对${others.join('、')}的印象、我和${others.join('、')}之间的关系与过往。`,
                    ].join('\n')
                    : undefined;

                const historyMsgs = await loadCharacterContextMessages(char);
                const contextLimit = Math.max(1, historyMsgs.length);
                // 家园内角色的当前时间与日程日期都必须对齐同一把世界钟。
                const worldChar = alignCharToWorldClock(world, char);
                const payload = await buildChatRequestPayload({
                    char: worldChar, userProfile, groups, emojis: [], categories: [],
                    historyMsgs, contextLimit, realtimeConfig, recallQueryHint,
                    recallEntryPoint: 'world_home',
                    // 家园可配独立 API（可能不支持视觉，image_url 会 400）→ 历史图片压平成文本占位
                    stripImages: true,
                });
                const systemPrompt = payload.systemPrompt
                    // lastEpisodes 是本轮开演前取的，[0] 即真正的上一集 → 「好久不见」的时间基准
                    + buildWorldSystemAddendum(world, char, userProfile?.name || '', lastEpisodes[0]?.createdAt)
                    + await buildFullDayScheduleBlock(world, worldChar);
                const directive = (world.directives || []).find(d => d.charId === char.id);
                // sim 模式：喂回这名角色自己的单视角总结 + 本卷氛围（绝不喂全知 synopsis）
                const priorChapter = (world.timeMode === 'sim' && latestChapter)
                    ? {
                        atmosphere: latestChapter.atmosphere,
                        charPerspective: latestChapter.perspectives.find(p => p.charId === char.id)?.text,
                    }
                    : undefined;
                const turn = buildWorldCharTurn({
                    world, char, members, storyTime, round, lastSummary,
                    npcScene: lastNpcScene, npcHooks: lastNpcHooks, beatsSoFar: beats,
                    recentPosts: collectRecentPosts(lastBeats, beats),
                    exposures: buildExposures(world, char.id, char.name),
                    // 阶段 3 底座：今天到点的事 + 快到了的事（两段分开注入，见 buildPendingNotes）
                    pendings: buildPendingNotes(world, char.id, round, members),
                    // 阶段 3.4：取走收件箱里别人送 ta 的东西（取走即清除，不会重复念）
                    giftsReceived: takeGifts(world, char.id),
                    directive: directive ? { impulseText: directive.impulseText, text: directive.text } : undefined,
                    priorChapter,
                    userName: userProfile?.name || '',
                });
                if (directive) consumedDirectiveIds.push(directive.id);

                const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: api.model,
                        messages: [{ role: 'system', content: systemPrompt }, ...payload.cleanedApiMessages, { role: 'user', content: turn }],
                        temperature: 0.9, stream: false,
                    }),
                }, 2, 0, { appName: '家园', charId: char.id, charName: char.name, purpose: `演绎 · ${world.name}` });
                const beat = parseCharBeat(data.choices?.[0]?.message?.content || '', char, memberNames, world.npcs.map(n => n.name), world.places, userProfile?.name);
                // 落库前剔除和最近动态重复的 post（上一轮 + 本轮已演绎角色）
                dropDuplicatePosts(beat, collectRecentPosts(lastBeats, beats));
                beats.push(beat);
                // 该角色发出的私聊/群聊立刻落线程——后面还没演绎的角色这一轮就能收到并回应
                applyBeatToThreads(world, beat, members, round, storyTime);
                // 瞒下的事落进伏笔栏（pending，等用户点击引爆）
                collectSeeds(world, beat, round, storyTime);
                // 这半天说定的约定落进待发生事件表（阶段 3 底座）
                collectAppointments(world, beat, members, round);
                // 送出去的礼物投递给收礼方（送给机主的另走一条路，等机主自己点反应）
                collectGifts(world, beat, members, round, userProfile?.name);
                anyCharOk = true;
            } catch (e) {
                // 单个角色失败不拖垮整轮——这半天 ta 只是没什么动静
                console.error(`[WorldHome] beat failed for ${char.name}:`, e);
            }
            dispatch('world-beat-done', { worldId: world.id, stage: 'char', charId: char.id, charName: char.name, done: i + 1, total: members.length });
        }

        if (!anyCharOk) return { ok: false, reason: 'all-beats-failed' };

        // ── 2.5 NPC 世界引擎（角色之后跑）：回应本轮角色发来的私聊、给本轮动态点赞/评论、群里冒泡 ──
        if (world.npcs.length > 0) {
            try {
                // 喂这一轮角色刚发的动态，让 NPC + 路人当轮就点赞评论
                const recentPostsForNpc = beats.flatMap(b =>
                    (b.phone?.posts || []).map((post, idx) => ({ ref: `${round}_${b.charId}_${idx}`, name: b.charName, post }))
                ).slice(0, 12);
                const npcData = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: api.model,
                        messages: [{ role: 'user', content: buildNpcTurn({ world, members, storyTime, lastSummary, chapterAtmosphere: latestChapter?.atmosphere, inboxes: npcInboxes(world), recentPosts: recentPostsForNpc, festivalNote: buildFestivalNote(world, round) }) }],
                        temperature: 0.9, stream: false,
                    }),
                }, 2, 0, { appName: '家园', purpose: `NPC世界引擎 · ${world.name}` });
                const parsed = parseNpcScene(npcData.choices?.[0]?.message?.content || '');
                npcScene = parsed.scene || undefined;
                npcHooks = parsed.hooks;
                // 群聊冒泡 + 回复成员私信（落线程，角色下一轮接住）
                applyNpcGroupLines(world, parsed.groupLines, round, storyTime);
                applyNpcDms(world, parsed.dms, members, round, storyTime);
                // 动态的点赞/评论（NPC + 路人）回填
                if (parsed.feedReactions.length > 0) {
                    world.feedReactions = { ...(world.feedReactions || {}) };
                    for (const r of parsed.feedReactions) world.feedReactions[r.ref] = { likes: r.likes, comments: r.comments };
                }
            } catch (e) {
                console.warn('[WorldHome] NPC engine failed:', e);
            }
            dispatch('world-beat-done', { worldId: world.id, stage: 'npc', done: members.length, total: members.length });
        }

        // ── 3. 落库：episode + 关系回填 + 剧情时钟推进 ──
        // 成功的角色照常保留；没演出来的记下 charId，UI 提示用户可单独重 roll
        const okIds = new Set(beats.map(b => b.charId));
        const failedCharIds = members.filter(m => !okIds.has(m.id)).map(m => m.id);
        const episode: WorldEpisode = {
            id: genId('we'),
            worldId: world.id,
            round,
            storyTime,
            trigger,
            npcScene,
            npcHooks: npcHooks.length > 0 ? npcHooks : undefined,
            beats,
            failedCharIds: failedCharIds.length > 0 ? failedCharIds : undefined,
            summary: buildSummary(storyTime, beats, npcHooks),
            createdAt: Date.now(),
        };
        await DB.saveWorldEpisode(episode);

        const hostBondDeltas = applyRelationshipDeltas(world, beats, members, episode.round, userProfile?.name);
        // ⛔ 只有「算数的」世界才能往角色卡上写。sim 是平行宇宙，说好了删掉重开
        // 角色身上干干净净——之前 hostBond 这条漏判了，sim 镇也在偷偷改「ta 怎么看你」。
        if (entersMemory) {
            await applyHostBondDeltas(hostBondDeltas);
            // 阶段 2.4：镇上处出来的 char↔char 关系镜像进各自角色卡，出了小镇也认
            await mirrorWorldBondsToChars(world, members, episode.round);
        }
        // armed 伏笔本轮已爆发 → resolved；本轮注入过的用户决策消费掉
        for (const seed of world.seeds || []) {
            if (seed.status === 'armed') seed.status = 'resolved';
        }
        // 到点的待发生事件本轮已注入过 → fired，别下一轮再念一遍（阶段 3 底座）
        settlePendings(world, round);
        // ⛔ 阶段 4.1：机主这半天的输入**用过即弃**。这就是「一次性输入、不许来回」
        //    那条边界的实现方式 —— 清掉之后界面上也就没有「回复」可点了。别改成累积。
        if (world.hostOutline?.round === round) world.hostOutline = undefined;
        const remainingDirectives = (world.directives || []).filter(d => !consumedDirectiveIds.includes(d.id));
        const updatedWorld: WorldProfile = {
            ...world,
            relationships: world.relationships,
            threads: world.threads, // 本轮累积的私聊/群聊消息一并持久化
            seeds: world.seeds,
            pendings: world.pendings,
            giftInbox: world.giftInbox,
            giftsForHost: world.giftsForHost,
            hostOutline: world.hostOutline,
            directives: remainingDirectives,
            storyClock: world.storyClock + 1,
            // real 模式：把世界的「现实段」推进到这次演的那一段
            realClock: realTarget || world.realClock,
            updatedAt: Date.now(),
        };
        await DB.saveWorld(updatedWorld);

        // ── 3.5 sim 模式：攒满 20 天结一卷（小说体总结 + 各角色单视角，归档原文） ──
        const newClock = updatedWorld.storyClock;
        if (shouldCloseChapter(updatedWorld, newClock)) {
            try {
                const fromClock = newClock - SIM_CHAPTER_CLOCKS;
                const index = newClock / SIM_CHAPTER_CLOCKS;
                // 拉取本卷窗口内的原文（round 落在 (fromClock, newClock]）
                const windowEpisodes = (await DB.getWorldEpisodes(world.id, SIM_CHAPTER_CLOCKS + 2))
                    .filter(e => e.round > fromClock && e.round <= newClock);
                dispatch('world-chapter-start', { worldId: world.id, index });
                const chapter = await summarizeChapter({
                    world: updatedWorld, members, episodes: windowEpisodes, api: { baseUrl, apiKey: api.apiKey || '', model: api.model },
                    fromClock, toClock: newClock,
                    fromLabel: worldTimeLabel(updatedWorld, fromClock),
                    toLabel: worldTimeLabel(updatedWorld, Math.max(fromClock, newClock - 1)),
                    index, prevSynopsis: latestChapter?.synopsis,
                });
                if (chapter) {
                    updatedWorld.chapters = [...(updatedWorld.chapters || []), chapter];
                    updatedWorld.simSummarizedClock = newClock;
                    // 归档后清空手机里属于这 20 天的私聊/群聊 + 动态互动（已卷进编年史）
                    if (updatedWorld.threads) {
                        updatedWorld.threads = updatedWorld.threads.map(t => ({ ...t, messages: t.messages.filter(m => m.round > newClock) }));
                    }
                    if (updatedWorld.feedReactions) {
                        updatedWorld.feedReactions = Object.fromEntries(
                            Object.entries(updatedWorld.feedReactions).filter(([k]) => (parseInt(k.split('_')[0], 10) || 0) > newClock)
                        );
                    }
                    updatedWorld.updatedAt = Date.now();
                    await DB.saveWorld(updatedWorld);
                    dispatch('world-chapter-done', { worldId: world.id, index, chapterId: chapter.id });
                }
            } catch (e) {
                console.warn('[WorldHome] close-chapter failed:', e);
            }
        }

        // ── 4. world_card 注入各成员 1v1 聊天（与彼方 vr_card 同构；sim 模式不进记忆，跳过） ──
        if (entersMemory) {
            for (const beat of beats) {
                try {
                    await injectWorldCard(world, beat, episode.round, storyTime);
                } catch (e) {
                    console.error(`[WorldHome] card inject failed for ${beat.charName}:`, e);
                }
            }

            // 记忆管线（fire-and-forget，逐角色）
            try {
                const mpEmb = memoryPalaceConfig?.embedding;
                const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
                const mpLLM = (mpLLMConfigured?.baseUrl) ? mpLLMConfigured : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
                if (mpEmb?.baseUrl && mpEmb?.apiKey && mpLLM.baseUrl) {
                    for (const beat of beats) {
                        const char = members.find(m => m.id === beat.charId);
                        if (!char?.memoryPalaceEnabled) continue;
                        const recentMsgs = await DB.getRecentMessagesByCharId(char.id, 50);
                        void processNewMessagesWithAutoArchive(recentMsgs, char.id, char.name, mpEmb as any, mpLLM as any, userProfile?.name || '', false).catch(() => {});
                    }
                }
            } catch { /* 记忆失败不影响主流程 */ }
        }

        dispatch('world-episode-done', { worldId: world.id, episodeId: episode.id, storyTime, round: episode.round });
        return { ok: true, episode };
    } catch (err) {
        console.error('[WorldHome] episode error:', err);
        return { ok: false, reason: 'error' };
    } finally {
        running.delete(world.id);
        dispatch('world-episode-end', { worldId: world.id });
    }
}

/**
 * 单个角色重 roll：只重演某一轮里某个角色这一拍（用于本轮该角色生成失败、或用户想换个写法）。
 * - direction：用户给的「大致重写方向」，没有就完全重写。
 * - 之前是「失败缺这拍」→ 补上后照常落线程/伏笔/关系，真实模式补一张 world_card；
 *   之前已有这拍（用户想换写法）→ 只替换这拍内容，不重复落副作用（避免重复加好感/重复消息）。
 */
export async function rerollWorldCharBeat(
    deps: WorldEpisodeDeps & { episodeId: string; charId: string; direction?: string },
): Promise<WorldEpisodeResult> {
    const { world, characters, apiConfig, userProfile, groups, realtimeConfig, episodeId, charId, direction } = deps;
    if (running.has(world.id)) return { ok: false, reason: 'busy' };
    const members = world.memberIds.map(id => characters.find(c => c.id === id)).filter(Boolean) as CharacterProfile[];
    const char = members.find(m => m.id === charId);
    if (!char) return { ok: false, reason: 'no-char' };
    const memberNames = members.map(m => m.name);
    const worldHomeApi = readWorldHomeApiOverride();
    const api = world.api?.baseUrl ? world.api : (worldHomeApi || apiConfig);
    if (!api.baseUrl) return { ok: false, reason: 'no-api' };
    const baseUrl = api.baseUrl.replace(/\/+$/, '');

    const episodes = await DB.getWorldEpisodes(world.id, 30);
    const episode = episodes.find(e => e.id === episodeId);
    if (!episode) return { ok: false, reason: 'no-episode' };
    const hadBeat = episode.beats.some(b => b.charId === charId);

    running.add(world.id);
    dispatch('world-episode-start', { worldId: world.id, worldName: world.name, storyTime: episode.storyTime, total: 1 });
    dispatch('world-beat-done', { worldId: world.id, stage: 'char', charId, charName: char.name, done: 0, total: 1 });
    try {
        const prevEp = episodes.find(e => e.round === episode.round - 1);
        const otherBeats = episode.beats.filter(b => b.charId !== charId);
        const others = memberNames.filter(n => n !== char.name);
        const recallQueryHint = others.length > 0
            ? `此刻在「${world.name}」共同生活的人：${others.join('、')}。\n我对${others.join('、')}的印象、我和${others.join('、')}之间的关系与过往。`
            : undefined;
        const historyMsgs = await loadCharacterContextMessages(char);
        const contextLimit = Math.max(1, historyMsgs.length);
        const worldChar = alignCharToWorldClock(world, char);
        const payload = await buildChatRequestPayload({
            char: worldChar, userProfile, groups, emojis: [], categories: [],
            historyMsgs, contextLimit, realtimeConfig, recallQueryHint,
            recallEntryPoint: 'world_home',
            // 同上：独立 API 可能不支持视觉 → 历史图片压平成文本占位
            stripImages: true,
        });
        const systemPrompt = payload.systemPrompt
            + buildWorldSystemAddendum(world, char, userProfile?.name || '')
            + await buildFullDayScheduleBlock(world, worldChar);
        const latestChapter = (world.chapters || [])[(world.chapters?.length || 0) - 1];
        const priorChapter = (world.timeMode === 'sim' && latestChapter)
            ? { atmosphere: latestChapter.atmosphere, charPerspective: latestChapter.perspectives.find(p => p.charId === char.id)?.text }
            : undefined;
        let turn = buildWorldCharTurn({
            world, char, members, storyTime: episode.storyTime, round: episode.round, lastSummary: prevEp?.summary,
            npcScene: episode.npcScene, npcHooks: episode.npcHooks, beatsSoFar: otherBeats,
            recentPosts: collectRecentPosts(prevEp?.beats || [], otherBeats),
            exposures: buildExposures(world, char.id, char.name),
            pendings: buildPendingNotes(world, char.id, episode.round, members),
            giftsReceived: takeGifts(world, char.id),
            priorChapter, userName: userProfile?.name || '',
        });
        if (direction && direction.trim()) {
            turn += `\n\n## 重写方向（用户希望这次往这个方向重演，请据此给出全新的一拍）\n${direction.trim()}`;
        }
        const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: api.model,
                messages: [{ role: 'system', content: systemPrompt }, ...payload.cleanedApiMessages, { role: 'user', content: turn }],
                temperature: 0.95, stream: false,
            }),
        }, 2, 0, { appName: '家园', charId: char.id, charName: char.name, purpose: `重演 · ${world.name}` });
        const beat = parseCharBeat(data.choices?.[0]?.message?.content || '', char, memberNames, world.npcs.map(n => n.name), world.places, userProfile?.name);
        // 重演这一拍同样剔除和最近动态重复的 post
        dropDuplicatePosts(beat, collectRecentPosts(prevEp?.beats || [], otherBeats));

        const newBeats = hadBeat ? episode.beats.map(b => b.charId === charId ? beat : b) : [...episode.beats, beat];
        const stillFailed = (episode.failedCharIds || []).filter(id => id !== charId);
        const updatedEp: WorldEpisode = {
            ...episode,
            beats: newBeats,
            failedCharIds: stillFailed.length > 0 ? stillFailed : undefined,
            summary: buildSummary(episode.storyTime, newBeats, episode.npcHooks || []),
        };
        await DB.saveWorldEpisode(updatedEp);

        // 重演会换掉这一拍的动态，但点赞/评论按 `round_charId_idx` 关联——不清掉旧反应，
        // 上一次的评论就会原样挂到新动态上（评论对不上号）。这里把这名角色这一轮的反应全抹掉；
        // 重演不再跑 NPC 引擎，新动态先没有互动也好过挂错评论。
        let worldDirty = false;
        if (world.feedReactions) {
            const prefix = `${episode.round}_${charId}_`;
            const kept = Object.fromEntries(Object.entries(world.feedReactions).filter(([k]) => !k.startsWith(prefix)));
            if (Object.keys(kept).length !== Object.keys(world.feedReactions).length) {
                world.feedReactions = kept;
                worldDirty = true;
            }
        }

        // 仅当之前是「失败缺这拍」时补副作用，避免对已有拍重复加好感/重复消息
        if (!hadBeat) {
            applyBeatToThreads(world, beat, members, episode.round, episode.storyTime);
            collectSeeds(world, beat, episode.round, episode.storyTime);
            collectAppointments(world, beat, members, episode.round);
            collectGifts(world, beat, members, episode.round, userProfile?.name);
            const rerollHostDeltas = applyRelationshipDeltas(world, [beat], members, episode.round, userProfile?.name);
            // 同主路径：sim 世界不往角色卡上写
            if (world.timeMode !== 'sim' && world.injectToChat !== false) {
                await applyHostBondDeltas(rerollHostDeltas);
                await mirrorWorldBondsToChars(world, members, episode.round);
            }
            worldDirty = true;
            if (world.timeMode !== 'sim' && world.injectToChat !== false) {
                try { await injectWorldCard(world, beat, episode.round, episode.storyTime); } catch { /* ignore */ }
            }
        } else if (world.timeMode !== 'sim' && world.injectToChat !== false) {
            // 阶段 2.5：这一拍本来就有，副作用不能重复落；但**已经注入的那张卡必须跟着改**，
            // 否则小镇里是新版本、角色聊天与记忆里是旧版本，两边永久分叉
            // （real 模式下 world_card 是进记忆的 —— 角色会一直记着一段你已经改掉的经历）。
            try {
                await updateInjectedWorldCard(world, beat, episode.round, episode.storyTime);
            } catch (e) {
                console.error('[WorldHome] world_card 同步失败（重演）:', e);
            }
        }
        if (worldDirty) {
            await DB.saveWorld({ ...world, threads: world.threads, seeds: world.seeds, pendings: world.pendings, giftInbox: world.giftInbox, giftsForHost: world.giftsForHost, relationships: world.relationships, feedReactions: world.feedReactions, updatedAt: Date.now() });
        }
        dispatch('world-episode-done', { worldId: world.id, episodeId: updatedEp.id, storyTime: episode.storyTime, round: episode.round });
        return { ok: true, episode: updatedEp };
    } catch (err) {
        console.error('[WorldHome] reroll error:', err);
        return { ok: false, reason: 'error' };
    } finally {
        running.delete(world.id);
        dispatch('world-episode-end', { worldId: world.id });
    }
}
