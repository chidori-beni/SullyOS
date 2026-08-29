/**
 * Live2D 动作显示名。
 *
 * 手游导出的 motion 组名基本是拼音（`X_huaixiao3_idle`），下拉里一眼看不出是什么。
 * 更麻烦的是有些素材包被人手工补过中文后缀，而且补错了——例如同一个角色的私服包里
 * 坏笑 / 调笑 / 调侃 / 温柔 / 望天思考笑 一共 13 条全被标成了「微笑」。
 *
 * 这里的规则：**拼音词干是唯一可信来源**。
 * - 认得出拼音 → 用拼音对应的中文，并保留名字里那些非情绪的中文修饰（摇头 / 凑近 / 点头…）。
 * - 认不出拼音（例如纯编号的 `X_11022_02_微笑`）→ 原样保留已有中文，不瞎改。
 */

/** 拼音词干 → 中文。匹配时按长度从长到短，避免 xiao 抢走 huaixiao。 */
const PINYIN_LABELS: Record<string, string> = {
  wangtiansikaoxiao: '望天思考笑',
  wangtiansikao: '望天思考',
  fzzhoumeixianqi: '皱眉嫌弃',
  zhoumeixianqi: '皱眉嫌弃',
  weixiaobiyan: '微笑闭眼',
  huaixiao: '坏笑',
  tiaoxiao: '调笑',
  tiaokan: '调侃',
  weixiao: '微笑',
  beishang: '悲伤',
  aishang: '哀伤',
  chijing: '吃惊',
  haixiu: '害羞',
  zhoumei: '皱眉',
  wenrou: '温柔',
  diantou: '点头',
  yaotou: '摇头',
  fennu: '愤怒',
  sikao: '思考',
  biyan: '闭眼',
  jingya: '惊讶',
  danding: '淡定',
  xiao: '笑',
};

/** 名字里出现这些中文时，视为「情绪结论」——它可能被标错，交给拼音说了算。 */
const EMOTION_WORDS = new Set([
  '微笑', '坏笑', '调笑', '调侃', '温柔', '笑', '大笑', '望天思考笑',
  '害羞', '吃惊', '惊讶', '愤怒', '生气', '气恼', '皱眉', '嫌弃', '皱眉嫌弃',
  '困惑', '思考', '悲伤', '哀伤', '难过', '平静', '淡定', '闭眼',
]);

/** 场景 / 编号前缀，对用户没有意义。 */
const NOISE_SEGMENTS = /^(x|fanshu\d*|copy|idle|move|\d+)$/i;

const PINYIN_STEMS = Object.keys(PINYIN_LABELS).sort((a, b) => b.length - a.length);

interface ParsedLive2DActionName {
  /** 拼音识别出的情绪，识别不出为空。 */
  emotion: string;
  /** 名字里保留下来的中文修饰（摇头 / 凑近…）。 */
  qualifiers: string[];
  /** 原名里已有的中文情绪词，仅在拼音认不出时兜底。 */
  declaredEmotions: string[];
  /** 是否是可循环的待机版。 */
  idle: boolean;
  /** 待机里还带位移（`_move`）。 */
  moving: boolean;
  /** 同一情绪的第几个变体（huaixiao3 → 3）；1 表示没有编号。 */
  variant: number;
}

export const parseLive2DActionName = (rawName: string): ParsedLive2DActionName => {
  const name = (rawName || '').trim();
  const segments = name.split(/[_\s]+/).filter(Boolean);
  let emotion = '';
  let variant = 1;
  const qualifiers: string[] = [];
  const declaredEmotions: string[] = [];
  // `_idle` 可以出现在任何位置（X_11024_06_idle_温柔），整串统一判断。
  const idle = /(^|[_\s])idle([_\s]|$)/i.test(name);
  const moving = /(^|[_\s])move([_\s]|$)/i.test(name);

  for (const segment of segments) {
    if (/[一-龥]/.test(segment)) {
      // 中文段：情绪词存疑，修饰词（摇头/凑近）照收。
      if (EMOTION_WORDS.has(segment)) declaredEmotions.push(segment);
      else if (!qualifiers.includes(segment)) qualifiers.push(segment);
      continue;
    }
    if (NOISE_SEGMENTS.test(segment)) continue;
    const lower = segment.toLowerCase();
    const stem = PINYIN_STEMS.find(candidate => lower.startsWith(candidate));
    if (!stem) continue;
    if (!emotion) {
      emotion = PINYIN_LABELS[stem];
      const trailing = lower.slice(stem.length).match(/^(\d+)/);
      if (trailing) variant = Number(trailing[1]);
    } else {
      // 第二个拼音词干当修饰用（weixiaobiyan 之外的组合名）。
      const extra = PINYIN_LABELS[stem];
      if (extra && extra !== emotion && !qualifiers.includes(extra)) qualifiers.push(extra);
    }
  }
  return { emotion, qualifiers, declaredEmotions, idle, moving, variant };
};

