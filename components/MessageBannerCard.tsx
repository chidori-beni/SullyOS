import React from 'react';

/** 糯叽机通知栏的装饰层变量协议。保留 1–6 六个槽位，CSS 可直接控制图片、位置、层级与动画。 */
const NUO_DECO_COMPAT_CSS = [1, 2, 3, 4, 5, 6].map((index) => `
                .nuo-notif-deco-${index} {
                    top: var(--nuo-notif-deco-${index}-top, 0);
                    left: var(--nuo-notif-deco-${index}-left, 0);
                    right: var(--nuo-notif-deco-${index}-right, auto);
                    bottom: var(--nuo-notif-deco-${index}-bottom, auto);
                    width: var(--nuo-notif-deco-${index}-width, 100%);
                    height: var(--nuo-notif-deco-${index}-height, 100%);
                    background: var(--nuo-notif-deco-${index}-bg, transparent);
                    background-image: var(--nuo-notif-deco-${index}-image, none);
                    background-size: var(--nuo-notif-deco-${index}-size, auto);
                    background-position: var(--nuo-notif-deco-${index}-position, 0 0);
                    background-repeat: var(--nuo-notif-deco-${index}-repeat, no-repeat);
                    opacity: var(--nuo-notif-deco-${index}-opacity, 1);
                    z-index: var(--nuo-notif-deco-${index}-z, ${index});
                    transform: var(--nuo-notif-deco-${index}-transform, none);
                    filter: var(--nuo-notif-deco-${index}-filter, none);
                    mix-blend-mode: var(--nuo-notif-deco-${index}-mix-blend, normal);
                    animation: var(--nuo-notif-deco-${index}-animation, none);
                }
`).join('');

/** 糯叽机 CSS 常用的入场/装饰动画名；导入 CSS 后不再因为缺少 keyframes 而静默失效。 */
const NUO_KEYFRAMES_CSS = `
                @keyframes nuo-notif-fade-blur { from { opacity: 0; filter: blur(12px); } to { opacity: 1; filter: blur(0); } }
                @keyframes nuo-notif-pop-bounce { 0% { opacity: 0; transform: translateY(-18px) scale(.82); } 65% { opacity: 1; transform: translateY(3px) scale(1.03); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes nuo-notif-rotate-in { from { opacity: 0; transform: rotate(-8deg) scale(.92); } to { opacity: 1; transform: rotate(0) scale(1); } }
                @keyframes nuo-notif-glow-in { from { opacity: 0; filter: brightness(1.8) blur(8px); } to { opacity: 1; filter: brightness(1) blur(0); } }
                @keyframes nuo-notif-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
                @keyframes nuo-notif-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
                @keyframes nuo-notif-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes nuo-notif-shimmer { from { background-position: -180% 0; } to { background-position: 180% 0; } }
                @keyframes nuo-notif-glitch { 0%, 100% { transform: translate(0); } 20% { transform: translate(-2px, 1px); } 40% { transform: translate(2px, -1px); } 60% { transform: translate(-1px, 0); } }
                @keyframes nuo-notif-twinkle { 0%, 100% { opacity: .35; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.06); } }
                @keyframes nuo-notif-drift { 0%, 100% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(8px, -4px, 0); } }
                @keyframes nuo-notif-breathe { 0%, 100% { opacity: .72; } 50% { opacity: 1; } }
                @keyframes nuo-notif-hue-rotate { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }
`;

/**
 * 卡片本身（含装饰层/入场动画）的守护 CSS，与容器定位无关。
 * 抽成常量供真实横幅（`MessagePreviewBanner`）和外观设置里的静态预览
 * （`MessageBannerCssEditor`）共用，避免两处各存一份、改一处忘一处。
 */
