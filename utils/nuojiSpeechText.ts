/**
 * 糯叽机的 TTS 文本预处理，逐条照抄。
 *
 * ── 为什么照抄 ──
 * 同一个 `speech-2.8-hd`，糯叽机念出来自然、SullyOS 念出来夸张。反编译 4.3 版
 * （`assets/public/assets/native-pet-Ci9Ot6T9.js`）比对之后，差别根本不在模型，在**送进去的文本**：
 *
 * | | 糯叽机 | SullyOS（改之前） |
 * |-|-|-|
 * | 文本里已有 `<#x#>` 或 `(englishtag)` | **原样送，一个停顿都不加** | 照样再插一遍 |
 * | 文本里没有标记 | 只在 `……` `。！？` `——` 和「逗号+转折连词」处插 | **每个标点都插**：`。`0.22 `！？`0.26 `，`0.10 `、；：`0.07 |
 * | 句末最后一个标点 | 不插（`(?!<#|$)`） | 照插，末尾拖一段空白 |
 * | 教模型写语气词 | **整个包里搜不到 `(sighs)` `(chuckle)` `(breath)`，一次都没有** | 指南里专门教 |
 *
 * 也就是说 SullyOS 是在模型写好的标记**之上再叠一层**机器插的停顿，
 * 「行吧，我知道了。你先睡。」会变成「行吧，<#0.10#>我知道了。<#0.22#>你先睡。<#0.22#>」——
 * 每个逗号句号都卡一下，听起来就是「在演」。糯叽机同一句只会得到
 * 「行吧，我知道了。<#0.3#>你先睡。」（末尾那个不插）。
 *
 * ── 这里做的事 ──
 * 把糯叽机那段算法原样搬过来，包括它那两个「括号/星号必须成对才动手」的保护、
 * 空结果回退原文、以及 1 万字截断。命名和注释是新写的，逻辑逐字对齐。
 */

/** 糯叽机用来判断「文本里已经有人工标记」的正则：`<#0.3#>` 或 `(chuckle)` 这类西文括号标签。 */
const MANUAL_MARKUP_RE = /<#\s*[\d.]+\s*#>|[（(]\s*[a-zA-Z][a-zA-Z\s_-]{1,18}\s*[）)]/;

/** 全角/半角括号是否成对。不成对就不动手——否则会把半个句子吃掉。 */
const hasBalancedParens = (text: string): boolean =>
  (text.match(/[（(]/g) || []).length === (text.match(/[）)]/g) || []).length;

/** 星号是否成对（`*动作*` / `**动作**`）。同样是防吃字的保护。 */
const hasBalancedAsterisks = (text: string): boolean =>
  (text.match(/\*/g) || []).length % 2 === 0;

/**
 * 文本里有没有人工写好的语音标记。
 * 有 → 糯叽机**完全不再加工**（既不删舞台指示，也不插停顿），原样交给 MiniMax。
 */
export const hasManualVoiceMarkup = (text: string): boolean => MANUAL_MARKUP_RE.test(text || '');

/**
 * 糯叽机的稀疏停顿规则。注意三点，都跟 SullyOS 原来的写法不同：
 * - **逗号、顿号、分号、冒号一律不插**（只有「逗号 + 转折连词」这一种例外）
 * - `。！？` 在**整句最末尾时不插**（`(?!<#|$)`），不留尾巴
 * - 已经有 `<#` 紧跟在后面的位置不重复插
 */
export const insertNuojiBreaks = (text: string): string =>
  (text || '')
    .replace(/(\.{3,}|…+)(?!<#)/g, '$1<#0.5#>')
    .replace(/([。！？!?])(?!<#|$)/g, '$1<#0.3#>')
    .replace(/(——|—)(?!<#)/g, '$1<#0.3#>')
    .replace(
      /([，,])(但是|但|不過|不过|然後|然后|可是|只是|所以|因為|因为|而且|況且|况且|何況|何况|不然|否則|否则|畢竟|毕竟)/g,
      '$1<#0.2#>$2',
    );

export interface NuojiSpeechTextOptions {
  /**
   * 把括号/星号里的舞台指示换成一个 `<#0.3#>` 停顿，而不是直接删掉。
   * 对应糯叽机的 `preserveActionMarkers`。默认 false = 直接删。
   */
  preserveActionMarkers?: boolean;
  /**
   * 强制「当作已有人工标记」处理：不删舞台指示、不插停顿，原样送。
   * 对应糯叽机的 `passVoiceTags`。
   */
  passVoiceTags?: boolean;
}

/** 糯叽机的文本长度上限。 */
export const NUOJI_TEXT_LIMIT = 10000;

/**
 * 糯叽机 `Kf()` 里那一整段文本预处理，顺序逐条对齐：
 *
 * 1. 判定有没有人工标记（`passVoiceTags` 或正则命中）
 * 2. 没有标记时才删/换舞台指示（括号、星号，各自要求成对）
 * 3. **不管有没有标记**都压缩连续空白 + trim
 * 4. 处理完变空了就回退原文 trim
 * 5. 没有标记时才插稀疏停顿
 * 6. 截断到 1 万字
 */
export const prepareNuojiSpeechText = (
  text: string,
  options: NuojiSpeechTextOptions = {},
): string => {
  const raw = text || '';
  const keepAsIs = options.passVoiceTags === true || hasManualVoiceMarkup(raw);

  let out = raw;
  if (!keepAsIs) {
    const replacement = options.preserveActionMarkers ? '<#0.3#>' : '';
    if (hasBalancedParens(out)) out = out.replace(/[（(][^）)]*[）)]/g, replacement);
    if (hasBalancedAsterisks(out)) {
      out = out.replace(/\*\*[^*]*\*\*/g, replacement).replace(/\*[^*]+\*/g, replacement);
    }
  }

  out = out.replace(/\s{2,}/g, ' ').trim();
  if (!out) out = raw.trim();

  if (!keepAsIs) out = insertNuojiBreaks(out);

  return out.length > NUOJI_TEXT_LIMIT ? out.slice(0, NUOJI_TEXT_LIMIT) : out;
};