/**
 * 下拉里显示的名字。认不出就原样返回，绝不吞掉信息。
 * 例：`X_huaixiao3_idle_微笑` → `坏笑 3（持续）`
 *     `X_11024_16_凑近_调笑`   → `调笑 · 凑近`（编号段没有拼音，中文照用）
 */
export const live2dActionDisplayName = (rawName: string): string => {
  const parsed = parseLive2DActionName(rawName);
  const emotion = parsed.emotion || parsed.declaredEmotions[0] || '';
  if (!emotion) return rawName;
  const variant = parsed.variant > 1 ? ` ${parsed.variant}` : '';
  const suffix = parsed.idle ? (parsed.moving ? '（持续·移动）' : '（持续）') : '';
  // 拼音说了算时，名字里多余的中文情绪词就是那些标错的后缀，丢掉；
  // 认不出拼音时它们是仅有的线索，除主词外一并留作修饰。
  const spareEmotions = parsed.emotion ? [] : parsed.declaredEmotions.slice(1);
  const extras = [...parsed.qualifiers, ...spareEmotions];
  return `${emotion}${variant}${suffix}${extras.length ? ` · ${extras.join(' ')}` : ''}`;
};

/** 显示名和原名不同时，值得把原名并排显示出来方便和素材对照。 */
export const live2dActionRenamed = (rawName: string): boolean => (
  live2dActionDisplayName(rawName) !== rawName
);

// ───────────────────────────────────────────────────────────────
// 跨衣橱匹配
//
// 动作 ID 是 `motion-N` 位置序号，两套衣服的 motion 数量和顺序都不同，
// 同一个 ID 换套衣服会静默指向另一个动作。但同一角色的不同衣服，动作
// 命名高度重合（坏笑 / 调笑 / 温柔…），所以用「语义键」而不是 ID 去对。
//
// 这样换衣服时：对得上的自动沿用，对不上的报出来让用户手改——
// 不需要重跑动作导演，也不需要重新生成语音。
// ───────────────────────────────────────────────────────────────

/** 语义键：情绪 + 变体号 + 是否待机。认不出拼音时退回原名，至少同名能对上。 */
export const live2dActionMatchKey = (rawName: string): string => {
  const parsed = parseLive2DActionName(rawName);
  const emotion = parsed.emotion || parsed.declaredEmotions[0];
  if (!emotion) return `raw:${(rawName || '').trim()}`;
  return `${emotion}#${parsed.variant}${parsed.idle ? '#idle' : ''}`;
};

/** 只到情绪那一层，用于变体/待机对不上时的近似匹配。 */
export const live2dActionEmotionKey = (rawName: string): string => {
  const parsed = parseLive2DActionName(rawName);
  const emotion = parsed.emotion || parsed.declaredEmotions[0];
  return emotion ? `emotion:${emotion}` : `raw:${(rawName || '').trim()}`;
};

export interface Live2DActionCandidate {
  id: string;
  /** 素材里的原始组名。 */
  rawName: string;
}

export type Live2DActionMatchTier = 'exact' | 'similar' | 'none';

export interface Live2DActionMatch {
  /** 当前这套模型里应该用哪个 ID；对不上时为空。 */
  id: string;
  tier: Live2DActionMatchTier;
  /** 命中的那条动作的原名，用于界面展示。 */
  rawName: string;
}

/**
 * 拿保存下来的语义键，在当前这套模型的动作里找对应的一条。
 * - `exact`：情绪、变体号、待机与否全都一致，直接用。
 * - `similar`：情绪一致但变体号或待机与否不同——仍然自动用，但界面要标出来。
 * - `none`：这套衣服里没有这个情绪的动作，必须手动重选。
 */
export const resolveLive2DActionByKey = (
  key: string | undefined,
  candidates: readonly Live2DActionCandidate[],
): Live2DActionMatch => {
  if (!key) return { id: '', tier: 'none', rawName: '' };
  const exact = candidates.find(item => live2dActionMatchKey(item.rawName) === key);
  if (exact) return { id: exact.id, tier: 'exact', rawName: exact.rawName };
  // 语义键的前半段就是情绪，据此放宽到情绪级。
  const emotion = key.startsWith('raw:') ? '' : key.split('#')[0];
  if (emotion) {
    const similar = candidates.find(item => live2dActionEmotionKey(item.rawName) === `emotion:${emotion}`);
    if (similar) return { id: similar.id, tier: 'similar', rawName: similar.rawName };
  }
  return { id: '', tier: 'none', rawName: '' };
};
