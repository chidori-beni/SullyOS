import type {
  APIConfig,
  CharacterProfile,
  NaturalProactiveConfig,
  NaturalProactiveIntensity,
  NaturalProactiveProfile,
  NaturalProactiveRelationship,
} from '../types';
import { safeFetchJson } from './safeApi';
import type { ScheduleSleepState } from './scheduleSleep';

export const NATURAL_PROACTIVE_SUBTYPE = 'natural-proactive';
export const NATURAL_PROACTIVE_PROFILE_VERSION = 1 as const;

/** 自然主动的共同任务基线；前端排新任务和 Worker 续排都必须使用同一份口径。 */
export const NATURAL_PROACTIVE_TASK_INSTRUCTION =
  '这是角色自然产生的联系冲动，不是用户颁布的任务。结合人设、关系、最近上下文和此刻生活状态，像真人一样自然地联系对方；回复长度由眼前真正需要说的内容决定，简单时短一些，有多个重要内容时可以展开并换行分成多条。不要为了凑数量补话，也不要解释系统判断或说自己被定时唤醒。';

export interface NaturalReplyGuidance {
  pendingUserMessageCount: number;
  softBubbleBudget: number;
  prompt: string;
}

const safeNaturalPendingCount = (value: number): number =>
  Math.min(20, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));

const pickNaturalBudget = (values: number[], random01: number): number => {
  const safeRandom = clamp(random01, 0, 0.999999);
  return values[Math.floor(safeRandom * values.length)] ?? values[0];
};

/**
 * 把「积压了多少条用户消息」变成给模型看的软回复预算。
 *
 * 预算只负责把模型从固定两句拉开，并提醒它别漏掉重要内容；它不是要求模型填满的
 * 目标。真正落地时仍由 agentic 分段，Worker 最后保留 20 个气泡的安全上限。
 */
export const buildNaturalReplyGuidance = (
  pendingUserMessageCount: number,
  random01: number,
  afterBusyAutoReply = false,
): NaturalReplyGuidance => {
  const pending = safeNaturalPendingCount(pendingUserMessageCount);
  const budget = pending <= 1
    ? pickNaturalBudget([1, 2, 3, 4], random01)
    : pending <= 4
      ? pickNaturalBudget([3, 4, 5, 6], random01)
      : pending <= 9
        ? pickNaturalBudget([5, 6, 7, 8, 9], random01)
        : Math.min(20, pending + pickNaturalBudget([-1, 0, 1, 2, 3], random01));

  const lines = [
    '[本轮自然回复节奏]',
    '不要把每次主动消息写成相同的句数；简单念头说完就停，只有自然产生后续才换行分成多条。内容决定长度，不要为了达到某个数量补话。',
    `本轮最多先考虑 ${budget} 个聊天气泡，这是软参考，不是必须达到的数量；系统最终 20 个气泡只是安全上限，不是回复目标。`,
  ];
  if (pending > 1) {
    lines.push(
      `最近连续有 ${pending} 条用户消息还没有被角色的正常内容覆盖。请先读完全部上下文，优先回应重要/最新的问题、情绪、明确邀请和约定；相关内容可以合并，不要机械逐条复述。若确有多个独立内容，允许自然分成多条连续气泡，重要内容优先。`,
    );
  }
  if (afterBusyAutoReply) {
    lines.push(
      '上一条角色消息是忙碌自动回复，它只是占位通知，不算真正回答；请把这段时间用户发来的内容看完并尽量补回重点，不要只重复“稍后回复”。当前日程仍以当前时刻补充为准，不要假装已经结束仍在进行的活动。',
    );
  }

  return {
    pendingUserMessageCount: pending,
    softBubbleBudget: budget,
    prompt: lines.join('\n'),
  };
};

export type {
  NaturalProactiveConfig,
  NaturalProactiveIntensity,
  NaturalProactiveProfile,
  NaturalProactiveRelationship,
} from '../types';

