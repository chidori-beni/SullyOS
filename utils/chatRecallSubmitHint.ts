/**
 * 聊天「召回 / 云端提交」状态提示的显示偏好。
 *
 * 这是纯 UI 偏好，不属于角色数据，也不参与聊天请求判断；默认开启，
 * localStorage 不可用或内容异常时回退到默认值。
 */
export const CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY = 'sullyos.chat.cloud-handoff-status-visible.v1';
export const DEFAULT_CHAT_RECALL_SUBMIT_HINT_ENABLED = true;

export const loadChatRecallSubmitHintEnabled = (): boolean => {
    try {
        if (typeof localStorage === 'undefined') return DEFAULT_CHAT_RECALL_SUBMIT_HINT_ENABLED;
        return localStorage.getItem(CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY) !== 'false';
    } catch {
        return DEFAULT_CHAT_RECALL_SUBMIT_HINT_ENABLED;
    }
};

export const saveChatRecallSubmitHintEnabled = (enabled: boolean): void => {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY, String(enabled));
    } catch {
        // UI 偏好写失败不应影响聊天发送。
    }
};
