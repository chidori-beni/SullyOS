// 心声的两段 prompt 注入。
//
// 1. 生成指令（stable 段）：告诉模型每条回复末尾追加那一行 JSON。内容基本不变，
//    所以放稳定段，不打断 prompt 前缀缓存。
// 2. [INNER-CONTINUITY]（volatileState 段）：把最近几轮的心声字段回灌给模型，
//    让「内心戏」有连续性。每轮都变，进稳定段会让缓存整段失效。
//
// 两段的英文措辞都照抄糯叽机 —— 论坛美化的自定义提示词是围绕这套措辞写的
//（尤其「JSON 必须以 {"t":"xinsheng" 开头」这条硬约束），换了说法模型的服从度会掉。

import type { XinshengEntry } from './xinshengData';

/** 最多回灌几轮心声。多了既占 token，也会让模型把旧情绪当成此刻的情绪。 */
export const XINSHENG_CONTINUITY_ROUNDS = 3;
/** 单个字段回灌时的截断长度。 */
const FIELD_CAP = 80;

/**
 * 内置心声指令。`language` 决定模型用哪种语言写 innerVoice / statusText。
 *
 * 这段话为什么这么写（都是糯叽机踩出来的）：
 *   · 「PLAIN TEXT ONLY (no XML/HTML tags)」—— 不加这句，模型会在 innerVoice 里塞
 *     <thinking> 之类的标签，卡片上就是一坨尖括号
 *   · statusText 明确禁止「看手机/盯屏幕」这类通用动作 —— 不禁的话十轮有八轮是它
 *   · temperature 给了体温的语义锚（36=平静，兴奋升高），否则模型会当成天气温度
 */
export const buildDefaultXinshengInstruction = (language = 'Chinese'): string => {
    const statusHint = language === 'Chinese'
        ? 'e.g. 悄悄瞟向你手里的零食 / 飘忽不定不敢对视 / 紧张地抿着嘴唇'
        : `e.g. use ${language} naturally`;
    return `\n\n---\nAt the very END of every reply (after all dialogue), append this as the LAST JSON line. Never reference it in dialogue:\n{"t":"xinsheng","innerVoice":"thought character would NEVER say out loud — raw, unguarded, possibly contradicting words, 15-40 ${language} chars","statusText":"(gaze direction OR subconscious body action, 3rd person ≤20 chars, vivid — ${statusHint})","temperature":"36.5°C","emotionLevel":75,"moodDelta":"+3"}\nField rules — innerVoice: PLAIN TEXT ONLY (no XML/HTML tags), secret true feeling in ${language}, vivid and honest, distinct from what they said (15-40 chars); statusText: PLAIN TEXT ONLY (no XML/HTML tags), in ${language}, WHERE character's eyes land OR involuntary physical tic unique to their personality; NOT generic phone/screen action; temperature: emotional body temp 36°C=calm, rises with excitement/embarrassment, falls with sadness; emotionLevel: 0–100 positive emotion integer; moodDelta: signed integer ("+8", "-5", "0").`;
};

/**
 * 自定义指令的外壳。用户写的正文原样贴在后面，我们只补两件它必须知道的事：
 * 位置（最后一行）和锚点（必须以 {"t":"xinsheng" 开头）。
 * 论坛美化的提示词里通常不会重复这两条，因为原版就是这么包的。
 */
export const buildCustomXinshengInstruction = (customPrompt: string): string =>
    `\n\n---\nAt the very END of every reply (after all dialogue), append exactly ONE single-line JSON object as the LAST line. It MUST start with {"t":"xinsheng" so the parser can locate it. Never reference this JSON in dialogue. Schema and fields follow the custom guidance below:\n${customPrompt.trim()}`;

/** 按开关和自定义提示词，给出这一轮要注入的心声指令（空串 = 不注入）。 */
export const buildXinshengInstruction = (opts: {
    enabled: boolean;
    customPrompt?: string;
    language?: string;
}): string => {
    if (!opts.enabled) return '';
    const custom = (opts.customPrompt || '').trim();
    return custom
        ? buildCustomXinshengInstruction(custom)
        : buildDefaultXinshengInstruction(opts.language || 'Chinese');
};

/** 回灌用的一轮心声：只留用户勾选的那几个字段 + 距今多久。 */
export interface XinshengContinuityRound {
    fields: Record<string, any>;
    ageMin: number;
}

const formatAge = (ageMin: number): string => {
    if (ageMin < 1) return 'just now';
    if (ageMin < 60) return `${ageMin}min ago`;
    if (ageMin < 1440) return `${Math.round(ageMin / 60)}h ago`;
    return `${Math.round(ageMin / 1440)}d ago`;
};

/**
 * 从历史里挑出最近几轮、只保留 `aiVisibleFields` 列出的字段。
 *
 * `aiVisibleFields` 留空 = 一个字段都不给 = 模型完全看不到自己上一轮的心声。
 * 这是有意的默认之一：有人就是要角色的内心戏每轮独立、不被上一轮带跑。
 */
export const selectXinshengContinuity = (
    history: Record<string, XinshengEntry> | null | undefined,
    aiVisibleFields: string,
    now = Date.now(),
): XinshengContinuityRound[] => {
    const fields = (aiVisibleFields || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    if (fields.length === 0 || !history) return [];

    const rounds = Object.entries(history)
        .filter(([, e]) => !!e)
        // roundId 带时间前缀，字典序倒排 = 从新到旧
        .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
        .slice(0, XINSHENG_CONTINUITY_ROUNDS);

    const out: XinshengContinuityRound[] = [];
    for (const [, entry] of rounds) {
        const picked: Record<string, any> = {};
        for (const f of fields) {
            const v = (entry as any)[f];
            if (v == null || v === '') continue;
            picked[f] = typeof v === 'string' ? v.slice(0, FIELD_CAP) : v;
        }
        if (Object.keys(picked).length === 0) continue;
        const at = typeof entry._at === 'number' ? entry._at : now;
        out.push({ fields: picked, ageMin: Math.max(0, Math.round((now - at) / 60000)) });
    }
    return out;
};

/** 渲染 [INNER-CONTINUITY] 段。没有可回灌的内容就返回空串。 */
export const buildXinshengContinuityBlock = (rounds: XinshengContinuityRound[]): string => {
    if (!Array.isArray(rounds) || rounds.length === 0) return '';
    const lines: string[] = [];
    for (const r of rounds) {
        const body = Object.entries(r.fields)
            .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"').slice(0, FIELD_CAP)}"`)
            .join(', ');
        if (!body) continue;
        lines.push(`· (${formatAge(r.ageMin)}) ${body}`);
    }
    if (lines.length === 0) return '';
    return `\n[INNER-CONTINUITY] Your private interior over recent turns (the inside-the-head layer, parallel to but distinct from spoken words):\n${lines.join('\n')}\nHow to use this:\n· Treat as continuity anchor — let current emotion/posture FLOW from here so the character feels coherent across turns.\n· Layer it underneath your reply: dialogue and visible actions can match it, contrast it, or selectively reveal it — whichever fits the moment.\n· Time matters: very recent (<1h) still load-bearing; older states can fade or shift naturally if new events warrant.\n· When user introduces something emotionally significant, an authentic shift in interior is welcome — continuity ≠ stasis.\n`;
};