export interface NaturalProactiveDecisionInput {
  nowMs: number;
  lastUserMessageAt: number | null;
  recentSelfSendAts: number[];
  unansweredCount: number;
  random01: number;
  profile: NaturalProactiveProfile;
  intensity: NaturalProactiveIntensity;
  bias: number;
  tzId: string;
  pendingTopic?: number;
  emotion?: number;
  /**
   * 角色此刻是不是正睡在日程里的一觉中（`resolveScheduleSleepState` 的结果）。
   *
   * 不传 = 没有日程、日程跨天作废、或者这条路根本读不到日程；那时行为跟以前完全一样，
   * 只由画像里的 quietHours 兜着。
   */
  sleep?: ScheduleSleepState | null;
}

export interface NaturalProactiveDecision {
  shouldSend: boolean;
  score: number;
  threshold: number;
  nextCheckMinutes: number;
  reasons: string[];
  /** 这次是因为「角色正睡着」被挡下的（面板要跟「分数不够」分开说）。 */
  asleep: boolean;
}

/**
 * 快醒了就不再压着：离这条睡眠日程结束还剩这么多分钟以内，照常算分。
 *
 * 留这个口子是因为「醒来第一件事就是找对方」本身很自然，而日程只精确到分钟级的计划，
 * 差一刻钟醒不算穿帮。压着不放的话，角色永远只能在整点之后才开口。
 */
export const NATURAL_SLEEP_WAKE_SOON_MINUTES = 20;

/**
 * 睡着期间把下一次「要不要联系」直接排到快醒的时候，而不是照常十几分钟想一次。
 *
 * 上限 240 分钟是保险：这份日程可能已经过期、被用户改掉，或者角色中途真的被吵醒；
 * 排太远的话，一份写错的睡眠时段能让角色整整半天不吭声，而且中间没有任何纠正机会。
 */
export const NATURAL_SLEEP_MAX_DEFER_MINUTES = 240;

/** 睡着期间下一次重新考虑的间隔：默认排到快醒那一刻，最多不超过 4 小时。 */
export const naturalSleepDeferMinutes = (
  remainingMinutes: number,
  random01: number,
): number => {
  const safeRandom = clamp(random01, 0, 0.999999);
  const wakeAt = Math.max(0, remainingMinutes) - NATURAL_SLEEP_WAKE_SOON_MINUTES;
  // 抖动只是避免同一批角色整点齐刷刷醒来一起发消息。
  const jitter = 1 + Math.floor(safeRandom * 10);
  return clamp(Math.round(wakeAt) + jitter, 1, NATURAL_SLEEP_MAX_DEFER_MINUTES);
};

/**
 * 自然主动在用户未回复期间的最终安全上限；不受 2.0 约定任务设置影响。
 *
 * 这个数是「防止失控」的保险丝，不是频率设置。真正的克制 / 自然 / 热络差异由
 * `naturalCheckWindowMinutes` 和评分阈值体现；否则把上限设成很小的数字会让角色
 * 因为用户暂时没回就永久变得像被掐断，而不是自然地隔一阵再想起用户。
 */
export const NATURAL_UNANSWERED_HARD_CAP = 20;
export const naturalUnansweredHardCap = (_intensity: NaturalProactiveIntensity): number =>
  NATURAL_UNANSWERED_HARD_CAP;

/**
 * 未回复扣分的每条系数与上限。
 *
 * 这两个数必须**远小于**沉默能贡献的分数，否则上面那道 20 条的保险丝根本够不着：
 * 早期版本按每条 0.16、上限 0.45 扣，而加分项总共也就 0.5～0.65，于是连着两三条
 * 没被回复之后扣分永久盖过所有加分，角色再也开不了口——面板上写着「最多 20 条」，
 * 实际上限却是 2～3 条，而且是**永久**的，用户只会觉得角色忽然变冷淡了。
 *
 * 现在的口径是「收敛，但不掐死」：连发几条没人理会明显压低冲动，可只要再沉默久一点，
 * naturalSilenceIntensity 的增长就能把它抬回阈值之上。真正的终止条件只有一个，
 * 就是 NATURAL_UNANSWERED_HARD_CAP。
 */
export const NATURAL_UNANSWERED_PENALTY_PER_MSG = 0.08;
export const NATURAL_UNANSWERED_PENALTY_CAP = 0.24;

