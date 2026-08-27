// 「一轮」的标识。
//
// 心声是按**轮**存的（一次回复 = 一条心声），但 Sully 的一次回复会拆成好几条气泡。
// 点任意一条气泡的头像都该打开同一张卡，所以本轮落库的每条 assistant 消息都会被打上
// 同一个 roundId（metadata.xinshengRoundId），心声库以它为 key。
//
// id 形如 `xs_1756272000000_a1b2c3`：时间戳定长 13 位（到 2286 年），
// 所以**字典序 == 时间序**，历史翻页、上限淘汰、连续性回灌全都直接 sort() 就行，
// 不用为排序再存一份时间字段。

/** 落在消息 metadata 上的键名。改它会让老消息的头像点不开卡片。 */
export const XINSHENG_ROUND_META_KEY = 'xinshengRoundId';

export const newXinshengRoundId = (now = Date.now()): string =>
    `xs_${now}_${Math.random().toString(36).slice(2, 8)}`;

/** 从一条消息的 metadata 里取 roundId。 */
export const readRoundId = (msg: { metadata?: any } | null | undefined): string | null => {
    const v = msg?.metadata?.[XINSHENG_ROUND_META_KEY];
    return typeof v === 'string' && v ? v : null;
};
