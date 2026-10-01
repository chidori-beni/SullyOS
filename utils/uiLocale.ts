export type UiLocale = 'zh-CN' | 'ja-JP';

export const DEFAULT_UI_LOCALE: UiLocale = 'zh-CN';
export const UI_LOCALE_STORAGE_KEY = 'sullyos.uiLocale.v1';

export type UiMessageParams = Record<string, string | number>;

const ZH_MESSAGES = {
  'launcher.dream': '梦境',
  'error.copy': '复制报错信息',
  'error.copied': '已复制',
  'error.manual': '请手动复制',
  'error.prompt': '请手动复制报错信息',
  'error.title': '应用运行错误',
  'error.chunk.title': '资源加载失败',
  'error.chunk.hint': '页面组件未能加载或解析，可能与网络中断或版本更新有关。可以刷新重试；如果仍然报错，请复制报错信息反馈。',
  'error.chunk.reloading': '正在自动刷新恢复…',
  'error.chunk.reload': '刷新重试',
  'common.copy': '复制',
  'common.close': '关闭',
  'terminal.title': '系统调试终端',
  'terminal.error': 'SYSTEM ERROR',
  'terminal.copy': '复制 JSON',
  'terminal.clear': '清空日志',
  'terminal.storage.title': '检测到浏览器存储无法打开',
  'terminal.storage.help': '请先不要清除浏览器数据、格式化或重置 SullyOS。彻底关闭浏览器后重启设备，并确认仍从原来的网址进入；若恢复打开，请立即完整导出备份。此错误通常来自浏览器/WebView 的站点存储，而不是应用主动删除数据。',
  'terminal.network.title': '网络连接失败？按这个顺序自查',
  'terminal.network.one': '换一个梯子节点，或先关掉梯子直连试一次——两种都失败才说明不是线路问题',
  'terminal.network.two': '把浏览器扩展（广告拦截、隐私盾、脚本管理器）全禁掉再试，或换用无痕窗口',
  'terminal.network.three': '在新标签页直接打开日志里那个 URL：能出 JSON 说明网络通，是页面这边的跨域被拦；打不开就是线路/DNS 的事',
  'terminal.network.four': '换一个浏览器或换手机热点各试一次，能定位到是「这台设备」还是「这个网络」',
  'terminal.network.five': '如果只有部分功能报错，去设置里看对应的服务地址是不是填错了（少 https://、多空格、多结尾斜杠）',
  'terminal.network.help': '日志里的「初判」和「连通性复检」两行已经替你缩小了范围，先看那两行再动手。',
  'terminal.empty': '系统运行正常，暂无错误日志。',
  'apps.Character': '神经链接',
  'apps.MemoryPalace': '记忆宫殿',
  'apps.Chat': 'Message',
  'apps.Call': '电话',
  'apps.GroupChat': '群聊',
  'apps.Room': '小小窝',
  'apps.WorldHome': '家园',
  'apps.CheckPhone': '查手机',
  'apps.Browser': '浏览器',
  'apps.Date': '见面',
  'apps.User': '档案',
  'apps.Bank': '存钱罐',
  'apps.Journal': '交换日记',
  'apps.Handbook': '手账',
  'apps.Social': 'Spark',
  'apps.Study': '自习室',
  'apps.Game': 'TRPG',
  'apps.Novel': '笔友会',
  'apps.Songwriting': '写歌',
  'apps.VRWorld': '彼方',
  'apps.Bookroom': '书房',
  'apps.Cinema': '影院',
  'apps.Schedule': '日历',
  'apps.Worldbook': '世界书',
  'apps.HotNews': '热点',
  'apps.FAQ': '使用帮助',
  'apps.Gallery': '相册',
  'apps.XhsFreeRoam': '自由活动',
  'apps.XhsStock': '小红书图库',
  'apps.ThemeMaker': '气泡工坊',
  'apps.Appearance': '外观',
  'apps.Settings': '设置',
  'apps.Guidebook': '攻略本',
  'apps.LifeSim': '都市人生',
  'apps.SpecialMoments': '特别时光',
  'apps.Music': '音乐',
  'apps.CharCreatorDev': '捏脸·开发',
  'apps.QQBridge': 'QQ 桥',
  'shell.call.resume': '返回与{name}的通话',
  'shell.call.active': '通话中 · {name}',
  'shell.call.tap': '点击返回',
  'broadcast.chat.reply': '正在回应',
  'broadcast.chat.emotion': '正在感受',
  'broadcast.chat.count': ' 等 {count} 项',
  'broadcast.world.defaultName': '家园',
  'broadcast.world.chapter': '结第 {chapter} 卷总结中…',
  'broadcast.world.beat': '正在演绎 {name} · {done}/{total}',
  'broadcast.world.running': '世界引擎运转中…',
  'broadcast.vr.library': '图书馆',
  'broadcast.vr.music': '听歌房',
  'broadcast.vr.guestbook': '留言簿',
  'broadcast.vr.gym': '活动场',
  'broadcast.vr.defaultRoom': '彼方',
  'broadcast.vr.count': ' 等 {count} 人',
  'broadcast.vr.roaming': ' 正漫游于彼方 · {room}',
  'broadcast.vr.reading': ' 读《{title}》',
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
  'launcher.dream': '夢の世界',
  'error.copy': 'エラー情報をコピー',
  'error.copied': 'コピーしました',
  'error.manual': '手動でコピーしてください',
  'error.prompt': 'エラー情報を手動でコピーしてください',
  'error.title': 'アプリ実行エラー',
  'error.chunk.title': 'リソースを読み込めません',
  'error.chunk.hint': '画面の読み込みや解析に失敗しました。通信の切断やバージョン更新が原因の可能性があります。再読み込みし、解決しなければエラー情報をコピーして報告してください。',
  'error.chunk.reloading': '自動再読み込みで復旧中…',
  'error.chunk.reload': '再読み込みして再試行',
  'common.copy': 'コピー',
  'common.close': '閉じる',
  'terminal.title': 'システムデバッグコンソール',
  'terminal.error': 'システムエラー',
  'terminal.copy': 'JSON をコピー',
  'terminal.clear': 'ログを消去',
  'terminal.storage.title': 'ブラウザのストレージを開けません',
  'terminal.storage.help': 'ブラウザのデータ削除、初期化、SullyOS のリセットは行わないでください。ブラウザを完全に終了して端末を再起動し、元の URL から開いてください。復旧したらすぐに完全バックアップをエクスポートしてください。通常はブラウザや WebView のサイトストレージの問題で、アプリがデータを削除したわけではありません。',
  'terminal.network.title': '接続できない場合は、この順番で確認してください',
  'terminal.network.one': 'VPN の接続先を変更するか、VPN を切って直接接続してください。両方を試して回線の問題か確認します。',
  'terminal.network.two': '広告ブロッカー、プライバシー保護、スクリプト管理などの拡張機能を無効にするか、プライベートウィンドウで試してください。',
  'terminal.network.three': 'ログの URL を新しいタブで直接開いてください。JSON が表示されれば通信は可能で、ページ側のクロスオリジン通信が阻止されています。開けなければ回線や DNS を確認してください。',
  'terminal.network.four': '別のブラウザやスマートフォンのテザリングで試し、端末とネットワークのどちらに原因があるか確認してください。',
  'terminal.network.five': '一部の機能だけ失敗する場合は、設定のサービス URL を確認してください。https:// の欠落、余分な空白、末尾のスラッシュに注意してください。',
  'terminal.network.help': 'ログの「初判」と「连通性复检」の行で原因が絞り込まれています。まずこの 2 行を確認してください。',
  'terminal.empty': 'システムは正常です。エラーログはありません。',
  'apps.Character': 'ニューラルリンク',
  'apps.MemoryPalace': '記憶の宮殿',
  'apps.Chat': 'Message',
  'apps.Call': '電話',
  'apps.GroupChat': 'グループチャット',
  'apps.Room': '小さなお部屋',
  'apps.WorldHome': 'ホームワールド',
  'apps.CheckPhone': 'スマホを見る',
  'apps.Browser': 'ブラウザ',
  'apps.Date': '会う',
  'apps.User': 'プロフィール',
  'apps.Bank': '貯金箱',
  'apps.Journal': '交換日記',
  'apps.Handbook': '手帳',
  'apps.Social': 'Spark',
  'apps.Study': '自習室',
  'apps.Game': 'TRPG',
  'apps.Novel': '文通サークル',
  'apps.Songwriting': '作詞・作曲',
  'apps.VRWorld': '彼方',
  'apps.Bookroom': '書斎',
  'apps.Cinema': '映画館',
  'apps.Schedule': 'カレンダー',
  'apps.Worldbook': 'ワールドブック',
  'apps.HotNews': 'トピックス',
  'apps.FAQ': 'ヘルプ',
  'apps.Gallery': 'アルバム',
  'apps.XhsFreeRoam': '自由行動',
  'apps.XhsStock': '小紅書画像集',
  'apps.ThemeMaker': '吹き出し工房',
  'apps.Appearance': '外観',
  'apps.Settings': '設定',
  'apps.Guidebook': '攻略ガイド',
  'apps.LifeSim': '都会の人生',
  'apps.SpecialMoments': '特別な時間',
  'apps.Music': '音楽',
  'apps.CharCreatorDev': 'キャラ作成・開発',
  'apps.QQBridge': 'QQ ブリッジ',
  'shell.call.resume': '{name} との通話に戻る',
  'shell.call.active': '通話中 · {name}',
  'shell.call.tap': 'タップして戻る',
  'broadcast.chat.reply': '返信を作成中',
  'broadcast.chat.emotion': '気持ちを整理中',
  'broadcast.chat.count': ' 計 {count} 件',
  'broadcast.world.defaultName': 'ホームワールド',
  'broadcast.world.chapter': '第 {chapter} 巻のまとめを作成中…',
  'broadcast.world.beat': '{name} の物語を進行中 · {done}/{total}',
  'broadcast.world.running': 'ワールドエンジン稼働中…',
  'broadcast.vr.library': '図書館',
  'broadcast.vr.music': '音楽ルーム',
  'broadcast.vr.guestbook': 'ゲストブック',
  'broadcast.vr.gym': 'アクティビティ広場',
  'broadcast.vr.defaultRoom': '彼方',
  'broadcast.vr.count': ' 計 {count} 人',
  'broadcast.vr.roaming': ' 彼方を散策中 · {room}',
  'broadcast.vr.reading': ' 『{title}』を読書中',
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
