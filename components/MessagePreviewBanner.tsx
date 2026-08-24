import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MESSAGE_PREVIEW_EVENT, MessagePreviewDetail } from '../utils/messagePreview';
import { useOS } from '../context/OSContext';
import { sanitizeMessageBannerCss } from '../utils/messageBannerCss';
import MessageBannerCard, { MESSAGE_BANNER_CARD_GUARD_CSS } from './MessageBannerCard';

interface VisiblePreview extends Required<Pick<MessagePreviewDetail, 'charName' | 'body'>> {
    charId?: string;
    avatarUrl?: string;
    timestamp: number;
    sequence: number;
}

const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * 糯叽机风格的单卡消息横幅：同一张卡只更新内容，不按消息数量堆叠多张卡。
 * CSS 变量是刻意保留的主题钩子，后续可以接 Sully 的外观设置而不改消息逻辑。
 * 卡片本体（含糯叽机装饰钩子）在 `MessageBannerCard` 里，外观设置页的 CSS 预览框
 * 复用同一份标记，改一处两边都同步。
 */
const MessagePreviewBanner: React.FC = () => {
    const { theme } = useOS();
    const [preview, setPreview] = useState<VisiblePreview | null>(null);
    const [shown, setShown] = useState(false);
    const sequenceRef = useRef(0);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const onPreview = (event: Event) => {
            const detail = (event as CustomEvent<MessagePreviewDetail>).detail || {};
            const charName = String(detail.charName || '角色').trim() || '角色';
            const body = String(detail.body || '').replace(/\s+/g, ' ').trim() || `${charName} 发来了一条消息`;
            sequenceRef.current += 1;
            setPreview({
                charId: detail.charId,
                charName,
                avatarUrl: detail.avatarUrl,
                body,
                timestamp: Number(detail.timestamp) || Date.now(),
                sequence: sequenceRef.current,
            });
            setShown(true);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            hideTimerRef.current = setTimeout(() => setShown(false), 5_000);
        };

        window.addEventListener(MESSAGE_PREVIEW_EVENT, onPreview);
        return () => {
            window.removeEventListener(MESSAGE_PREVIEW_EVENT, onPreview);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, []);

    if (!shown || !preview) return null;

    const openChat = () => {
        if (preview.charId) {
            window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId: preview.charId } }));
        }
        setShown(false);
    };

    const customCss = theme.messageBannerCustomCss?.trim() || '';

    return createPortal((
        <div
            className={`sully-message-preview-container ios-notification-container${theme.darkMode ? ' dark-mode' : ''}`}
        >
            <style>{`
                .sully-message-preview-container {
                    --nuo-safe-top: var(--safe-top, env(safe-area-inset-top, 0px));
                    position: fixed;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 92%;
                    max-width: 380px;
                    /* 高于 Sully 的持久「正在回复」状态条（z-index: 999），但低于来电接听层。 */
                    z-index: 1200;
                    pointer-events: none;
                    padding-top: var(--nuo-notif-banner-offset-top, max(20px, var(--safe-top, env(safe-area-inset-top, 0px))));
                }
                ${MESSAGE_BANNER_CARD_GUARD_CSS}
            `}</style>
            {/* 自定义样式放在守护样式之后，糯叽机原 CSS 无需额外补 !important 也能覆盖默认值。 */}
            {customCss && <style>{sanitizeMessageBannerCss(customCss)}</style>}
            <MessageBannerCard
                key={preview.sequence}
                charName={preview.charName}
                avatarUrl={preview.avatarUrl}
                body={preview.body}
                time={formatTime(preview.timestamp)}
                onClick={openChat}
            />
        </div>
    ), document.body);
};

export default MessagePreviewBanner;
