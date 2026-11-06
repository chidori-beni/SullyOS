/**
 * 聊天列表「要不要跟着新消息滚到底」。
 *
 * 用户往上翻着看的时候，新消息不许把屏幕拽回底部（2026-11-06 用户原话：「我想再翻上去看清楚
 * 刚才那条，刚滑上去，下一条消息又上屏，屏幕又自动往下滑」）。
 */

/** 离底部多近算「在底部」。跟 Chat.tsx 里扩历史窗口用的是同一个距离。 */
export const CHAT_STICK_TO_BOTTOM_PX = 96;

/**
 * 滚动事件之后还跟不跟底。
 *
 * 只有**手指真的往上走了**（scrollTop 变小）才算不跟。不能只看离底部多远：平滑滚动的半路、
 * 流式气泡一下子长高时，离底部也会超过这个距离，那些都不是用户想翻上去。
 */
export const nextStickToBottom = (
  wasSticking: boolean,
  scrollTop: number,
  previousScrollTop: number,
  distanceFromBottom: number,
): boolean => {
  if (distanceFromBottom <= CHAT_STICK_TO_BOTTOM_PX) return true;
  return scrollTop < previousScrollTop ? false : wasSticking;
};

/**
 * 最后一条变了，这次要不要滚到底：
 * 刚打开这段聊天（还没有上一条）、最后一条是用户自己发的，一律滚；其余看用户在不在底部。
 */
export const shouldFollowNewMessage = (
  sticking: boolean,
  previousLastId: number | null,
  lastIsFromUser: boolean,
): boolean => sticking || previousLastId === null || lastIsFromUser;
