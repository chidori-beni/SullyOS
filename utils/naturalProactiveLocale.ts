import type { AmsgNaturalLastCheck } from './amsgFirePack';
import type { UiMessageKey, UiMessageParams } from './uiLocale';

type Translator = (key: UiMessageKey, params?: UiMessageParams) => string;

export const formatNaturalError = (t: Translator, message: string): string => {
  if (message === '云端 Worker 还不是支持自然主动的新版本。请先按我稍后给你的步骤重新部署 Worker。') return t('natural.unsupported');
  const match = /^还有 (\d+) 个旧的自然主动检查没有取消成功。为防止重复发消息，这次没有重新安排；请稍后重试。$/.exec(message);
  return match ? t('natural.cancelFailed', { count: match[1] }) : message;
};

// Display only: never rewrite the stored check, scoring reasons or character profile.
export const formatNaturalLastCheck = (t: Translator, check: AmsgNaturalLastCheck, formatTime: (ms: number) => string): string => {
  const next = check.nextCheckAt ? t('natural.next', { time: formatTime(check.nextCheckAt) }) : '';
  const key: UiMessageKey = check.sent ? 'natural.sent' : check.skipReason === 'active-chat-presence' ? 'natural.chat' : check.skipReason === 'active-date-presence' ? 'natural.date' : check.skipReason === 'asleep' ? 'natural.asleep' : check.skipReason === 'unanswered-limit' ? 'natural.limit' : 'natural.quiet';
  return t(key, { time: formatTime(check.checkedAt), next });
};

export const formatNaturalReason = (t: Translator, reason: string): string => {
  const labels: Record<string, UiMessageKey> = {
    '亲密关系加权': 'natural.romantic', '亲近关系加权': 'natural.close',
    '异地/手机联系加权': 'natural.distance', '安静时段': 'natural.quietReason',
    '刚主动联系过': 'natural.justSent', '近期主动联系过': 'natural.recentSent',
  };
  if (Object.prototype.hasOwnProperty.call(labels, reason)) return t(labels[reason]);
  let match = /^沉默 (\d+(?:\.\d+)?) 小时$/.exec(reason);
  if (match) return t('natural.silence', { count: match[1] });
  match = /^已有 (\d+) 条未获回复$/.exec(reason);
  if (match) return t('natural.unanswered', { count: match[1] });
  match = /^日程里正在睡觉（已睡约 (\d+(?:\.\d+)?) 小时，还剩约 (\d+(?:\.\d+)?) 小时）$/.exec(reason);
  if (match) return t('natural.sleep', { slept: match[1], left: match[2] });
  return reason;
};
