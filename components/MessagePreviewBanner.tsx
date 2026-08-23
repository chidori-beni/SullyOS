import React, { useEffect, useRef, useState } from 'react';
import { MESSAGE_PREVIEW_EVENT, MessagePreviewDetail } from '../utils/messagePreview';

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
 */
const MessagePreviewBanner: React.FC = () => {
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

    return (
        <div
            className="sully-message-preview-container"
        >
            <style>{`
                .sully-message-preview-container {
                    position: fixed;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 92%;
                    max-width: 380px;
                    z-index: 70;
                    pointer-events: none;
                    padding-top: max(20px, var(--safe-top, env(safe-area-inset-top, 0px)));
                }
                .sully-message-preview-card {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    width: 100%;
                    padding: 14px;
                    overflow: hidden;
                    cursor: pointer;
                    pointer-events: auto;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: pan-y;
                    color: #1c1c1e;
                    background: var(--sully-msg-bg, rgba(255, 255, 255, .72));
                    backdrop-filter: blur(var(--sully-msg-blur, 25px)) saturate(var(--sully-msg-saturate, 180%));
                    -webkit-backdrop-filter: blur(var(--sully-msg-blur, 25px)) saturate(var(--sully-msg-saturate, 180%));
                    border: var(--sully-msg-border, 1px solid rgba(255, 255, 255, .48));
                    border-radius: var(--sully-msg-radius, 18px);
                    box-shadow: var(--sully-msg-shadow, 0 4px 30px rgba(0, 0, 0, .12));
                    animation: sullyMessagePreviewIn .5s cubic-bezier(.32, .72, 0, 1);
                }
                .sully-message-preview-card:active { background: rgba(255, 255, 255, .86); }
                .sully-message-preview-avatar-wrap {
                    position: relative;
                    width: 44px;
                    height: 44px;
                    flex: 0 0 44px;
                    overflow: visible;
                }
                .sully-message-preview-avatar,
                .sully-message-preview-avatar-fallback {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    border-radius: 50%;
                    object-fit: cover;
                    background: linear-gradient(135deg, #a8edea, #fed6e3);
                    color: rgba(30, 40, 50, .78);
                    font-size: 18px;
                    font-weight: 700;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, .15);
                }
                .sully-message-preview-avatar-ring {
                    position: absolute;
                    inset: -3px;
                    border: 2px solid rgba(255, 255, 255, .55);
                    border-radius: 50%;
                    pointer-events: none;
                }
                .sully-message-preview-content {
                    display: flex;
                    flex: 1;
                    min-width: 0;
                    flex-direction: column;
                    justify-content: center;
                    gap: 3px;
                }
                .sully-message-preview-swap { animation: sullyMessagePreviewSwap .24s ease-out; }
                .sully-message-preview-header {
                    display: flex;
                    align-items: baseline;
                    justify-content: space-between;
                    gap: 8px;
                    width: 100%;
                }
                .sully-message-preview-name {
                    max-width: 70%;
                    overflow: hidden;
                    color: var(--sully-msg-title-color, #000);
                    font-size: 15px;
                    font-weight: 600;
                    opacity: .9;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .sully-message-preview-time {
                    flex: 0 0 auto;
                    color: var(--sully-msg-time-color, #666);
                    font-size: 12px;
                    opacity: .8;
                    white-space: nowrap;
                }
                .sully-message-preview-body {
                    display: -webkit-box;
                    overflow: hidden;
                    color: var(--sully-msg-body-color, #333);
                    font-size: 14px;
                    line-height: 1.35;
                    opacity: .86;
                    text-overflow: ellipsis;
                    -webkit-box-orient: vertical;
                    -webkit-line-clamp: 2;
                }
                @keyframes sullyMessagePreviewIn {
                    from { opacity: 0; transform: translateY(-30px) scale(.9); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes sullyMessagePreviewSwap {
                    from { opacity: .25; transform: translateY(3px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @media (prefers-color-scheme: dark) {
                    .sully-message-preview-card { background: var(--sully-msg-bg-dark, rgba(30, 30, 30, .68)); color: #fff; }
                    .sully-message-preview-name { color: var(--sully-msg-title-color, #fff); }
                    .sully-message-preview-time { color: var(--sully-msg-time-color, #aaa); }
                    .sully-message-preview-body { color: var(--sully-msg-body-color, #ddd); }
                }
            `}</style>
            <div className="sully-message-preview-card" role="status" aria-live="polite" onClick={openChat}>
                <div className="sully-message-preview-avatar-wrap" aria-hidden="true">
                    {preview.avatarUrl ? (
                        <img
                            className="sully-message-preview-avatar"
                            src={preview.avatarUrl}
                            alt=""
                            onError={(event) => { event.currentTarget.style.display = 'none'; }}
                        />
                    ) : (
                        <div className="sully-message-preview-avatar-fallback">{preview.charName.slice(0, 1)}</div>
                    )}
                    <span className="sully-message-preview-avatar-ring" />
                </div>
                <div className="sully-message-preview-content" key={preview.sequence}>
                    <div className="sully-message-preview-swap">
                        <div className="sully-message-preview-header">
                            <div className="sully-message-preview-name">{preview.charName}</div>
                            <div className="sully-message-preview-time">{formatTime(preview.timestamp)}</div>
                        </div>
                        <div className="sully-message-preview-body">{preview.body}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MessagePreviewBanner;
