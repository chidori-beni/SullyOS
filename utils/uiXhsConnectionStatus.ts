import { translateUi, type UiLocale } from './uiLocale';
export type UiXhsConnectionInfo = { count: number; loggedIn: boolean; nickname?: string; userId?: string; platform?: string; hasXsecToken: boolean };
export const formatXhsConnectionStatus = (locale: UiLocale, info: UiXhsConnectionInfo): string => {
  let suffix = translateUi(locale, 'settings.xhs.notLoggedIn');
  if (info.loggedIn) {
    suffix = info.platform ? translateUi(locale, 'settings.xhs.platform', { platform: info.platform === 'rednote' ? 'RedNote' : (locale === 'ja-JP' ? '小紅書' : '小红书') }) : '';
    suffix += info.nickname ? translateUi(locale, 'settings.xhs.account', { name: info.nickname }) : translateUi(locale, 'settings.xhs.loggedIn');
    if (info.userId) suffix += ` (ID: ${info.userId})`;
    if (info.hasXsecToken) suffix += translateUi(locale, 'settings.xhs.token');
  }
  return translateUi(locale, 'settings.xhs.success', { count: info.count, info: suffix });
};
