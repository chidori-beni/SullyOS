import type {
  APIConfig,
  CharacterProfile,
  CompanionStartupSettings,
  CompanionStartupPeriod,
  UserProfile,
} from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { ChatPrompts } from './chatPrompts';
import { extractContent, safeFetchJson } from './safeApi';
import {
  normalizeCompanionDialogue,
  parseAvatarTouchReply,
  type AvatarTouchModelAction,
} from './avatarTouch';
import type { AvatarPerformanceDirection, AvatarPerformancePrecision } from './avatarPerformance';
import { getScheduleWallClock } from './scheduleTime';

export interface CompanionStartupDraft {
  line: string;
  performance: AvatarPerformanceDirection;
}

export const COMPANION_STARTUP_PERIODS: Array<{ value: CompanionStartupPeriod; label: string; hours: string }> = [
  { value: 'morning', label: '早上', hours: '05:00–10:59' },
  { value: 'noon', label: '中午', hours: '11:00–12:59' },
  { value: 'afternoon', label: '下午', hours: '13:00–16:59' },
  { value: 'dusk', label: '傍晚', hours: '17:00–18:59' },
  { value: 'evening', label: '晚上', hours: '19:00–23:59' },
  { value: 'late-night', label: '深夜 / 凌晨', hours: '00:00–04:59' },
];

export const companionStartupPeriodForHour = (hour: number): CompanionStartupPeriod => {
  if (hour < 5) return 'late-night';
  if (hour < 11) return 'morning';
  if (hour < 13) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'dusk';
  return 'evening';
};

export const companionStartupPeriodLabel = (period?: CompanionStartupPeriod): string => (
  COMPANION_STARTUP_PERIODS.find(item => item.value === period)?.label || '不限时段'
);

export const resolveCompanionStartupForTime = (
  character: CharacterProfile,
  at = new Date(),
): CompanionStartupSettings | undefined => {
  const settings = character.companionTouchSettings;
  const hour = getScheduleWallClock(character, at).getHours();
  const period = companionStartupPeriodForHour(hour);
  if (settings?.startup?.timePeriod === period && !settings.activeStartupPresetId) return settings.startup;
  const matches = (settings?.startupPresets || []).filter(item => item.startup.timePeriod === period);
  if (!matches.length) return settings?.startup;
  // Stable within a character-local calendar day, while allowing several satisfying variants per period.
  const wallClock = getScheduleWallClock(character, at);
  const daySeed = wallClock.getFullYear() * 372 + (wallClock.getMonth() + 1) * 31 + wallClock.getDate();
  return matches[Math.abs(daySeed) % matches.length].startup;
};

export const DEFAULT_COMPANION_STARTUP_PERFORMANCE: AvatarPerformanceDirection = {
  emotion: 'calm',
  gesture: 'talk',
  camera: 'medium',
  gaze: 'viewer',
  intensity: 0.66,
  precision: {
    lockAutonomy: true,
    lockHead: true,
    headX: 0,
    headY: 0,
    headZ: 0,
    eyeX: 0,
    eyeY: 0,
    bodyX: 0.02,
    bodyY: 0,
    bodyZ: -0.02,
    overshoot: 0.08,
    settleMs: 920,
  },
};

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

