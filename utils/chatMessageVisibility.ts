import type { Message } from '../types';

/** 私聊界面的范围；见面/通话记录仍保留在库里，供各自界面和上下文使用。 */
export const isVisibleChatMessage = (message: Message, hideSystemLogs = false): boolean => (
    !message.groupId
    && message.metadata?.source !== 'date'
    && message.metadata?.source !== 'call'
    && message.metadata?.source !== 'story_theater_memory'
    && !message.metadata?.proactiveHint
    && !(hideSystemLogs && message.role === 'system' && message.type !== 'score_card')
);

/** 点击后进入私聊的桌面消息卡，与聊天页共用来源过滤，不展示系统日志。 */
export const isChatPreviewMessage = (message: Message): boolean => (
    message.role !== 'system' && isVisibleChatMessage(message)
);
