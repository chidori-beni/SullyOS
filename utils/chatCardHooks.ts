/**
 * 聊天卡片的 CSS 钩子。
 *
 * 背景：聊天里三十多种卡片（彼方动态、通话小结、日程邀约、音乐、小红书……）以前全是
 * 硬编码 Tailwind + 内联 style，外层连个类名都没有，用户就算会写 CSS 也一个都选不中。
 * 于是「彼方那张深蓝卡丢进浅色聊天里特别突兀」这种事完全无解。
 *
 * 现在统一在卡片外层挂上：
 *   - class `sully-chat-card`         所有卡片共用
 *   - `data-card="<种类>"`            普通卡片用消息 type；system 角色的事件卡统一为 `system`
 *   - `data-card-sub="<子类>"`        score_card 的子类型 / 系统卡的 metadata.source
 *
 * 于是「装扮 → 所有聊天 → 卡片 · CSS」里可以写：
 *   .sully-chat-card[data-card="vr_card"] ...
 *   .sully-chat-card[data-card="system"][data-card-sub="call-end-popup"] ...
 *
 * 新增任何卡片渲染分支时，务必把 `cardHookProps(m)` 展开到那个分支最外层的 div 上，
 * 并把新 type 登记进 CARD_MESSAGE_TYPES，否则这张卡在装扮里选不中（静默地没法美化）。
 */

export interface CardHookMessage {
  role?: string | null;
  type?: string | null;
  content?: string | null;
  metadata?: Record<string, any> | null;
}

export interface CardHook {
  /** data-card 的值 */
  kind: string;
  /** data-card-sub 的值（没有子类时为 undefined） */
  sub?: string;
}

/**
 * 走 `commonLayout` 的普通卡片消息类型。
 *
 * `system` 角色的卡片不在这里——它们各自有独立外壳，统一由 resolveCardHook 归到
 * `data-card="system"`，靠 metadata.source 细分。
 */
export const CARD_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'transfer',
  'interaction',
  'social_card',
  'xhs_card',
  'score_card',
  'music_card',
  'mcd_card',
  'luckin_card',
  'html_card',
  'news_card',
  'vr_card',
  'trpg_card',
  'novel_card',
  'world_card',
  'sim_card',
  'phone_card',
  'webpage_card',
  'theater_card',
  'room_card',
  'life_card',
  'group_topic_card',
  'schedule_invite',
  'schedule_invite_reply',
]);

/**
 * score_card 把六七种卡片挤在同一个 type 里，真正的种类写在 metadata.scoreCard.type。
 * 历史消息可能只把 JSON 塞在 content 里，所以两处都要看——和 MessageItem 的取法一致。
 */
const readScoreCardType = (message: CardHookMessage): string | undefined => {
  const direct = message?.metadata?.scoreCard?.type;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const raw = message?.content;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const fromContent = parsed?.type;
    return typeof fromContent === 'string' && fromContent.trim() ? fromContent.trim() : undefined;
  } catch {
    return undefined;
  }
};

/** 这条消息该挂什么卡片钩子；不是卡片则返回 null。 */
export const resolveCardHook = (message: CardHookMessage | null | undefined): CardHook | null => {
  if (!message) return null;
  const type = typeof message.type === 'string' ? message.type : '';

  // 系统事件卡（通话小结 / 未接来电 / 见面完结 / 见面邀请 / 各种 score_card）以及
  // 那条灰色系统日志小胶囊，全部归到 data-card="system"，靠 sub 区分。
  if (message.role === 'system') {
    if (type === 'score_card') return { kind: 'system', sub: readScoreCardType(message) || 'score_card' };
    const source = message.metadata?.source;
    if (typeof source === 'string' && source.trim()) return { kind: 'system', sub: source.trim() };
    return { kind: 'system', sub: 'system-log' };
  }

  if (!CARD_MESSAGE_TYPES.has(type)) return null;
  if (type === 'score_card') {
    const sub = readScoreCardType(message);
    return sub ? { kind: type, sub } : { kind: type };
  }
  return { kind: type };
};

export const isCardMessage = (message: CardHookMessage | null | undefined): boolean =>
  resolveCardHook(message) !== null;

/**
 * 展开到卡片最外层 div 上的属性。不是卡片时返回空对象（普通气泡不会多出任何标记）。
 *
 * class 不在这里返回：各分支的 className 写法不一（有的是模板串、有的是数组 join），
 * 由调用处自己拼 `sully-chat-card`，避免覆盖掉原有类名。
 */
export const cardHookProps = (
  message: CardHookMessage | null | undefined,
): Record<string, string> => {
  const hook = resolveCardHook(message);
  if (!hook) return {};
  return hook.sub
    ? { 'data-card': hook.kind, 'data-card-sub': hook.sub }
    : { 'data-card': hook.kind };
};
