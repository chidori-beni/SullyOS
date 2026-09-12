import type { ChatTriggerPlacement } from '../types';

/** 当前设备上所有私聊共用的输入习惯，与角色人设和聊天主题无关。 */
export interface ChatInputPreferences {
    sendButtonGenerates: boolean;
    enterToSend: boolean;
    autoReply: boolean;
    emojiSuggestions: boolean;
    /** 「触发 AI」闪电按钮放哪：聊天顶栏右上角，还是输入框右侧。
     *  以前是按角色存的（CharacterProfile.chatTriggerPlacement），每个角色都要设一遍太麻烦，
     *  改成和其他输入习惯一样全局一份。角色上的旧字段不再读取。 */
    triggerPlacement: ChatTriggerPlacement;
}

export const CHAT_INPUT_PREFERENCES_KEY = 'sully-chat-input-preferences-v1';

export const DEFAULT_CHAT_INPUT_PREFERENCES: ChatInputPreferences = {
    sendButtonGenerates: false,
    enterToSend: true,
    autoReply: false,
    emojiSuggestions: false,
    triggerPlacement: 'header',
};

/** 导入与读取共用：只接收已知布尔字段；新增功能对旧存档默认关闭。 */
export const normalizeChatInputPreferences = (value: unknown): ChatInputPreferences => {
    const saved = value && typeof value === 'object' ? value as Partial<ChatInputPreferences> : {};
    return {
        sendButtonGenerates: saved.sendButtonGenerates === true,
        enterToSend: saved.enterToSend !== false,
        autoReply: saved.autoReply === true,
        emojiSuggestions: saved.emojiSuggestions === true,
        triggerPlacement: saved.triggerPlacement === 'input' ? 'input' : 'header',
    };
};

export const loadChatInputPreferences = (): ChatInputPreferences => {
    try {
        const saved = JSON.parse(localStorage.getItem(CHAT_INPUT_PREFERENCES_KEY) || 'null');
        return normalizeChatInputPreferences(saved);
    } catch {
        return { ...DEFAULT_CHAT_INPUT_PREFERENCES };
    }
};

export const saveChatInputPreferences = (preferences: ChatInputPreferences): void => {
    try {
        localStorage.setItem(CHAT_INPUT_PREFERENCES_KEY, JSON.stringify(normalizeChatInputPreferences(preferences)));
    } catch {
        // 存储不可用的 WebView 中仍允许在当前会话使用。
    }
};
