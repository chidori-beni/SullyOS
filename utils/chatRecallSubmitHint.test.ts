import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY,
    DEFAULT_CHAT_RECALL_SUBMIT_HINT_ENABLED,
    loadChatRecallSubmitHintEnabled,
    saveChatRecallSubmitHintEnabled,
} from './chatRecallSubmitHint';

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY);
});

describe('聊天召回/提交状态提示显示偏好', () => {
    it('默认开启，并独立持久化开关值', () => {
        expect(loadChatRecallSubmitHintEnabled()).toBe(DEFAULT_CHAT_RECALL_SUBMIT_HINT_ENABLED);

        saveChatRecallSubmitHintEnabled(false);
        expect(localStorage.getItem(CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY)).toBe('false');
        expect(loadChatRecallSubmitHintEnabled()).toBe(false);

        saveChatRecallSubmitHintEnabled(true);
        expect(loadChatRecallSubmitHintEnabled()).toBe(true);

        localStorage.setItem(CHAT_RECALL_SUBMIT_HINT_STORAGE_KEY, 'not-a-boolean');
        expect(loadChatRecallSubmitHintEnabled()).toBe(true);
    });

    it('存储异常时回退默认值，且不阻断调用方', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('storage unavailable'); },
            setItem: () => { throw new Error('storage unavailable'); },
        });

        expect(loadChatRecallSubmitHintEnabled()).toBe(true);
        expect(() => saveChatRecallSubmitHintEnabled(false)).not.toThrow();
    });
});