export const normalizeCompanionStartupPerformance = (
  direction?: Partial<AvatarPerformanceDirection> | CompanionStartupSettings['performance'],
  rawPrecision?: Partial<AvatarPerformancePrecision>,
): AvatarPerformanceDirection => {
  const defaults = DEFAULT_COMPANION_STARTUP_PERFORMANCE;
  const sourcePrecision = rawPrecision || direction?.precision || {};
  const defaultPrecision = defaults.precision!;
  return {
    ...defaults,
    ...(direction || {}),
    gaze: 'viewer',
    intensity: clamp(direction?.intensity, defaults.intensity, 0.2, 1),
    faces: direction?.faces?.slice(0, 4),
    modelActions: direction?.modelActions?.slice(0, 2),
    precision: {
      lockAutonomy: true,
      lockHead: true,
      // Startup speech is a hard centered-head phase. Saved legacy angles and
      // shake/tilt gestures must never reintroduce movement before the line ends.
      headX: 0,
      headY: 0,
      headZ: 0,
      eyeX: clamp(sourcePrecision.eyeX, 0, -1, 1),
      eyeY: clamp(sourcePrecision.eyeY, 0, -1, 1),
      bodyX: clamp(sourcePrecision.bodyX, defaultPrecision.bodyX || 0, -1, 1),
      bodyY: clamp(sourcePrecision.bodyY, defaultPrecision.bodyY || 0, -1, 1),
      bodyZ: clamp(sourcePrecision.bodyZ, defaultPrecision.bodyZ || 0, -1, 1),
      overshoot: clamp(sourcePrecision.overshoot, defaultPrecision.overshoot || 0.08, 0, 0.2),
      settleMs: clamp(sourcePrecision.settleMs, defaultPrecision.settleMs || 920, 320, 2400),
    },
  };
};

const balancedJsonCandidates = (content: string): string[] => {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
};

const unwrapRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['startup', 'result', 'data']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as Record<string, unknown>;
  }
  return record;
};

const directiveFromPerformance = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const read = (...keys: string[]) => keys.map(key => record[key]).find(item => item !== undefined && item !== null && item !== '');
  const fields: string[] = [];
  const append = (key: string, field: unknown) => {
    if (field === undefined || field === null || field === '') return;
    fields.push(`${key}=${Array.isArray(field) ? field.join(',') : String(field)}`);
  };
  append('emotion', read('emotion'));
  append('gesture', read('gesture'));
  append('camera', read('camera'));
  append('gaze', read('gaze'));
  append('intensity', read('intensity'));
  append('face', read('faces', 'face'));
  append('model_action', read('modelAction', 'model_action'));
  return fields.length ? `[[AVATAR: ${fields.join('; ')}]]` : '';
};

const parseStructuredStartup = (
  value: unknown,
  modelActions: AvatarTouchModelAction[],
): CompanionStartupDraft | null => {
  const record = unwrapRecord(value);
  if (!record) return null;
  const rawLine = ['line', 'text', 'dialogue', 'reply', 'content']
    .map(key => record[key])
    .find(item => typeof item === 'string');
  const line = normalizeCompanionDialogue(typeof rawLine === 'string' ? rawLine : '');
  if (!line) return null;
  const rawPerformance = record.performance || record.avatar || record.direction || {};
  const parsed = parseAvatarTouchReply({
    content: `${directiveFromPerformance(rawPerformance)}\n${line}`,
  }, modelActions);
  if (!parsed) return null;
  const rawPrecision = (
    rawPerformance && typeof rawPerformance === 'object'
      ? (rawPerformance as Record<string, unknown>).precision
      : undefined
  ) || record.precision;
  return {
    line: normalizeCompanionDialogue(parsed.text),
    performance: normalizeCompanionStartupPerformance(
      parsed.performance,
      rawPrecision && typeof rawPrecision === 'object' ? rawPrecision as Partial<AvatarPerformancePrecision> : undefined,
    ),
  };
};

export const parseCompanionStartupResponse = (
  raw: unknown,
  modelActions: AvatarTouchModelAction[] = [],
): CompanionStartupDraft | null => {
  const content = typeof raw === 'string' ? raw : extractContent(raw as any);
  const fenced = [...content.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)].map(match => match[1]);
  const candidates = [content.trim(), ...fenced, ...balancedJsonCandidates(content)]
    .filter(Boolean)
    .flatMap(candidate => [candidate, candidate.replace(/,\s*([}])/g, '$1')]);
  for (const candidate of candidates) {
    try {
      const parsed = parseStructuredStartup(JSON.parse(candidate), modelActions);
      if (parsed) return parsed;
    } catch {
      // Continue into the plain assistant-message fallback below.
    }
  }
  const message = (raw as any)?.choices?.[0]?.message || { content };
  const fallback = parseAvatarTouchReply(message, modelActions);
  if (!fallback) return null;
  const line = normalizeCompanionDialogue(fallback.text);
  return line ? { line, performance: normalizeCompanionStartupPerformance(fallback.performance) } : null;
};

