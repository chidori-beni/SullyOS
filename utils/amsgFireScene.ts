/**
 * 主动消息「此刻在做什么」的到点渲染（AMSG_SLOT_SCENE）。
 *
 * 为什么要有这一层：fire_pack 是最后一次聊天时打好的模板，到点才渲染。角色的日程
 * 「当前时段」和由日程推出来的「此刻在听的歌」都是打包那一刻算的，烤进模板的话，
 * 凌晨三点触发时角色会说「我在健身房呢，今天多跑了两公里」。这两块改成随包带原始数据
 * （整天的作息表 + 歌单抽样池），worker 到点按角色时区现算。
 *
 * 一份表只管一天：随包还带打包那天的日期（dateKey），到点先比日期，跨天了整段不用——
 * 拿周五的作息表照着周日念，跟烤死是同一种穿帮。
 *
 * 零浏览器依赖：只 import type 和两个纯叶子（scheduleInjection / charMusicSchedule /
 * timezone / localDate）。日程文本与前台聊天共用 buildScheduleInjection，歌与前台聊天
 * 共用 pickSongFromPool —— 不共用的话，角色在聊天里和到点生成时会说出两套作息。
 *
 * 前台聊天的音乐块比这里丰富（一起听状态、歌词片段、换歌察觉，见
 * ContextBuilder.buildMusicAtmosphere）。那些要么依赖用户此刻的播放状态、要么要拉网络，
 * worker 都够不着，所以 fire 这边只渲染「你此刻在听什么」这一句。
 */

/** 抽歌只用到这三个字段；专辑封面之类不随包上云。 */
export interface AmsgFireSong {
  id: number;
  name: string;
  artists: string;
}
import { getLocalDateKey } from './localDate';
import { nowInTimeZone } from './timezone';
import { addScheduleDateKey } from './scheduleTime';
import { buildScheduleInjection, resolveScheduleSlots, type RenderableSchedule } from './scheduleInjection';
import { pickSongFromPool, slotIsListening } from './charMusicSchedule';
import { resolveScheduleSleepState, type ScheduleSleepState } from './scheduleSleep';
import type { AmsgTzRef } from './amsgFirePack';

/** 随 fire_pack 带给 worker 的原始素材。到点渲染成 AMSG_SLOT_SCENE 那一段。 */
export interface AmsgFireScene {
  /** 角色 id —— 抽歌的种子之一，换个角色同一时段听的歌不一样。 */
  charId: string;
  /**
   * 这份日程说的是哪一天（打包时角色当地的 YYYY-MM-DD）。
   *
   * 表里只有「几点做什么」，没有日期。周五晚上打的包周日上午触发时，光按墙钟时分挑
   * 时段一样挑得出「09:00 晨会」——角色于是在周日说自己正在开周五的会。到点先比日期，
   * 不是同一天就整段不用（见 renderFireSceneBlock）。
   */
  dateKey: string;
  /**
   * 打包时那天的日程；到点由 worker 按角色时区挑出当前时段。
   *
   * 只带渲染会读的字段（见 RenderableSchedule）——整份 DailySchedule 里挂着每个时段
   * 缓存的小剧场台词和 coverImage（可能是 base64 图），随包上云纯属白占体积。
   */
  schedule: RenderableSchedule | null;
  /**
   * 意识流独白。日程自带的 flowNarrative 按小时分三档、到点现取，
   * 这个字段是聊天时演化出来的那一份（进化独白），有的话优先。
   */
  evolvedNarrative?: string;
  /**
   * 明天的预排表（用户提前排了才有）。
   *
   * 为什么非带不可：fire_pack 只在用户开着 App 的时候重打，而角色当地的午夜一过，
   * 上面那张 dateKey 的表就整段作废了。用户睡着的那几个小时恰恰没人聊天，于是
   * **每一条深夜触发的主动消息都是在「没有日程」的状态下生成的** —— 睡眠闸看不见
   * 角色在睡觉（resolveFireSceneSleep 返回 null），提示词里连作息都没有，模型只能
   * 现编一个活动。2026-09-16 凌晨那条「刚从模拟舱下来」就是这么来的：角色本该
   * 00:00–07:00 深睡。带上明天这一张，跨过午夜之后就还有表可用。
   */
  nextDay?: { dateKey: string; schedule: RenderableSchedule } | null;
  /** 歌单抽样池（charMusicSchedule.buildSongPool 的结果，最多 20 首）。 */
  songPool: AmsgFireSong[];
}