/**
 * 沉默强度：饱和点之前线性，之后按对数继续缓慢增长，最多再加一个身位（上限 2）。
 *
 * 为什么不能像早期版本那样停在 1：饱和之后「沉默 3 小时」和「沉默 30 小时」得分完全
 * 一样，于是任何一个固定扣分（未回复、安静时段）只要压过阈值，就**再没有任何变量**
 * 能把分数拉回来，角色永久闭嘴。让「很久没联系」始终能继续加分，「隔一阵又想起你」
 * 这件事才成立；同时对数增长保证它涨得越来越慢，不会变成催命式连发。
 */
export const naturalSilenceIntensity = (
  hoursSilent: number,
  saturationHours: number,
): number => {
  const ratio = Math.max(0, hoursSilent) / Math.max(0.5, saturationHours);
  if (ratio <= 1) return clamp(ratio, 0, 1);
  return 1 + clamp(Math.log2(ratio) * 0.5, 0, 1);
};

/** 单次自然主动投递最多落成多少个聊天气泡；防止模型一次返回很长的分段列表。 */
export const NATURAL_BATCH_HARD_CAP = 20;

/** 下一次「考虑要不要联系」的检查窗口（分钟），不是保证发送的间隔。 */
export const naturalCheckWindowMinutes = (
  intensity: NaturalProactiveIntensity,
  random01: number,
): number => {
  const safeRandom = clamp(random01, 0, 0.999999);
  const [min, max] = intensity === 'low'
    ? [30, 60]
    : intensity === 'high'
      ? [8, 20]
      : [15, 30];
  return min + Math.floor(safeRandom * (max - min + 1));
};

/**
 * 计算自然主动下一次检查时间。
 *
 * Worker/cron 偶尔会停摆或晚到；这时 occurrenceMs 可能已经是过去的时间。
 * 下一次必须从「现在」往后排，不能沿着过期时间线连续补跑。
 */
export const nextNaturalCheckAt = (
  occurrenceMs: number,
  nowMs: number,
  nextCheckMinutes: number,
): number => Math.max(occurrenceMs, nowMs) + Math.max(1, nextCheckMinutes) * 60_000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const num = (value: unknown, fallback: number, min: number, max: number) =>
  clamp(typeof value === 'number' && Number.isFinite(value) ? value : fallback, min, max);

const textForProfile = (char: CharacterProfile): string => [
  char.description,
  char.systemPrompt,
  char.worldview,
  char.writerPersona,
].filter(Boolean).join('\n\n').slice(0, 24_000);

const inferRelationshipHints = (char: CharacterProfile): {
  relationship: NaturalProactiveRelationship;
  longDistance: boolean;
} => {
  const source = textForProfile(char).toLowerCase();
  const romantic = /(情侣|恋人|爱人|伴侣|男朋友|女朋友|老公|老婆|未婚夫|未婚妻|恋爱|相爱|暧昧|lover|romantic partner|girlfriend|boyfriend|husband|wife|fiance)/i.test(source);
  const close = /(亲密|亲近|挚友|知己|家人|最好的朋友|best friend|close friend)/i.test(source);
  const longDistance = /(异地|远距离|远距|两地|跨城|分隔两地|不在身边|只能通过手机|只能靠手机|long[- ]distance|different cities|far apart|apart from)/i.test(source);
  return {
    relationship: romantic ? 'romantic' : close ? 'close' : 'neutral',
    longDistance,
  };
};

/**
 * 给旧画像补上关系信号。关系信息来自角色档案，不需要再调用模型，
 * 因此已经开启自然主动的角色也能在下一次打包状态时获得情侣/异地加权。
 */
export const enrichNaturalProfileForCharacter = (
  profile: NaturalProactiveProfile,
  char: CharacterProfile,
): NaturalProactiveProfile => {
  const hints = inferRelationshipHints(char);
  const romantic = hints.relationship === 'romantic';
  const longDistanceRomance = romantic && hints.longDistance;
  return {
    ...profile,
    relationship: hints.relationship !== 'neutral' ? hints.relationship : (profile.relationship ?? 'neutral'),
    longDistance: profile.longDistance === true || hints.longDistance,
    threshold: romantic ? Math.min(profile.threshold, longDistanceRomance ? 0.48 : 0.54) : profile.threshold,
    silenceSaturationHours: romantic
      ? Math.min(profile.silenceSaturationHours, longDistanceRomance ? 5 : 6)
      : profile.silenceSaturationHours,
  };
};

