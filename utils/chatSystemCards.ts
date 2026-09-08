/**
 * 「隐藏系统日志」开着的时候，哪些 system 消息仍然必须留在聊天界面上。
 *
 * 背景（2026-09-02 实机复现）：未接来电落库正常、消息列表也显示「未接来电」，可是点进
 * 聊天页一张卡片都没有。原因是 apps/Chat.tsx 里有**两处**各自手写的 hideSystemLogs 过滤，
 * 白名单还互相对不上——`reloadMessages` 只放行 `call-end-popup`，`displayMessages` 放行
 * 三种，两处都漏了 `incoming-call-missed`。于是开了「隐藏系统日志」的角色，未接来电在
 * 读库那一步就被丢掉了。
 *
 * 这些不是日志，是卡片：错过一通电话、一次见面结束、一张评分卡，都是用户要能翻回去看
 * 的事件。日志（`[System: ...]` 那类旁白）才是这个开关要隐藏的东西。
 *
 * 新增任何 system 卡片渲染分支（components/chat/MessageItem.tsx 的 `isSystem` 段）时，
 * 必须同时在这里登记，否则它会在开了开关的角色那里静默消失。
 */
export const ALWAYS_VISIBLE_SYSTEM_CARD_SOURCES = [
  /** 通话结束小结 */
  'call-end-popup',
  /** 未接 / 拒接来电 */
  'incoming-call-missed',
  /** 见面完结 */
  'date-end-popup',
  /** 见面邀请 */
  'date-meeting-invite',
] as const;

export type AlwaysVisibleSystemCardSource = typeof ALWAYS_VISIBLE_SYSTEM_CARD_SOURCES[number];

const SOURCE_SET: ReadonlySet<string> = new Set(ALWAYS_VISIBLE_SYSTEM_CARD_SOURCES);

/**
 * 见面结束时会同时落两条记录：
 * - `date-end-popup`：聊天页专用的漂亮卡片；
 * - `source: date + isDateEnding`：见面历史页用的结束锚点。
 *
 * 旧版导入 / 增量补丁有可能只留下第二条。它仍然是一个已经完成的事件，
 * 不能像普通见面正文一样从聊天列表里静默过滤掉；聊天页会把它渲染成同一张卡片。
 */
export const isDateEndingMessage = (
  message: { metadata?: { source?: unknown; isDateEnding?: unknown } | null },
): boolean => (
  message?.metadata?.source === 'date'
  && message?.metadata?.isDateEnding === true
);

/**
 * 导入补丁里的消息可能拿到新的 IndexedDB id，但 timestamp 仍然属于过去。
 * 聊天页必须按真实消息时间显示，否则恢复的结束卡会被排到所有新消息后面。
 */
export const sortChatMessagesChronologically = <T extends {
  timestamp?: unknown;
  id?: unknown;
}>(messages: readonly T[]): T[] => [...messages].sort((left, right) => {
  const leftTimestamp = typeof left.timestamp === 'number' && Number.isFinite(left.timestamp)
    ? left.timestamp
    : 0;
  const rightTimestamp = typeof right.timestamp === 'number' && Number.isFinite(right.timestamp)
    ? right.timestamp
    : 0;
  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
  const leftId = typeof left.id === 'number' && Number.isFinite(left.id) ? left.id : 0;
  const rightId = typeof right.id === 'number' && Number.isFinite(right.id) ? right.id : 0;
  return leftId - rightId;
});

const dateEncounterIdOf = (
  message: { metadata?: { dateEncounterId?: unknown } | null },
): string => typeof message?.metadata?.dateEncounterId === 'string'
  ? message.metadata.dateEncounterId
  : '';

/**
 * 聊天页只显示普通聊天和系统卡片，不显示见面正文；见面结束锚点是卡片缺失时的兜底。
 * 如果同一 encounter 已有 `date-end-popup`，隐藏锚点，避免恢复后出现两张卡片。
 */
export const filterChatMessages = <T extends {
  metadata?: { source?: unknown; isDateEnding?: unknown; dateEncounterId?: unknown } | null;
  timestamp?: unknown;
  id?: unknown;
}>(messages: readonly T[]): T[] => {
  const popupEncounterIds = new Set(
    messages
      .filter(message => message.metadata?.source === 'date-end-popup')
      .map(dateEncounterIdOf)
      .filter(Boolean),
  );

  return sortChatMessagesChronologically(messages.filter(message => {
    const source = message.metadata?.source;
    if (source === 'date') {
      if (!isDateEndingMessage(message)) return false;
      const encounterId = dateEncounterIdOf(message);
      return !encounterId || !popupEncounterIds.has(encounterId);
    }
    return source !== 'call' && source !== 'story_theater_memory';
  }));
};

/** `score_card` 靠 type 而不是 source 认，历史消息里没有 metadata.source。 */
const ALWAYS_VISIBLE_SYSTEM_CARD_TYPES: ReadonlySet<string> = new Set(['score_card']);

/**
 * 这条 system 消息是不是一张卡片（=「隐藏系统日志」不该动它）。
 *
 * 只判断"要不要豁免"，不判断 role/开关本身——调用方自己已经知道当前角色开没开。
 */
export const isAlwaysVisibleSystemCard = (
  message: { type?: string | null; metadata?: { source?: unknown; isDateEnding?: unknown } | null },
): boolean => {
  if (typeof message?.type === 'string' && ALWAYS_VISIBLE_SYSTEM_CARD_TYPES.has(message.type)) return true;
  if (isDateEndingMessage(message)) return true;
  const source = message?.metadata?.source;
  return typeof source === 'string' && SOURCE_SET.has(source);
};

/**
 * 「隐藏系统日志」开着时是否应当把这条消息从聊天界面里剔掉。
 *
 * 两处过滤（读库 reloadMessages / 渲染 displayMessages）共用这一个判定，避免再次跑偏。
 */
export const isHiddenSystemLog = (
  message: { role?: string | null; type?: string | null; metadata?: { source?: unknown } | null },
  hideSystemLogs: boolean | undefined,
): boolean => (
  !!hideSystemLogs
  && message?.role === 'system'
  && !isAlwaysVisibleSystemCard(message)
);