/**
 * 到点按角色墙钟挑「今天该用哪张表」：先看随包那张，再看明天的预排表。
 *
 * 一张表只管一天的老规矩没变——变的只是包里现在可能有两张，挑的是日期真正对得上的
 * 那一张。两张都对不上（跨了两天以上、或者没预排）就返回 null，整段照旧不用。
 */
const resolveSceneScheduleForDay = (
  scene: AmsgFireScene | null,
  todayKey: string,
): RenderableSchedule | null => {
  if (!scene) return null;
  if (scene.dateKey === todayKey && scene.schedule?.slots?.length) return scene.schedule;
  const next = scene.nextDay;
  if (next && next.dateKey === todayKey && next.schedule?.slots?.length) return next.schedule;
  return null;
};

/**
 * 这次触发角色「此刻在听」的是哪一首（不在听歌的时段 / 歌单空 / 跨天作废 → null）。
 *
 * 单独 export 是给 worker 用的：prompt 里那句「你此刻在听：《X》」是这里挑的，可角色
 * 写出来的 `[[MUSIC_ACTION:add|歌单标题]]` 标签只带得动歌单名、带不动歌名。worker 到点
 * 把这一首附进 music_action directive，客户端重放时才知道角色说的是哪首歌——不然只能取
 * 「用户此刻在听的那首」，而定时消息补收时用户多半什么都没在放，卡片和加歌单整个不发生。
 *
 * 判定与种子跟 renderFireSceneBlock 共用这一份：prompt 里写的那首和 directive 里冻的
 * 那首必须严格是同一首，各写一份迟早对不上。
 */
export const resolveFireSceneSong = (
  scene: AmsgFireScene | null,
  nowMs: number,
  tz: AmsgTzRef,
): AmsgFireSong | null => {
  if (!scene) return null;
  const wallNow = nowInTimeZone(tz.tzId, new Date(nowMs));
  // 跨天的包整段作废，「此刻在听」跟着走：那首歌是从当前时段推出来的，日程都不算数了，
  // 它就没有依据了（同 renderFireSceneBlock 的日期门槛）。
  const schedule = resolveSceneScheduleForDay(scene, getLocalDateKey(wallNow));
  if (!schedule) return null;
  if (scene.songPool.length === 0) return null;

  const { current } = resolveScheduleSlots(schedule, wallNow);
  if (!current || !slotIsListening(current)) return null;
  return pickSongFromPool(
    scene.songPool,
    current.startTime,
    getLocalDateKey(wallNow),
    scene.charId,
  );
};

/**
 * 这次触发时角色是不是正睡在日程里的一觉中（不在睡 / 没日程 → null）。
 *
 * 给自然主动当闸用：它以前完全看不见日程，白天补觉的角色照样每十几分钟被问一次
 * 要不要联系，于是睡两个小时就爬起来发消息。
 *
 * **这一个的日期门槛比 renderFireSceneBlock 松一档，是故意的。** 渲染那边说错
 * 「我正在开周五的会」是凭空捏造，宁缺勿错；而这边只回答「他这会儿是不是在睡」，
 * 作息恰恰是一天里最稳定的那一部分。而且门槛一样严的话，这道闸在**最需要它的时候
 * 必然失效**：fire_pack 只在用户开着 App 时重打，角色当地午夜一过随包那张表就作废，
 * 而深夜正是没人聊天、包永远过期的那几个小时。2026-09-16 凌晨那条「刚从模拟舱下来」
 * 就是这么发出来的——表上写着 00:00–07:00 深睡，闸却什么都没看见。
 *
 * 所以这里按三档取：
 *   1. 日期对得上的那张表（随包的，或者明天的预排表）—— 正常情况；
 *   2. 都对不上，但随包那张正好是**紧挨着的前一天**（即角色刚过完午夜）——
 *      用它的睡眠时段兜底。只用来判「在不在睡」，一个字都不进提示词；
 *   3. 再往前的陈表不用：隔了好几天的作息已经没有参考价值。
 */