export const buildCompanionStartupPrompt = (
  coreContext: string,
  characterName: string,
  userName: string,
  modelActions: AvatarTouchModelAction[] = [],
  hint = '',
): string => {
  const actionList = modelActions.length
    ? modelActions.slice(0, 60).map(action => `- ${action.id}: ${action.name}`).join('\n')
    : '（当前没有模型专属动作）';
  return `${coreContext}

### 陪伴桌面 · 开机自启演出
${userName}正在为${characterName}设置“每次回到陪伴主界面时”的短开场。它像二次元手游首页的角色入场，但必须完全属于${characterName}本人。
${hint.trim() ? `用户给的写作提示：${hint.trim()}` : '用户没有限定台词，请从完整人设、关系、近期对话和记忆出发自行决定如何开口。'}

要求：
- 只写角色真正会说的一至两句短台词；不要套用通用欢迎、早安、主人、系统上线或自我介绍模板。
- 不要替桌面主题说话，不要解释模型、API、动作参数或提示词。
- 眼睛默认看镜头。为头部 X/Y/Z、眼睛 X/Y、身体 X/Y/Z 给出克制的细微目标；动作先略微超过目标，再轻轻回正。
- 可选择一个主 gesture、最多四个微表情，以及最多一个白名单模型专属动作；禁止编造动作 ID。
- 只输出一个合法 JSON 对象，不要代码围栏或额外说明。

模型专属动作白名单：
${actionList}

严格结构：
{
  "line": "角色台词",
  "performance": {
    "emotion": "calm",
    "gesture": "tilt",
    "camera": "medium",
    "gaze": "viewer",
    "intensity": 0.66,
    "faces": ["smile-eyes"],
    "modelAction": "可选的白名单ID",
    "precision": {
      "headX": 0.06,
      "headY": 0.04,
      "headZ": -0.14,
      "eyeX": 0,
      "eyeY": 0,
      "bodyX": 0.02,
      "bodyY": 0,
      "bodyZ": -0.02,
      "overshoot": 0.08,
      "settleMs": 920
    }
  }
}`;
};

/** 一次请求覆盖全天六个时段，避免为同一套人设重复付六次 API。 */
export type CompanionStartupAllDayDrafts = Partial<Record<CompanionStartupPeriod, CompanionStartupDraft>>;

export const parseCompanionStartupAllDayResponse = (
  raw: unknown,
  modelActions: AvatarTouchModelAction[] = [],
): CompanionStartupAllDayDrafts => {
  const content = typeof raw === 'string' ? raw : extractContent(raw as any);
  const fenced = [...content.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)].map(match => match[1]);
  const candidates = [content.trim(), ...fenced, ...balancedJsonCandidates(content)]
    .filter(Boolean)
    .flatMap(candidate => [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]);
  const validPeriods = new Set(COMPANION_STARTUP_PERIODS.map(item => item.value));
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    // 两种形状都接受：{"morning": {...}} 或 {"periods": [{"period": "morning", ...}]}。
    // 模型在长输出里经常改用数组，为此重试整轮请求不值得。
    const entries: Array<[string, unknown]> = [];
    const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
    if (!root) continue;
    const list = Array.isArray(root) ? root : Array.isArray(root.periods) ? root.periods : undefined;
    if (list) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const period = record.period || record.timePeriod || record.time_period;
        if (typeof period === 'string') entries.push([period, record]);
      }
    } else {
      for (const [key, value] of Object.entries(root)) entries.push([key, value]);
    }
    const drafts: CompanionStartupAllDayDrafts = {};
    for (const [key, value] of entries) {
      const period = key.trim().toLowerCase().replace(/_/g, '-') as CompanionStartupPeriod;
      if (!validPeriods.has(period) || drafts[period]) continue;
      const draft = parseStructuredStartup(value, modelActions);
      if (draft) drafts[period] = draft;
    }
    if (Object.keys(drafts).length) return drafts;
  }
  return {};
};

