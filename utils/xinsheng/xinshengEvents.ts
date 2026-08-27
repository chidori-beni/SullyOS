// 心声的跨模块广播。
//
// 落库发生在 applyAssistantPostProcessing（可能来自本地回复、也可能来自推送补收），
// 而卡片和聊天页在别处。走 window 事件而不是 props 透传：落库路径有三条
//（本地 / instant push / 主动消息补收），每条都往上接一遍 setState 太脆。

export const XINSHENG_UPDATED_EVENT = 'sully-xinsheng-updated';

export interface XinshengUpdatedDetail {
    charId: string;
    roundId: string;
}

export const dispatchXinshengUpdated = (detail: XinshengUpdatedDetail): void => {
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(XINSHENG_UPDATED_EVENT, { detail }));
        }
    } catch { /* SSR / 测试环境没有 window */ }
};