export const resolveFireSceneSleep = (
  scene: AmsgFireScene | null,
  nowMs: number,
  tz: AmsgTzRef,
): ScheduleSleepState | null => {
  if (!scene) return null;
  const wallNow = nowInTimeZone(tz.tzId, new Date(nowMs));
  const todayKey = getLocalDateKey(wallNow);
  const exact = resolveSceneScheduleForDay(scene, todayKey);
  if (exact) return resolveScheduleSleepState(exact.slots, wallNow);
  // 兜底档：只认「昨天那张」，且只认它的睡眠时段。
  if (!scene.schedule?.slots?.length) return null;
  if (addScheduleDateKey(scene.dateKey, 1) !== todayKey) return null;
  return resolveScheduleSleepState(scene.schedule.slots, wallNow);
};

/**
 * 渲染 fire 时刻的「此刻在做什么」。没有日程、日程是空表、或者这份日程已经不是今天的了，
 * 一律返回空串（槽位被抹平，模板跟没这回事一样）。
 *
 * includeClock 跟着角色的「时间感知」开关走（worker 从 tool_pack 读，同今日节日那条）。
 * 关掉的角色在前台连「现在几点」都读不到，这里要是照旧写「当前时段：23:00 你正在睡觉」，
 * 钟就从日程这条缝漏了出去。日程本身照给——它有自己的总开关。
 */
export const renderFireSceneBlock = (
  scene: AmsgFireScene | null,
  nowMs: number,
  tz: AmsgTzRef,
  options?: { includeClock?: boolean },
): string => {
  if (!scene) return '';

  // 角色所在地的墙钟：日程表里的 "08:00" 说的是角色那边的八点。
  const wallNow = nowInTimeZone(tz.tzId, new Date(nowMs));
  // 跨天的包整段不用：这是 scene.dateKey 那天的安排，第二天再照着念就是在说昨天的事。
  // 宁缺勿错，跟「实时世界拉不到就整段消失」同一条线。包里带了明天的预排表时，
  // 过了角色当地午夜就改用那一张——那张说的正是此刻这一天。
  const schedule = resolveSceneScheduleForDay(scene, getLocalDateKey(wallNow));
  if (!schedule) return '';
  const scheduleText = buildScheduleInjection(
    schedule,
    scene.evolvedNarrative,
    wallNow,
    {
      includeClock: options?.includeClock !== false,
      // 到点主动开口的角色最容易撞上「表上写着睡觉、我却正在给对方发消息」，
      // 所以这条路也要教。标签由 worker classifier 摘成 directive 随 push 回来、
      // 客户端落库；落库按 push 的 sentAt 判时段，隔夜的整批丢弃（见 scheduleChange）。
      includeChangeInstruction: true,
    },
  ).trim();

  const lines: string[] = [];
  if (scheduleText) lines.push(scheduleText);

  const song = resolveFireSceneSong(scene, nowMs, tz);
  if (song) lines.push(`你此刻在听：《${song.name}》— ${song.artists}`);

  if (lines.length === 0) return '';
  // 前导空行：槽位是紧跟在上一行后面填的，自带空行才不会跟当前时间粘成一行。
  return `\n\n${lines.join('\n')}`;
};