export const buildCompanionStartupAllDayPrompt = (
  coreContext: string,
  characterName: string,
  userName: string,
  modelActions: AvatarTouchModelAction[] = [],
  hint = '',
): string => {
  const actionList = modelActions.length
    ? modelActions.slice(0, 60).map(action => `- ${action.id}: ${action.name}`).join('\n')
    : '（当前没有模型专属动作）';
  const periodList = COMPANION_STARTUP_PERIODS
    .map(period => `- "${period.value}"：${period.label}（${period.hours}）`)
    .join('\n');
  return `${coreContext}

### 陪伴桌面 · 全天开机自启演出
${userName}正在为${characterName}设置“每次回到陪伴主界面时”的短开场。它像二次元手游首页的角色入场，但必须完全属于${characterName}本人。
这一次请**一次性写出全天六个时段各一套**，不要只写一个时段。
${hint.trim() ? `用户给的写作提示：${hint.trim()}` : '用户没有限定台词，请从完整人设、关系、近期对话和记忆出发自行决定如何开口。'}

时段（键名必须严格用引号里的英文值）：
${periodList}

要求：
- 每个时段只写角色真正会说的一至两句短台词；六句之间必须彼此不同，能读出时间感（刚醒 / 饭点 / 午后 / 天快黑 / 夜里 / 该睡了）。
- 不要套用通用欢迎、早安、主人、系统上线或自我介绍模板，也不要在台词里报时间点。
- 不要替桌面主题说话，不要解释模型、API、动作参数或提示词。
- 每个时段各自给一套 performance：眼睛默认看镜头；为头部 X/Y/Z、眼睛 X/Y、身体 X/Y/Z 给出克制的细微目标；动作先略微超过目标，再轻轻回正。
- 每个时段可选择一个主 gesture、最多四个微表情，以及最多一个白名单模型专属动作；禁止编造动作 ID。不同时段应当挑不同的动作，别六个时段全用同一个。
- 只输出一个合法 JSON 对象，不要代码围栏或额外说明。

模型专属动作白名单：
${actionList}

严格结构（六个键都要出现）：
{
  "morning":     { "line": "角色台词", "performance": { "emotion": "calm", "gesture": "tilt", "camera": "medium", "gaze": "viewer", "intensity": 0.66, "faces": ["smile-eyes"], "modelAction": "可选的白名单ID", "precision": { "headX": 0.06, "headY": 0.04, "headZ": -0.14, "eyeX": 0, "eyeY": 0, "bodyX": 0.02, "bodyY": 0, "bodyZ": -0.02, "overshoot": 0.08, "settleMs": 920 } } },
  "noon":        { "line": "…", "performance": { … } },
  "afternoon":   { "line": "…", "performance": { … } },
  "dusk":        { "line": "…", "performance": { … } },
  "evening":     { "line": "…", "performance": { … } },
  "late-night":  { "line": "…", "performance": { … } }
}`;
};

