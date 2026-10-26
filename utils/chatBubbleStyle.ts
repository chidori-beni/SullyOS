/**
 * 「短气泡」—— 让角色像平时网上聊天那样：大部分时候一句一个气泡，偶尔才发一长段。
 *
 * ## 为什么要单独一条、而且放在 recencyTail
 *
 * 气泡是按**换行**切的（`chatParser.chunkText` / `sanitize.ts` 的 `chunkText`），
 * 行内空格属于正文、不拆泡 —— 这是刻意的（中日混排的一句话不能被拦腰拆开）。
 * 但有的 API 线路很爱用**空格**代替换行，结果「就像这样 不符合习惯 不是写小作文」
 * 整段挤进一个气泡。
 *
 * system prompt 开头的 ChatApp 格式说明本来就写了「一个气泡一行」，可它离开口太远，
 * 长对话里会褪色；用户自己加的世界书也压不住所有线路（2026-10-26 用户反馈）。
 * 所以开关开着时，在 recencyTail（模型开口前最后读到的那几段）再补一次。
 *
 * ## 为什么是开关、而且按角色
 *
 * 有的角色就是爱发长文（用户 2026-10-26 提出），所以跟「陪伴，不监督」一样放在神经链接里按角色开关。
 * **缺省开**（`undefined` 视为 true）。关掉 = 回到旧行为：不补这段提醒。
 */

/** 小标题。测试与调用方都引这一个常量。 */
export const SHORT_BUBBLE_HEADING = '### 消息节奏：一句一个气泡';

export const shortBubbleStyleOn = (
    char?: { shortBubbleStyleEnabled?: boolean } | null,
): boolean => char?.shortBubbleStyleEnabled !== false;

/** 开关关着时返回空串 —— 调用方直接拼接即可。 */
export function buildShortBubbleReminder(enabled = true): string {
    if (!enabled) return '';
    return [
        SHORT_BUBBLE_HEADING,
        '',
        '像平时用手机聊天那样发消息：大部分时候一句话就是一条消息，想说几句就分几行发，每一行会显示成一个单独的气泡。',
        '- 句与句之间用**换行**分开。不要用空格把几句话串在同一行里——空格不会拆气泡，会挤成一大段。',
        '- 示例（三行 = 三个气泡）：',
        '  就像这样',
        '  符合大家平时上网聊天的习惯',
        '  线上聊天不是写小作文',
        '- 只有偶尔真的需要一口气说完时（情绪激动、认真解释、倾诉一件事），才把一段话写在同一行里当长消息发；一轮里这样的长段最多一条，其余照常分行。',
    ].join('\n');
}
