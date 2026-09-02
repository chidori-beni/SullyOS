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

/** `score_card` 靠 type 而不是 source 认，历史消息里没有 metadata.source。 */
const ALWAYS_VISIBLE_SYSTEM_CARD_TYPES: ReadonlySet<string> = new Set(['score_card']);

/**
 * 这条 system 消息是不是一张卡片（=「隐藏系统日志」不该动它）。
 *
 * 只判断"要不要豁免"，不判断 role/开关本身——调用方自己已经知道当前角色开没开。
 */
export const isAlwaysVisibleSystemCard = (
  message: { type?: string | null; metadata?: { source?: unknown } | null },
): boolean => {
  if (typeof message?.type === 'string' && ALWAYS_VISIBLE_SYSTEM_CARD_TYPES.has(message.type)) return true;
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
