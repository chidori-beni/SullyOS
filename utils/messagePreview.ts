/** Sully 前台内部消息横幅的事件协议。 */
export const MESSAGE_PREVIEW_EVENT = 'sully-message-preview';

export interface MessagePreviewDetail {
  charId?: string;
  charName?: string;
  avatarUrl?: string;
  body?: string;
  timestamp?: number;
}

/**
 * 只把前台内部消息交给固定卡片；后台系统通知仍由原有 SW/native 路径负责。
 * 事件协议独立出来，避免 OSContext 依赖具体的视觉组件。
 */
export const emitMessagePreview = (detail: MessagePreviewDetail): void => {
  if (typeof window === 'undefined') return;
  const charName = String(detail.charName || '角色').trim() || '角色';
  const body = String(detail.body || '').replace(/\s+/g, ' ').trim();
  if (!body && !detail.charName) return;
  window.dispatchEvent(new CustomEvent<MessagePreviewDetail>(MESSAGE_PREVIEW_EVENT, {
    detail: {
      ...detail,
      charName,
      body: body || `${charName} 发来了一条消息`,
      timestamp: Number(detail.timestamp) || Date.now(),
    },
  }));
};
