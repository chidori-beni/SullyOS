/** 糯叽机消息横幅 CSS 的兼容示例。用户可以直接替换成从糯叽机导出的整段 CSS。 */
export const DEFAULT_MESSAGE_BANNER_CSS = `/* 糯叽机兼容示例：变量和类名可直接沿用 */
:root {
  --nuo-notif-bg: rgba(255, 255, 255, .78);
  --nuo-notif-radius: 22px;
  --nuo-notif-shadow: 0 10px 30px rgba(40, 30, 70, .16);
  --nuo-notif-padding: 14px;
  --nuo-notif-gap: 12px;
}

.ios-notification-banner {
  border: 1px solid rgba(255, 255, 255, .65) !important;
}

.banner-title {
  letter-spacing: .02em;
}

.banner-message {
  line-height: 1.4;
}`;

/** 防止用户 CSS 中意外出现 </style> 时截断页面里的 style 标签。 */
export const sanitizeMessageBannerCss = (css: string): string =>
  String(css || '').replace(/<\/style/gi, '<\\/style');