/** 无 API / 模型格式跑偏时的保守画像；仍会从人设关键词推断亲疏与作息倾向。 */
export const buildFallbackNaturalProfile = (char: CharacterProfile): NaturalProactiveProfile => {
  const source = textForProfile(char).toLowerCase();
  const relationshipHints = inferRelationshipHints(char);
  const clingy = /(黏|粘人|依赖|占有|焦虑|敏感|患得患失|clingy|possessive|anxious)/i.test(source);
  const reserved = /(冷淡|疏离|寡言|克制|慢热|高冷|独立|reserved|aloof|stoic)/i.test(source);
  const nocturnal = /(夜猫|熬夜|昼夜颠倒|夜间|凌晨|night owl|nocturnal)/i.test(source);
  const romantic = relationshipHints.relationship === 'romantic';
  const longDistanceRomance = romantic && relationshipHints.longDistance;
  const threshold = longDistanceRomance ? 0.40 : romantic ? 0.44 : clingy ? 0.48 : reserved ? 0.68 : 0.58;
  return enrichNaturalProfileForCharacter({
    version: 1,
    archetype: romantic ? (relationshipHints.longDistance ? '异地牵挂型' : '恋人牵挂型') : clingy ? '牵挂型' : reserved ? '克制型' : nocturnal ? '夜行型' : '自然型',
    summary: romantic
      ? (relationshipHints.longDistance
        ? '你们是亲密关系且身处异地，会更容易因为想念而联系，但连续未获回复时仍会收住。'
        : '你们是亲密关系，会更容易因为想念和未完的话主动联系，但不会机械连发。')
      : clingy
      ? '更容易因挂念和未说完的话主动联系，但仍会在连续未获回复时收住。'
      : reserved
        ? '通常给彼此留空间，只在沉默够久或确实想到事情时主动联系。'
        : '会结合沉默时长、当下时段和未完话题，自然决定要不要联系。',
    weights: {
      silence: reserved ? 0.42 : 0.34,
      timeOfDay: nocturnal ? 0.18 : 0.12,
      emotion: clingy ? 0.22 : 0.14,
      pendingTopic: clingy ? 0.22 : 0.26,
      spontaneousThought: reserved ? 0.08 : 0.14,
    },
    silenceSaturationHours: longDistanceRomance ? 2.5 : romantic ? 3 : clingy ? 3 : reserved ? 12 : 7,
    quietHours: nocturnal ? [4, 10] : [0, 8],
    threshold,
    spontaneousChancePerDay: longDistanceRomance ? 0.9 : romantic ? 0.78 : clingy ? 0.7 : reserved ? 0.18 : 0.4,
    derivedAt: Date.now(),
    source: 'fallback',
  }, char);
};

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
  const fenced = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
};

