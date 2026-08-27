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
 * 解析一份候选心声 JSON（可能是一整行，也可能是从 extractXinsheng 切出来的
 * 跨多行的原始片段——只要以 `{"t":"xinsheng"` 开头即可）。合法就直接 parse；坏了走两级修复。
 *
 * 修复链和糯叽机同源，但多了最后一步「通用键值扫描」：原版的正则兜底只捞
 * innerVoice / statusText 等 9 个内置字段，一旦模型在某个自定义字段里漏了逗号，
 * 论坛美化那 27 个字段会**全部**丢光、卡片整张空白。这里在捞完内置字段之后
 * 再扫一遍剩下的 `"键":"值"` / `"键":数字`，能救多少救多少。
 *
 * 名字仍叫 *Line 是历史遗留（早期版本假设心声必然是单行）——有些预设的提示词会写
 * 「结尾另起一行」之类的措辞，模型偶尔会理解成真按一次回车，而不是转义的 `\n` 两个字符，
 * 于是字符串值内部混进裸换行。这份实现对此完全免疫：所有正则字段捕获组用的都是
 * `[^"\\]`（不是 `.`），裸换行落在这个字符类里，天然被当作普通字符处理；下面「修复 1」
 * 也会先把裸换行/回车转义掉再重新 parse，覆盖大多数「整体仍是合法 JSON、只是换行没转义」
 * 的情形。调用方（extractXinsheng）负责先把完整的花括号配对范围切出来再传进来。
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
    /** 摘掉心声 JSON 之后的正文。 */
    cleaned: string;
    /** 本轮解析出的心声（模型多吐了几个就取最后一个，那是「最新的自己」）。 */
    entry: XinshengEntry | null;
}

/**
 * 从 `s[start]`（必须是 `{`）找到与之配对的 `}`，正确跳过字符串内部的引号/转义/花括号。
 * 找不到配对（JSON 被截断，比如模型没写完就断流了）返回 -1。
 *
 * 这是能正确处理「JSON 字符串值内部混进裸换行」的关键——花括号计数只在**字符串外**
 * 生效，一段 `"innerVoice":"第一行\n第二行"` 无论中间那个换行是真按了回车还是转义的
 * `\n` 两个字符，都不影响配对，因为它整个在引号里面。
 */
const findMatchingBrace = (s: string, start: number): number => {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
};

/**
 * 从一整段 AI 回复里摘出心声 JSON（可能不止一个）。
 *
 * ⚠️ 不能简单按 `\n` 切行再逐行找 —— 有些预设的提示词写着「结尾另起一行写……」这类
 * 措辞，模型会理解成真的按一次回车（裸换行），而不是转义的 `\n` 两个字符。这种情况下
 * 心声 JSON 本身就跨了好几行；按行切割会在裸换行处把 JSON 从中间截断，前半段解析不出
 * 完整对象（丢弃），后半段（`"talk1":"温晚` 这类残片）当成普通聊天正文原样漏了出去——
 * 这是本功能上线后第一个被用户实测到的真实故障。
 *
 * 改成显式定位「花括号配对范围」：先用正则找到 `{"t":"xinsheng"` 出现的位置，再用
 * findMatchingBrace 找到它配对的收尾 `}`，把这一整个范围（不管中间有几个裸换行）当
 * 一份完整候选体切出来，原样交给 parseXinshengLine 解析。协议要求这一定是回复的
 * 最后内容，所以配不到收尾时就吃到字符串末尾（多半是被截断的半截 JSON）。
 *
 * 模型偶尔会重复吐好几个心声对象；循环会全部找到、全部从正文摘除，只保留**最后一个**
 * 解析成功的当作本轮的心声（那是模型"最新的自己"）。
 */
export const extractXinsheng = (content: string): XinshengExtraction => {
    if (!content || typeof content !== 'string') return { cleaned: content || '', entry: null };

    const MARKER_RE = /\{"t"\s*:\s*"xinsheng"/gi;
    const spans: Array<[number, number]> = [];
    let entry: XinshengEntry | null = null;
    let m: RegExpExecArray | null;

    while ((m = MARKER_RE.exec(content)) !== null) {
        const start = m.index;
        const end = findMatchingBrace(content, start);
        const stop = end === -1 ? content.length : end + 1;
        spans.push([start, stop]);
        const parsed = parseXinshengLine(content.slice(start, stop));
        // 解析不出来也不要把这段放回正文 —— 用户宁可少一张卡，也不要看到一坨 JSON
        if (parsed) entry = parsed;
        if (end === -1) break; // 到字符串末尾了，后面不会再有更多内容
        MARKER_RE.lastIndex = stop;
    }

    if (spans.length === 0) return { cleaned: content, entry: null };

    // 按顺序把没被摘掉的部分拼回去，全程只用下标切片，不受中间摘掉内容长度变化影响
    let cleaned = '';
    let cursor = 0;
    for (const [s, e] of spans) {
        cleaned += content.slice(cursor, s);
        cursor = e;
    }
    cleaned += content.slice(cursor);

    return { cleaned: cleaned.trim(), entry };
};