export const MESSAGE_BANNER_CARD_GUARD_CSS = `
                .sully-message-preview-card {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: var(--nuo-notif-gap, 14px);
                    width: 100%;
                    padding: var(--nuo-notif-padding, 14px);
                    overflow: hidden;
                    cursor: pointer;
                    pointer-events: auto;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: pan-y;
                    color: #1c1c1e;
                    background: var(--nuo-notif-bg, var(--sully-msg-bg, rgba(255, 255, 255, .72)));
                    background-image: var(--nuo-notif-bg-image, none);
                    background-size: cover;
                    background-position: center;
                    backdrop-filter: var(--nuo-notif-backdrop-filter, blur(var(--sully-msg-blur, 25px)) saturate(var(--sully-msg-saturate, 180%)));
                    -webkit-backdrop-filter: var(--nuo-notif-backdrop-filter, blur(var(--sully-msg-blur, 25px)) saturate(var(--sully-msg-saturate, 180%)));
                    filter: var(--nuo-notif-filter, none);
                    border: var(--nuo-notif-border, var(--sully-msg-border, 1px solid rgba(255, 255, 255, .48)));
                    border-image: var(--nuo-notif-border-image, none);
                    outline: var(--nuo-notif-outline, none);
                    outline-offset: var(--nuo-notif-outline-offset, 0);
                    border-radius: var(--nuo-notif-radius, var(--sully-msg-radius, 18px));
                    box-shadow: var(--nuo-notif-shadow, var(--sully-msg-shadow, 0 4px 30px rgba(0, 0, 0, .12)));
                    margin-bottom: 10px;
                    font-family: var(--nuo-notif-font-family, inherit);
                    animation: var(--nuo-notif-enter-name, sullyMessagePreviewIn) var(--nuo-notif-enter-duration, .5s) var(--nuo-notif-enter-easing, cubic-bezier(.32, .72, 0, 1));
                }
                .sully-message-preview-card:active { background: rgba(255, 255, 255, .86); }
                .nuo-notif-overlay,
                .nuo-notif-deco { position: absolute; pointer-events: none; }
                .sully-message-preview-avatar-wrap {
                    position: relative;
                    width: var(--nuo-notif-avatar-size, 44px);
                    height: var(--nuo-notif-avatar-size, 44px);
                    flex: 0 0 var(--nuo-notif-avatar-size, 44px);
                    overflow: visible;
                    z-index: 10;
                    pointer-events: none;
                }
                .sully-message-preview-avatar,
                .sully-message-preview-avatar-fallback {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    border-radius: var(--nuo-notif-avatar-radius, 50%);
                    object-fit: cover;
                    background: linear-gradient(135deg, #a8edea, #fed6e3);
                    color: rgba(30, 40, 50, .78);
                    font-size: 18px;
                    font-weight: 700;
                    box-shadow: var(--nuo-notif-avatar-shadow, 0 2px 8px rgba(0, 0, 0, .15));
                    pointer-events: none;
                }
                .sully-message-preview-avatar-ring {
                    position: absolute;
                    inset: calc(0px - var(--nuo-notif-avatar-ring-offset, 3px));
                    border-width: var(--nuo-notif-avatar-ring-width, 2px);
                    border-style: var(--nuo-notif-avatar-ring-style, solid);
                    border-color: var(--nuo-notif-avatar-ring-color, rgba(255, 255, 255, .55));
                    background: var(--nuo-notif-avatar-ring-bg, transparent);
                    border-radius: var(--nuo-notif-avatar-radius, 50%);
                    pointer-events: none;
                    box-sizing: border-box;
                }
                .banner-avatar-status-dot {
                    position: absolute;
                    display: var(--nuo-notif-status-dot-display, none);
                    width: var(--nuo-notif-status-dot-size, 10px);
                    height: var(--nuo-notif-status-dot-size, 10px);
                    right: var(--nuo-notif-status-dot-right, -1px);
                    bottom: var(--nuo-notif-status-dot-bottom, -1px);
                    border-radius: 50%;
                    background: var(--nuo-notif-status-dot-color, #34c759);
                    border: var(--nuo-notif-status-dot-border, 1.5px solid #fff);
                    box-shadow: var(--nuo-notif-status-dot-shadow, 0 0 6px rgba(52, 199, 89, .6));
                    pointer-events: none;
                    box-sizing: border-box;
                }
                .sully-message-preview-content {
                    display: flex;
                    flex: 1;
                    min-width: 0;
                    flex-direction: column;
                    justify-content: center;
                    gap: 3px;
                    pointer-events: none;
                    position: relative;
                    z-index: 10;
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
                    color: var(--nuo-notif-title-color, var(--sully-msg-title-color, #000));
                    font-size: 15px;
                    font-weight: 600;
                    opacity: .9;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .sully-message-preview-time {
                    flex: 0 0 auto;
                    color: var(--nuo-notif-time-color, var(--sully-msg-time-color, #666));
                    font-size: 12px;
                    opacity: .8;
                    white-space: nowrap;
                }
                .sully-message-preview-body {
                    display: -webkit-box;
                    overflow: hidden;
                    color: var(--nuo-notif-message-color, var(--sully-msg-body-color, #333));
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
                ${NUO_DECO_COMPAT_CSS}
                .nuo-notif-overlay {
                    top: 0;
                    right: 0;
                    bottom: 0;
                    left: 0;
                    background: var(--nuo-notif-overlay-bg, none);
                    background-image: var(--nuo-notif-overlay-image, none);
                    background-size: var(--nuo-notif-overlay-size, cover);
                    background-position: var(--nuo-notif-overlay-position, center);
                    background-repeat: var(--nuo-notif-overlay-repeat, no-repeat);
                    mix-blend-mode: var(--nuo-notif-overlay-mix-blend, normal);
                    opacity: var(--nuo-notif-overlay-opacity, 1);
                    border-radius: inherit;
                    z-index: var(--nuo-notif-overlay-z, 20);
                    animation: var(--nuo-notif-overlay-animation, none);
                    transform: var(--nuo-notif-overlay-transform, none);
                    filter: var(--nuo-notif-overlay-filter, none);
                }
                ${NUO_KEYFRAMES_CSS}
`;