export const deriveNaturalProfile = async (
  char: CharacterProfile,
  apiConfig: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>,
): Promise<NaturalProactiveProfile> => {
  const fallback = buildFallbackNaturalProfile(char);
  if (!apiConfig.baseUrl?.trim() || !apiConfig.apiKey?.trim() || !apiConfig.model?.trim()) return fallback;
  try {
    const data = await safeFetchJson(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify({
        model: apiConfig.model,
        stream: false,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content: '你是角色互动产品的行为画像器。只输出 JSON，不写解释。画像描述角色在没有任务指令时，自发联系亲近之人的倾向；请识别角色与用户是否是情侣/恋人/伴侣，以及是否异地或主要只能靠手机联系。情侣和异地应提高挂念与主动联系倾向，但不要把病理化焦虑当成必然骚扰，也不要机械连发。所有小数范围 0..1。',
          },
          {
            role: 'user',
            content: `阅读下面角色档案，输出：{"archetype":"短标签","summary":"60字内","relationship":"romantic|close|neutral","longDistance":false,"weights":{"silence":0.34,"timeOfDay":0.12,"emotion":0.14,"pendingTopic":0.26,"spontaneousThought":0.14},"silenceSaturationHours":7,"quietHours":[0,8],"threshold":0.58,"spontaneousChancePerDay":0.4}。relationship 只有在档案有明确依据时才写 romantic（情侣/恋人/伴侣）或 close（亲密关系/挚友），不确定写 neutral；异地、远距离、分隔两地或主要只能靠手机联系时 longDistance=true，否则 false。情侣+异地可以把 threshold 降到 0.35..0.5、silenceSaturationHours 取 2..5，但仍要保留深夜和连续未回复的克制。weights 总和应接近 1；silenceSaturationHours 取 2..24；threshold 取 0.35..0.8；quietHours 是角色通常不打扰对方的本地小时区间。\n\n角色名：${char.name}\n${textForProfile(char)}`,
          },
        ],
      }),
    });
    const raw = data?.choices?.[0]?.message?.content;
    const parsed = typeof raw === 'string' ? extractJsonObject(raw) : null;
    if (!parsed) return fallback;
    const weights = (parsed.weights && typeof parsed.weights === 'object' ? parsed.weights : {}) as Record<string, unknown>;
    const quiet = Array.isArray(parsed.quietHours) ? parsed.quietHours : fallback.quietHours;
    const relationship = parsed.relationship === 'romantic' || parsed.relationship === 'close' || parsed.relationship === 'neutral'
      ? parsed.relationship : fallback.relationship;
    const longDistance = parsed.longDistance === true || (typeof parsed.longDistance === 'string' && parsed.longDistance.toLowerCase() === 'true');
    return enrichNaturalProfileForCharacter({
      version: 1,
      archetype: typeof parsed.archetype === 'string' ? parsed.archetype.slice(0, 20) : fallback.archetype,
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 120) : fallback.summary,
      weights: {
        silence: num(weights.silence, fallback.weights.silence, 0, 1),
        timeOfDay: num(weights.timeOfDay, fallback.weights.timeOfDay, 0, 1),
        emotion: num(weights.emotion, fallback.weights.emotion, 0, 1),
        pendingTopic: num(weights.pendingTopic, fallback.weights.pendingTopic, 0, 1),
        spontaneousThought: num(weights.spontaneousThought, fallback.weights.spontaneousThought, 0, 1),
      },
      silenceSaturationHours: num(parsed.silenceSaturationHours, fallback.silenceSaturationHours, 2, 24),
      quietHours: [Math.round(num(quiet[0], fallback.quietHours[0], 0, 23)), Math.round(num(quiet[1], fallback.quietHours[1], 0, 23))],
      threshold: num(parsed.threshold, fallback.threshold, 0.35, 0.8),
      spontaneousChancePerDay: num(parsed.spontaneousChancePerDay, fallback.spontaneousChancePerDay, 0, 1),
      relationship,
      longDistance: longDistance || fallback.longDistance === true,
      derivedAt: Date.now(),
      source: 'llm',
    }, char);
  } catch (error) {
    console.warn('[NaturalProactive] 人设画像生成失败，使用本地保守画像', error);
    return fallback;
  }
};

const hourInZone = (nowMs: number, tzId: string): number => {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: tzId, hour: '2-digit', hour12: false })
    .formatToParts(new Date(nowMs)).find((p) => p.type === 'hour')?.value;
  const parsed = Number(hour);
  return parsed === 24 ? 0 : parsed;
};

const isQuietHour = (hour: number, [start, end]: [number, number]) =>
  start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;

