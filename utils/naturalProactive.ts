import type {
  APIConfig,
  CharacterProfile,
  NaturalProactiveConfig,
  NaturalProactiveIntensity,
  NaturalProactiveProfile,
  NaturalProactiveRelationship,
} from '../types';
import { safeFetchJson } from './safeApi';

export const NATURAL_PROACTIVE_SUBTYPE = 'natural-proactive';
export const NATURAL_PROACTIVE_PROFILE_VERSION = 1 as const;

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
}

export interface NaturalProactiveDecision {
  shouldSend: boolean;
  score: number;
  threshold: number;
  nextCheckMinutes: number;
  reasons: string[];
}

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
  const silence = clamp(hoursSilent / profile.silenceSaturationHours, 0, 1);
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
  if (relationshipBoost > 0) reasons.push(profile.relationship === 'romantic' ? '亲密关系加权' : '亲近关系加权');
  if (distanceBoost > 0) reasons.push('异地/手机联系加权');
  if (quiet) { score -= 0.28; reasons.push('安静时段'); }
  if (recentSendMinutes < 30) { score -= 0.42; reasons.push('刚主动联系过'); }
  else if (recentSendMinutes < 90) { score -= 0.22; reasons.push('近期主动联系过'); }
  if (input.unansweredCount > 0) {
    score -= Math.min(0.45, input.unansweredCount * 0.16);
    reasons.push(`已有 ${input.unansweredCount} 条未获回复`);
  }
  const intensityShift = input.intensity === 'low' ? 0.12 : input.intensity === 'high' ? -0.1 : 0;
  const threshold = clamp(profile.threshold + intensityShift - clamp(input.bias, -20, 20) / 100, 0.25, 0.9);
  const hardCap = input.intensity === 'low' ? 1 : input.intensity === 'high' ? 3 : 2;
  const shouldSend = input.unansweredCount < hardCap && score >= threshold;
  // 检查频率是「多久再想一次」，不是「多久一定发一次」；低分时不会调用 LLM。
  const jitter = Math.floor(input.random01 * 16);
  return { shouldSend, score, threshold, nextCheckMinutes: 15 + jitter, reasons };
};