export interface MessageBannerCardProps {
    charName: string;
    avatarUrl?: string;
    body: string;
    time: string;
    onClick?: () => void;
    /** dark-mode class 由外层容器（.dark-mode）控制，卡片本身不需要单独传。 */
    className?: string;
}

/**
 * 单卡消息横幅的卡片本体（头像/名字/时间/正文 + 糯叽机装饰钩子）。
 * 抽成独立组件后，真实横幅（悬浮 portal）和外观设置里的静态 CSS 预览用的是同一份标记，
 * 保证「预览框里看到的」和「真收到消息时看到的」永远一致，不会有两份标记走偏的风险。
 */
const MessageBannerCard: React.FC<MessageBannerCardProps> = ({ charName, avatarUrl, body, time, onClick, className }) => {
    return (
        <div
            className={`sully-message-preview-card banner-card ios-notification-banner${className ? ` ${className}` : ''}`}
            role="status"
            aria-live="polite"
            onClick={onClick}
        >
            <span className="nuo-notif-overlay" aria-hidden="true" />
            {[1, 2, 3, 4, 5, 6].map((index) => <span key={index} className={`nuo-notif-deco nuo-notif-deco-${index}`} aria-hidden="true" />)}
            <div className="sully-message-preview-avatar-wrap banner-avatar-wrap" aria-hidden="true">
                {avatarUrl ? (
                    <img
                        className="sully-message-preview-avatar banner-avatar"
                        src={avatarUrl}
                        alt=""
                        onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    />
                ) : (
                    <div className="sully-message-preview-avatar-fallback banner-avatar">{charName.slice(0, 1)}</div>
                )}
                <span className="sully-message-preview-avatar-ring banner-avatar-ring" />
                <span className="banner-avatar-status-dot" />
            </div>
            <div className="sully-message-preview-content banner-content-wrapper">
                <div className="sully-message-preview-swap">
                    <div className="sully-message-preview-header banner-header">
                        <div className="sully-message-preview-name banner-title">{charName}</div>
                        <div className="sully-message-preview-time banner-time">{time}</div>
                    </div>
                    <div className="sully-message-preview-body banner-message">{body}</div>
                </div>
            </div>
        </div>
    );
};

export default MessageBannerCard;