export const decideNaturalProactive = (input: NaturalProactiveDecisionInput): NaturalProactiveDecision => {
  const { profile } = input;
  const hoursSilent = input.lastUserMessageAt == null
    ? profile.silenceSaturationHours
    : Math.max(0, input.nowMs - input.lastUserMessageAt) / 3_600_000;
  const silence = naturalSilenceIntensity(hoursSilent, profile.silenceSaturationHours);
  const hour = hourInZone(input.nowMs, input.tzId);
  const quiet = isQuietHour(hour, profile.quietHours);
  const recentSendMinutes = input.recentSelfSendAts.length
    ? (input.nowMs - Math.max(...input.recentSelfSendAts)) / 60_000 : Infinity;
  const spontaneous = input.random01 < profile.spontaneousChancePerDay / 36 ? 1 : 0;
  const relationshipBoost = profile.relationship === 'romantic' ? 0.10 : profile.relationship === 'close' ? 0.03 : 0;
  const distanceBoost = profile.longDistance ? 0.06 : 0;
  let score = silence * profile.weights.silence
    + (quiet ? 0 : 0.65) * profile.weights.timeOfDay
    + clamp(input.emotion ?? 0.25, 0, 1) * profile.weights.emotion
    + clamp(input.pendingTopic ?? 0.15, 0, 1) * profile.weights.pendingTopic
    + spontaneous * profile.weights.spontaneousThought
    + relationshipBoost
    + distanceBoost;
  const reasons = [`沉默 ${hoursSilent.toFixed(1)} 小时`];
  // 日程里正睡着：直接不发，并把下一次考虑排到快醒的时候。
  //
  // 这一道闸在算分之前就结束整个判断，不是再扣几分——扣分挡不住「沉默够久」，
  // 而沉默恰恰是睡觉时一定会持续增长的那一项：表上写着 06:00 补觉到 13:30，
  // 角色照旧每十几分钟被问一次要不要联系，睡两小时就爬起来发消息，
  // 还会顺手把日程改成自己醒着（fire 提示词本来就教它改），一晚上只睡两小时。
  //
  // 画像里的 quietHours 兜不住这件事：那是从人设文本猜的固定小时区间（默认 0–8），
  // 跟角色今天真正的作息无关，白天补觉、夜班、跨时区一律漏。
  if (input.sleep && input.sleep.remainingMinutes > NATURAL_SLEEP_WAKE_SOON_MINUTES) {
    const sleptH = (input.sleep.sleptMinutes / 60).toFixed(1);
    const leftH = (input.sleep.remainingMinutes / 60).toFixed(1);
    reasons.push(`日程里正在睡觉（已睡约 ${sleptH} 小时，还剩约 ${leftH} 小时）`);
    return {
      shouldSend: false,
      asleep: true,
      score: 0,
      threshold: clamp(profile.threshold, 0.25, 0.9),
      nextCheckMinutes: naturalSleepDeferMinutes(input.sleep.remainingMinutes, input.random01),
      reasons,
    };
  }
  if (relationshipBoost > 0) reasons.push(profile.relationship === 'romantic' ? '亲密关系加权' : '亲近关系加权');
  if (distanceBoost > 0) reasons.push('异地/手机联系加权');
  if (quiet) { score -= 0.28; reasons.push('安静时段'); }
  if (recentSendMinutes < 30) { score -= 0.42; reasons.push('刚主动联系过'); }
  else if (recentSendMinutes < 90) { score -= 0.22; reasons.push('近期主动联系过'); }
  if (input.unansweredCount > 0) {
    score -= Math.min(
      NATURAL_UNANSWERED_PENALTY_CAP,
      input.unansweredCount * NATURAL_UNANSWERED_PENALTY_PER_MSG,
    );
    reasons.push(`已有 ${input.unansweredCount} 条未获回复`);
  }
  const intensityShift = input.intensity === 'low' ? 0.12 : input.intensity === 'high' ? -0.1 : 0;
  const threshold = clamp(profile.threshold + intensityShift - clamp(input.bias, -20, 20) / 100, 0.25, 0.9);
  const hardCap = naturalUnansweredHardCap(input.intensity);
  const shouldSend = input.unansweredCount < hardCap && score >= threshold;
  // 检查频率是「多久再想一次」，不是「多久一定发一次」；低分时不会调用 LLM。
  return {
    shouldSend,
    score,
    threshold,
    nextCheckMinutes: naturalCheckWindowMinutes(input.intensity, input.random01),
    reasons,
    asleep: false,
  };
};
