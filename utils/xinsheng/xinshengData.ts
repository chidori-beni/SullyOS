// 心声数据：AI 回复末尾那一行 `{"t":"xinsheng", ...}` 的摘取、修复与归一。
//
// 协议来自糯叽机：模型在每条回复的**最后**追加一行单行 JSON，前端把它从正文里摘掉
// （绝不能漏进气泡），解析成心声卡片的数据。字段是开放的 —— 内置 5 个，
// 自定义提示词可以定义任意多个（论坛美化动辄 27 个字段），所以除了归一那几个
// 已知字段，其余一律原样带过。

/** 一条心声。已知字段被归一过，其余是自定义提示词定义的任意字段。 */
export interface XinshengEntry {
    innerVoice: string;
    statusText: string;
    temperature: string;
    emotionLevel: number;
    moodDelta: string | null;
    weather: string | null;
    location: string | null;
    activity: string | null;
    raw: string | null;
    /** 用户在历史里点了收藏 —— 收藏过的条目不参与 100 条上限的淘汰。 */
    _favorited?: boolean;
    /** 落库时刻，供历史列表排序与「多久之前」显示。 */
    _at?: number;
    [key: string]: any;
}

/** 归一时会被「认领」的键；其余键原样进 entry。 */
const KNOWN_KEYS = new Set([
    't', 'innerVoice', 'statusText', 'temperature', 'emotionLevel', 'moodDelta',
    'weather', 'location', 'activity', 'raw',
]);

/** 识别「这一行是心声」的硬锚点。提示词里反复强调 JSON 必须以它开头就是为了这个。 */
export const XINSHENG_LINE_RE = /^\s*\{\s*"t"\s*:\s*"xinsheng"/i;

const unescape = (s: string): string =>
    s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');

/**
 * 把解析出来的对象归一成 XinshengEntry。
 *
 * 默认值（`36.5°C` / `70`）和糯叽机一致：布局模板里 `@bar emotionLevel` 这类组件
 * 拿到 undefined 会渲染成空条，给个中性默认比空着好看，也是美化作者们预期的行为。
 */
export const normalizeXinsheng = (obj: Record<string, any>): XinshengEntry => {
    const extras: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (!KNOWN_KEYS.has(k)) extras[k] = v;
    }
    const md = obj.moodDelta;
    return {
        innerVoice: obj.innerVoice || '',
        statusText: obj.statusText || '',
        temperature: obj.temperature || '36.5°C',
        emotionLevel: Math.min(100, Math.max(0, Number(obj.emotionLevel) || 70)),
        // 带符号的字符串（"+8" / "-5" / "0"），卡片直接按首字符判涨跌配色
        moodDelta: md != null ? (Number(md) >= 0 ? `+${Number(md)}` : `${Number(md)}`) : null,
        weather: obj.weather || null,
        location: obj.location || null,
        activity: obj.activity || null,
        raw: obj.raw || null,
        ...extras,
    };
};

/**
 * 解析单行心声 JSON。合法就直接 parse；坏了走两级修复。
 *
 * 修复链和糯叽机同源，但多了最后一步「通用键值扫描」：原版的正则兜底只捞
 * innerVoice / statusText 等 9 个内置字段，一旦模型在某个自定义字段里漏了逗号，
 * 论坛美化那 27 个字段会**全部**丢光、卡片整张空白。这里在捞完内置字段之后
 * 再扫一遍剩下的 `"键":"值"` / `"键":数字`，能救多少救多少。
 */
export const parseXinshengLine = (line: string): XinshengEntry | null => {
    const t = (line || '').trim();
    if (!XINSHENG_LINE_RE.test(t)) return null;

    try {
        return normalizeXinsheng(JSON.parse(t));
    } catch { /* 往下走修复 */ }

    // 修复 1：字符串值里出现了裸换行（模型写多行文案时常犯）
    try {
        return normalizeXinsheng(JSON.parse(t.replace(/\n/g, '\\n').replace(/\r/g, '\\r')));
    } catch { /* 往下走正则兜底 */ }

    // 修复 2：正则逐字段捞。只要 innerVoice 或 statusText 有一个在，就认为这行值得救。
    const pick = (re: RegExp): string | null => {
        const m = t.match(re);
        return m ? unescape(m[1]) : null;
    };
    const innerVoice = pick(/"innerVoice"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const statusText = pick(/"statusText"\s*:\s*"((?:[^"\\]|\\.)*)"/);

    const recovered: Record<string, any> = { t: 'xinsheng' };
    if (innerVoice != null) recovered.innerVoice = innerVoice;
    if (statusText != null) recovered.statusText = statusText;
    const temperature = pick(/"temperature"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (temperature != null) recovered.temperature = temperature;
    const emo = t.match(/"emotionLevel"\s*:\s*(\d+)/);
    recovered.emotionLevel = emo ? Number(emo[1]) : 70;
    const mood = t.match(/"moodDelta"\s*:\s*"?([-+]?\d+)"?/);
    if (mood) recovered.moodDelta = mood[1];
    for (const k of ['location', 'activity', 'weather', 'raw'] as const) {
        const v = pick(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        if (v != null) recovered[k] = v;
    }

    // 通用扫描：把还没认领的简单键值也带上（自定义字段的救命稻草）
    const kvRe = /"([A-Za-z_][A-Za-z0-9_]{0,40})"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?))/g;
    let m: RegExpExecArray | null;
    while ((m = kvRe.exec(t)) !== null) {
        const key = m[1];
        if (key === 't' || key in recovered) continue;
        recovered[key] = m[2] != null ? unescape(m[2]) : Number(m[3]);
    }

    if (innerVoice == null && statusText == null && Object.keys(recovered).length <= 2) {
        console.warn('[xinsheng] JSON 解析失败且无可恢复字段:', t.slice(0, 120));
        return null;
    }
    console.warn('[xinsheng] JSON 损坏，已用正则恢复:', t.slice(0, 80));
    return normalizeXinsheng(recovered);
};

export interface XinshengExtraction {
    /** 摘掉心声行之后的正文。 */
    cleaned: string;
    /** 本轮解析出的心声（模型多吐了几行就取最后一行，那是「最新的自己」）。 */
    entry: XinshengEntry | null;
}

/**
 * 从一整段 AI 回复里摘出心声行。
 *
 * 先做两步换行修复再逐行扫：模型经常把心声 JSON 直接黏在最后一句话屁股后面
 * （`……晚安。{"t":"xinsheng",...}`），或者把两个 JSON 挤在同一行。不先断开的话
 * 整行都不匹配 `^{`，心声既没摘出来又原样漏进气泡 —— 这是最刺眼的掉格式。
 */
export const extractXinsheng = (content: string): XinshengExtraction => {
    if (!content || typeof content !== 'string') return { cleaned: content || '', entry: null };
    if (!/"t"\s*:\s*"xinsheng"/i.test(content)) return { cleaned: content, entry: null };

    const prepared = content
        .replace(/\}\s*,?\s*\{"t":/g, '}\n{"t":')
        .replace(/([^\n{])\s*(\{"t"\s*:\s*"xinsheng")/gi, '$1\n$2');

    const kept: string[] = [];
    let entry: XinshengEntry | null = null;
    for (const line of prepared.split('\n')) {
        if (XINSHENG_LINE_RE.test(line)) {
            const parsed = parseXinshengLine(line);
            // 解析不出来也不要把这行放回正文 —— 用户宁可少一张卡，也不要看到一坨 JSON
            if (parsed) entry = parsed;
            continue;
        }
        kept.push(line);
    }

    return { cleaned: kept.join('\n').trim(), entry };
};