export const requestCompanionStartupAllDayDrafts = async (options: {
  character: CharacterProfile;
  user: UserProfile;
  apiConfig: APIConfig;
  modelActions?: AvatarTouchModelAction[];
  hint?: string;
  recentMessageLimit?: number;
}): Promise<CompanionStartupAllDayDrafts> => {
  const {
    character,
    user,
    apiConfig,
    modelActions = [],
    hint = '',
    recentMessageLimit = 28,
  } = options;
  const baseUrl = apiConfig.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('请先在设置中配置主聊天 API');

  const [allMessages, emojis] = await Promise.all([
    DB.getMessagesByCharId(character.id, true),
    DB.getEmojis().catch(() => []),
  ]);
  const recentMessages = allMessages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-Math.max(8, Math.min(60, recentMessageLimit)));
  const eventText = `[陪伴桌面开机演出设置] ${user.name || '用户'}希望你一次写好全天六个时段各一句、符合本人性格的短开场。`;
  const coreContext = ContextBuilder.buildCoreContext(
    character,
    user,
    true,
    undefined,
    undefined,
    {
      lastInteractionTs: recentMessages[recentMessages.length - 1]?.timestamp,
      worldbookMessages: [
        ...recentMessages.map(message => ({ role: message.role, content: message.content })),
        { role: 'user', content: eventText },
      ],
    },
  );
  const { apiMessages } = ChatPrompts.buildMessageHistory(
    recentMessages,
    recentMessages.length,
    character,
    user,
    emojis,
  );
  const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}`,
    },
    body: JSON.stringify({
      model: apiConfig.model,
      messages: [
        { role: 'system', content: buildCompanionStartupAllDayPrompt(coreContext, character.name, user.name || '用户', modelActions, hint) },
        ...apiMessages,
        { role: 'user', content: eventText },
      ],
      temperature: 0.86,
      // 六段台词加六套 performance，单段的 1400 会被截断成半个 JSON。
      max_tokens: 6_000,
      stream: false,
    }),
  }, 1, 120_000, {
    appName: '触感陪伴',
    charId: character.id,
    charName: character.name,
    purpose: '一次生成全天开机自启台词与演出',
  });
  const drafts = parseCompanionStartupAllDayResponse(data, modelActions);
  if (!Object.keys(drafts).length) throw new Error('主模型没有返回可用的全天开机台词；可以改短提示后再试一次');
  return drafts;
};

export const requestCompanionStartupDraft = async (options: {
  character: CharacterProfile;
  user: UserProfile;
  apiConfig: APIConfig;
  modelActions?: AvatarTouchModelAction[];
  hint?: string;
  timePeriod?: CompanionStartupPeriod;
  recentMessageLimit?: number;
}): Promise<CompanionStartupDraft> => {
  const {
    character,
    user,
    apiConfig,
    modelActions = [],
    hint = '',
    timePeriod,
    recentMessageLimit = 28,
  } = options;
  const baseUrl = apiConfig.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('请先在设置中配置主聊天 API');

  const [allMessages, emojis] = await Promise.all([
    DB.getMessagesByCharId(character.id, true),
    DB.getEmojis().catch(() => []),
  ]);
  const recentMessages = allMessages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-Math.max(8, Math.min(60, recentMessageLimit)));
  const periodText = companionStartupPeriodLabel(timePeriod);
  const eventText = `[陪伴桌面开机演出设置] ${user.name || '用户'}希望你为${periodText}回到陪伴主界面准备一句符合本人性格的短开场。`;
  const coreContext = ContextBuilder.buildCoreContext(
    character,
    user,
    true,
    undefined,
    undefined,
    {
      lastInteractionTs: recentMessages[recentMessages.length - 1]?.timestamp,
      worldbookMessages: [
        ...recentMessages.map(message => ({ role: message.role, content: message.content })),
        { role: 'user', content: eventText },
      ],
    },
  );
  const { apiMessages } = ChatPrompts.buildMessageHistory(
    recentMessages,
    recentMessages.length,
    character,
    user,
    emojis,
  );
  const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}`,
    },
    body: JSON.stringify({
      model: apiConfig.model,
      messages: [
        { role: 'system', content: buildCompanionStartupPrompt(coreContext, character.name, user.name || '用户', modelActions, `${periodText}时段。${hint}`) },
        ...apiMessages,
        { role: 'user', content: eventText },
      ],
      temperature: 0.86,
      max_tokens: 1400,
      stream: false,
    }),
  }, 1, 60_000, {
    appName: '触感陪伴',
    charId: character.id,
    charName: character.name,
    purpose: '生成开机自启台词与演出',
  });
  const parsed = parseCompanionStartupResponse(data, modelActions);
  if (!parsed) throw new Error('主模型没有返回可用的开机台词；可以改短提示后再试一次');
  return parsed;
};
