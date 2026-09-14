/**
 * 私聊加号菜单的内置动作顺序。
 *
 * 这是独立于 ChatInputPreferences 的本机 UI 偏好：排序只影响私聊内置菜单，
 * 不改变角色数据，也不参与输入/发送开关的兼容格式。
 */
export const CHAT_ACTION_DEFINITIONS = [
    { id: 'collaboration', label: '协同工作' },
    { id: 'meetup', label: '见面' },
    { id: 'transfer', label: '转账' },
    { id: 'poke', label: '戳一戳' },
    { id: 'archive', label: '记忆归档' },
    { id: 'settings', label: '设置' },
    { id: 'image', label: '相册' },
    { id: 'reroll', label: '重新生成' },
    { id: 'schedule', label: '日程/情绪' },
    { id: 'proactive', label: '自然主动' },
    { id: 'active-msg-2', label: '主动消息 2.0' },
    { id: 'mcd', label: '麦当劳' },
    { id: 'luckin', label: '瑞一杯' },
    { id: 'html', label: 'HTML 模式' },
    { id: 'thinking', label: '展示思考' },
    { id: 'xinsheng', label: '心声' },
    { id: 'decor', label: '装扮' },
    { id: 'voice', label: '语音' },
    { id: 'memory-link', label: '记忆链接' },
    { id: 'favorites', label: '收藏' },
] as const;

export type ChatActionId = typeof CHAT_ACTION_DEFINITIONS[number]['id'];
export type ChatActionOrder = ChatActionId[];

export const CHAT_ACTION_ORDER_STORAGE_KEY = 'sully-chat-action-order-v1';

export const DEFAULT_CHAT_ACTION_ORDER: ChatActionOrder = CHAT_ACTION_DEFINITIONS.map(({ id }) => id);

const CHAT_ACTION_ID_SET = new Set<string>(DEFAULT_CHAT_ACTION_ORDER);

export const isChatActionId = (value: unknown): value is ChatActionId => (
    typeof value === 'string' && CHAT_ACTION_ID_SET.has(value)
);

/**
 * 读取旧值/坏值时统一修复：去掉未知和重复项，再把未来新增动作追加到末尾。
 * 不修改调用方传进来的数组。
 */
export const normalizeChatActionOrder = (value: unknown): ChatActionOrder => {
    const result: ChatActionOrder = [];
    const seen = new Set<ChatActionId>();
    const saved = Array.isArray(value) ? value : [];

    for (const item of saved) {
        if (isChatActionId(item) && !seen.has(item)) {
            seen.add(item);
            result.push(item);
        }
    }
    for (const id of DEFAULT_CHAT_ACTION_ORDER) {
        if (!seen.has(id)) result.push(id);
    }
    return result;
};

/** 只交换相邻两项；越过边界时返回归一化后的副本。 */
export const moveChatAction = (
    order: readonly ChatActionId[],
    id: ChatActionId,
    delta: -1 | 1,
): ChatActionOrder => {
    const next = normalizeChatActionOrder(order);
    const index = next.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return next;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
};

export const loadChatActionOrder = (): ChatActionOrder => {
    try {
        const saved = JSON.parse(localStorage.getItem(CHAT_ACTION_ORDER_STORAGE_KEY) || 'null');
        return normalizeChatActionOrder(saved);
    } catch {
        return [...DEFAULT_CHAT_ACTION_ORDER];
    }
};

export const saveChatActionOrder = (order: readonly ChatActionId[]): void => {
    try {
        localStorage.setItem(CHAT_ACTION_ORDER_STORAGE_KEY, JSON.stringify(normalizeChatActionOrder(order)));
    } catch {
        // 存储不可用的 WebView 中仍允许当前会话使用这份排序。
    }
};
