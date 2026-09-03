/**
 * 聊天里的日期分隔线：「今天 / 昨天 / 9月1日 · 星期一」。
 *
 * 为什么要写成功能而不是 CSS：分隔线要显示的是「这条消息发生在哪一天」，
 * 而 CSS 拿不到时间戳——只能由渲染时插一个真实元素进消息列表。
 *
 * 时区：走**设备本地时间**，不走角色时区。依据 docs/character-timezone.md 的分工表——
 * 「消息气泡上的收发时间」属于用户自己的时间。角色在东京、用户在北京时，
 * 用户翻记录看到的「今天」应该是用户的今天。
 *
 * 分隔线插在「跨天的第一条消息」上方，所以它天然跟着当前可见的消息走：
 * 开了「隐藏系统日志」而某天只剩系统日志时，那天不会留下一条空的分隔线。
 */

/** 本地时区的「哪一天」，形如 2026-09-03。跨天判定只比这个字符串。 */
export const localDayKey = (timestamp: number): string => {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/** 这条消息上方要不要插分隔线：第一条永远要，之后只在跨天时要。 */
export const shouldShowDateDivider = (
  timestamp: number,
  previousTimestamp: number | null | undefined,
): boolean => {
  const key = localDayKey(timestamp);
  if (!key) return false;
  if (previousTimestamp === null || previousTimestamp === undefined) return true;
  return key !== localDayKey(previousTimestamp);
};

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 分隔线上的文字。
 *
 * 今天 / 昨天不带星期——那两个词本身已经够定位了，再挂个星期反而啰嗦；
 * 更早的日子才需要星期来帮着回忆「那天是周几」。跨年补上年份。
 */
export const formatDateDividerLabel = (timestamp: number, now: number = Date.now()): string => {
  const key = localDayKey(timestamp);
  if (!key) return '';
  const todayKey = localDayKey(now);
  if (key === todayKey) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDayKey(yesterday.getTime())) return '昨天';

  const d = new Date(timestamp);
  const weekday = WEEKDAYS[d.getDay()];
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} · ${weekday}`;
};
