import { getLocalDateKey } from './localDate';

const CHAT_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
};

/**
 * Format a chat message timestamp for the user's device timezone.
 * Same-day messages stay compact; messages from another calendar day include
 * the date so an old `HH:mm` label cannot be mistaken for today's message.
 */
export function formatChatTimestamp(timestamp: number, now: number = Date.now()): string {
    if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return '';

    const messageDate = new Date(timestamp);
    const currentDate = new Date(now);
    if (Number.isNaN(messageDate.getTime()) || Number.isNaN(currentDate.getTime())) return '';

    const timeText = messageDate.toLocaleTimeString('zh-CN', CHAT_TIME_FORMAT_OPTIONS);
    if (getLocalDateKey(messageDate) === getLocalDateKey(currentDate)) return timeText;

    const month = messageDate.getMonth() + 1;
    const day = messageDate.getDate();
    const dateText = messageDate.getFullYear() !== currentDate.getFullYear()
        ? `${messageDate.getFullYear()}年${month}月${day}日`
        : `${month}月${day}日`;
    return `${dateText} ${timeText}`;
}
