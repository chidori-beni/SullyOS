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

/**
 * 消息被删除后，算出这批删除让哪些 roundId **彻底没有消息引用了**——可以安全清掉
 * 对应的心声记录了（否则「历史」里会一直躺着一条对应消息早就删掉的孤儿记录，翻
 * 上一条/下一条还能翻到它，但已经找不到是哪句话生成的）。
 *
 * 一轮心声可能对应好几条气泡（一次回复拆成多条），只删其中一条不该连累整条心声记录
 * 消失——所以要拿"删除后还剩下的消息"核对一遍，只有这批 roundId 里**一条引用都不剩**
 * 的才会被判定为孤儿。`remainingMessages` 通常就是 Chat.tsx 删除后重新算出的
 * `messages`/`toKeep`/`remaining` 数组，不需要额外查库。
 *
 * 纯函数，不碰任何存储——真正的删除交给 `xinshengStore.ts` 的
 * `deleteOrphanedXinshengEntries`（它还会跳过用户收藏过的记录）。
 */
export const findOrphanedXinshengRoundIds = (
    deletedMessages: ReadonlyArray<{ metadata?: any }>,
    remainingMessages: ReadonlyArray<{ metadata?: any }>,
): string[] => {
    const deletedRoundIds = new Set<string>();
    for (const m of deletedMessages) {
        const rid = m?.metadata?.[XINSHENG_ROUND_META_KEY];
        if (typeof rid === 'string' && rid) deletedRoundIds.add(rid);
    }
    if (deletedRoundIds.size === 0) return [];
    const stillReferenced = new Set<string>();
    for (const m of remainingMessages) {
        const rid = m?.metadata?.[XINSHENG_ROUND_META_KEY];
        if (typeof rid === 'string' && rid) stillReferenced.add(rid);
    }
    return [...deletedRoundIds].filter(rid => !stillReferenced.has(rid));
};

/**
 * 云端推送路径专用：把同一个 push session 里、已经落库但还没打上 roundId 的**早前**气泡
 * 回填成同一个 roundId。
 *
 * 病根：一条回复常被 worker 拆成好几条独立 push，每条各自单独跑一遍
 * `applyAssistantPostProcessing`（见 `utils/activeMsgRuntime.ts` 的
 * `processInboxMessageWithPostProcessing`），互不知道彼此。协议要求心声 JSON 只挂在
 * **最后一条**推送上（worker `sanitize.ts` 的设计），所以只有处理最后一条的那次调用
 * 摸得到 JSON、只有它落库的气泡会带上 roundId——前面几条推送早就各自落库完了，
 * metadata 里压根没有这个字段，头像自然不是可点击状态（不是点击事件被吞，是真的
 * 没有 onClick）。这里在心声解析成功的那一刻，反向把同一个 sessionId 下、还没有
 * roundId 的早前气泡一起补上。
 *
 * 只在能确定「属于同一个 push session」时才动手（靠 metadata.activeMsg2.sessionId
 * 比对，串号来源见 activeMsgRuntime.ts 的 mcdInheritMeta）；本地生成 / 没有 sessionId
 * 的路径不会调用这个函数，因为它们的所有气泡本就在同一次 applyAssistantPostProcessing
 * 调用里落库，早就共享同一个 roundId，不需要回填。
 */
export const backfillXinshengRoundIdForSession = async (
    charId: string,
    sessionId: string,
    roundId: string,
    /** 依赖注入，方便测试；生产环境用真正的 DB。 */
    db: {
        getRecentMessagesByCharId: (charId: string, limit: number) => Promise<Array<{ id: number; role: string; metadata?: any }>>;
        updateMessageMetadata: (id: number, updater: (prev: any) => any) => Promise<void>;
    },
): Promise<number> => {
    if (!charId || !sessionId || !roundId) return 0;
    let patched = 0;
    try {
        // 200 条足够覆盖一次推送拆出来的所有气泡（单次推送最多拆几十条，见 worker 侧的保险上限）。
        const recent = await db.getRecentMessagesByCharId(charId, 200);
        for (const msg of recent) {
            if (msg.role !== 'assistant') continue;
            if (msg.metadata?.[XINSHENG_ROUND_META_KEY]) continue; // 已经打过（多半是这一轮自己那条），跳过
            if (msg.metadata?.activeMsg2?.sessionId !== sessionId) continue; // 不是同一个 session，不能碰
            await db.updateMessageMetadata(msg.id, prev => ({ ...(prev || {}), [XINSHENG_ROUND_META_KEY]: roundId }));
            patched += 1;
        }
    } catch (e) {
        console.warn('[xinsheng] 回填同 session 早前气泡失败:', e);
    }
    return patched;
};
