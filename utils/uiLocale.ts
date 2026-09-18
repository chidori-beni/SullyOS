export type UiLocale = 'zh-CN' | 'ja-JP';

export const DEFAULT_UI_LOCALE: UiLocale = 'zh-CN';
export const UI_LOCALE_STORAGE_KEY = 'sullyos.uiLocale.v1';

export type UiMessageParams = Record<string, string | number>;

const ZH_MESSAGES = {
  'common.refresh': '刷新恢复',
  'common.backToHome': '返回桌面',
  'launcher.systemOnline': '系统在线',
  'launcher.resident': '居民',
  'launcher.greeting.night': '晚安',
  'launcher.greeting.morning': '早上好',
  'launcher.greeting.afternoon': '下午好',
  'launcher.greeting.evening': '晚上好',
  'settings.title': '系统设置',
  'settings.language.title': '界面语言',
  'settings.language.current': '当前语言',
  'settings.language.option.zh': '简体中文',
  'settings.language.option.ja': '日本語',
  'settings.language.description': '只切换 SullyOS 的界面文字，不会改变角色人设、聊天内容或备份数据。',
  'settings.language.partialNotice': '语言基础设施已启用；其余界面会在后续阶段逐步本地化。',
  'shell.loading.slow': '加载有点慢…',
  'shell.loading.description': '首次打开会下载并解析功能代码；网络波动或设备性能较低都可能变慢。页面仍在继续加载，若长时间没有恢复再刷新。',
  'shell.backup.never': '还没备份过 · 去备份',
  'shell.backup.days': '已 {days} 天没备份 · 去备份',
} as const;

const JA_MESSAGES = {
  'common.refresh': '再読み込みで復帰',
  'common.backToHome': 'ホームに戻る',
  'launcher.systemOnline': 'システム稼働中',
  'launcher.resident': '住民',
  'launcher.greeting.night': 'おやすみなさい',
  'launcher.greeting.morning': 'おはようございます',
  'launcher.greeting.afternoon': 'こんにちは',
  'launcher.greeting.evening': 'こんばんは',
  'settings.title': 'システム設定',
  'settings.language.title': '表示言語',
  'settings.language.current': '現在の言語',
  'settings.language.option.zh': '簡体字中国語',
  'settings.language.option.ja': '日本語',
  'settings.language.description': 'SullyOS の画面表示だけを切り替えます。キャラクター設定、チャット内容、バックアップデータは変更しません。',
  'settings.language.partialNotice': '言語の基盤は有効です。残りの画面は次の段階で順次ローカライズします。',
  'shell.loading.slow': '読み込みに時間がかかっています…',
  'shell.loading.description': '初回起動では機能コードをダウンロードして解析します。通信状態や端末の性能によって時間がかかることがあります。長時間戻らない場合は再読み込みしてください。',
  'shell.backup.never': 'まだバックアップがありません · バックアップする',
  'shell.backup.days': 'バックアップから {days} 日経過 · バックアップする',
} as const;

export type UiMessageKey = keyof typeof ZH_MESSAGES;
export type UiTranslationCatalog = Record<UiLocale, Partial<Record<UiMessageKey, string>>>;

export const UI_MESSAGES: UiTranslationCatalog = {
  'zh-CN': ZH_MESSAGES,
  'ja-JP': JA_MESSAGES,
};

export const normalizeUiLocale = (value: unknown): UiLocale => {
  if (typeof value !== 'string') return DEFAULT_UI_LOCALE;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja-JP';
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  return DEFAULT_UI_LOCALE;
};

type UiLocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;

const resolveStorage = (storage?: UiLocaleStorage): UiLocaleStorage | null => {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

export const loadUiLocale = (storage?: UiLocaleStorage): UiLocale => {
  try {
    return normalizeUiLocale(resolveStorage(storage)?.getItem(UI_LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_LOCALE;
  }
};

export const saveUiLocale = (value: unknown, storage?: UiLocaleStorage): UiLocale => {
  const locale = normalizeUiLocale(value);
  try {
    resolveStorage(storage)?.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // 私密浏览 / WebView 禁止 localStorage 时，内存状态仍然可以继续工作。
  }
  return locale;
};

const interpolateUiMessage = (template: string, params?: UiMessageParams): string => {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key: string) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : full
  ));
};

export const resolveUiMessage = (
  locale: UiLocale,
  key: UiMessageKey,
  catalog: UiTranslationCatalog = UI_MESSAGES,
  params?: UiMessageParams,
): string => {
  const hasLocaleMessage = catalog[locale]?.[key] != null;
  if (!hasLocaleMessage && locale !== DEFAULT_UI_LOCALE && import.meta.env?.DEV && typeof console !== 'undefined') {
    console.warn(`[uiLocale] Missing ${locale} translation for "${key}"; falling back to ${DEFAULT_UI_LOCALE}.`);
  }
  const template = catalog[locale]?.[key] ?? catalog[DEFAULT_UI_LOCALE]?.[key] ?? key;
  return interpolateUiMessage(template, params);
};

export const translateUi = (locale: UiLocale, key: UiMessageKey, params?: UiMessageParams): string => (
  resolveUiMessage(locale, key, UI_MESSAGES, params)
);
