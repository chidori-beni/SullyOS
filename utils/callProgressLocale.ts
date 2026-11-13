import type { UiLocale } from './uiLocale';

const FIXED: Record<string, string> = {
  "正在打开 Live2D ZIP，请耐心等待…": "Live2D ZIP を開いています。しばらくお待ちください…",
  "正在检查 VRM 模型…": "VRM モデルを確認中…",
  "正在保存 VRM 测试模型…": "VRM テストモデルを保存中…",
  "正在写入本地模型库，请保持页面打开…": "端末のモデルライブラリに保存中です。このページを開いたままお待ちください…",
  "正在读取 model3、动作配置与 VTube Studio 热键…": "model3・モーション設定・VTube Studio のホットキーを読み込み中…",
  "已建立默认 2K 纹理（保留最多 4K 源图供切换），正在整理本地模型包…": "標準の 2K テクスチャを作成しました（切り替え用に最大 4K の元画像を保持）。端末内のモデルデータを整理中…",
  "已逐张生成默认 2K 纹理，正在写入低内存运行缓存…": "標準の 2K テクスチャを順に作成しました。省メモリ動作用キャッシュを保存中…",
  "聊天原文边界已同步": "チャット原文の処理範囲を同期しました",
  "记忆整理完成，本段没有新增长期记忆": "記憶の整理が完了しました。この区間に新しい長期記憶はありません",
  "正在审视记忆…": "記憶を振り返っています…",
  "正在整理门牌…": "記憶の部屋の表示を整理中…",
  "正在从内置缓存恢复 Sully…": "内蔵キャッシュから Sully を復元中…",
  "正在读取免解压模型包…": "展開不要のモデルデータを読み込み中…",
  "首次优化旧模型：正在低内存解包并建立运行缓存…": "旧モデルの初回最適化：省メモリで展開し、動作用キャッシュを作成中…",
  "角色已就绪": "キャラクターの準備ができました",
  "正在读取 Sully 内置高清模型…": "Sully 内蔵高画質モデルを読み込み中…",
  "正在从内存缓存恢复高清 4K模型…": "メモリキャッシュから高画質 4Kモデルを復元中…",
  "正在读取已优化的高清 4K运行缓存…": "最適化済みの高画質 4K動作用キャッシュを読み込み中…",
  "正在读取高清 4K运行缓存…": "高画質 4K動作用キャッシュを読み込み中…",
  "正在从源包逐张生成高清 4K运行纹理…": "元データから高画質 4K動作用テクスチャを順に作成中…",
  "Sully 内置高清模型就绪": "Sully 内蔵高画質モデルの準備ができました",
  "正在读取 Sully 内置轻量模型…": "Sully 内蔵軽量モデルを読み込み中…",
  "正在从内存缓存恢复轻量 2K模型…": "メモリキャッシュから軽量 2Kモデルを復元中…",
  "正在读取已优化的轻量 2K运行缓存…": "最適化済みの軽量 2K動作用キャッシュを読み込み中…",
  "正在读取轻量 2K运行缓存…": "軽量 2K動作用キャッシュを読み込み中…",
  "正在从源包逐张生成轻量 2K运行纹理…": "元データから軽量 2K動作用テクスチャを順に作成中…",
  "Sully 内置轻量模型就绪": "Sully 内蔵軽量モデルの準備ができました"
};

// Only anchored built-in progress templates; captured names/paths/numbers stay exact.
const RULES: Array<[RegExp, (...parts: string[]) => string]> = [
  [/^Sully 预热完成：清单 (\d+(?:\.\d+)?(?:ms|s))，贴图 (\d+(?:\.\d+)?(?:ms|s))$/, (manifest,texture) => `Sully の事前読み込み完了：一覧 ${manifest}、テクスチャ ${texture}`],
  [/^模型预热完成：包 (\d+(?:\.\d+)?(?:ms|s))，贴图 (\d+(?:\.\d+)?(?:ms|s))$/, (bundle,texture) => `モデルの事前読み込み完了：データ ${bundle}、テクスチャ ${texture}`],
  [/^缓存就绪：模型包 (\d+(?:\.\d+)?(?:ms|s))，贴图 (\d+(?:\.\d+)?(?:ms|s))$/, (bundle,texture) => `キャッシュの準備完了：モデルデータ ${bundle}、テクスチャ ${texture}`],
  [/^已选择 (\d+) 个文件，正在扫描模型…$/, n => `${n} 個のファイルを選択しました。モデルをスキャン中…`],
  [/^正在读取模型配置 (\d+) 个…$/, n => `モデル設定を ${n} 個読み込み中…`],
  [/^正在扫描 (\d+) 个文件和 VTube Studio 热键…$/, n => `${n} 個のファイルと VTube Studio のホットキーをスキャン中…`],
  [/^正在低内存解包模型文件 (\d+)\/(\d+)…$/, (n, total) => `省メモリでモデルファイルを展開中 ${n}/${total}…`],
  [/^正在流式读取 ([\s\S]+)，不会把整个压缩包复制进内存…$/, name => `${name} をストリーミングで読み込み中。圧縮ファイル全体はメモリにコピーしません…`],
  [/^贴图 ([\s\S]+) 为 (\d+)×(\d+)，正在直接生成 (\d+)×(\d+) 运行图…$/, (name,w,h,tw,th) => `テクスチャ ${name}（${w}×${h}）から ${tw}×${th} の動作用画像を直接作成中…`],
  [/^已找到 (\d+) 个表情\/动作，正在整理本地模型包…$/, n => `表情・モーションが ${n} 個見つかりました。端末内のモデルデータを整理中…`],
  [/^已找到 (\d+) 个表情\/动作，正在写入低内存运行缓存…$/, n => `表情・モーションが ${n} 個見つかりました。省メモリ動作用キャッシュを保存中…`],
  [/^正在整理 (\d+) 条对话\.\.\.$/, n => `${n} 件の会話を整理中…`],
  [/^正在提取记忆 \((\d+)\/(\d+)\)\.\.\.$/, (n,total) => `記憶を抽出中（${n}/${total}）…`],
  [/^正在向量化 (\d+) 条记忆\.\.\.$/, n => `${n} 件の記憶をベクトル化中…`],
  [/^记忆整理完成！新增 (\d+) 条记忆$/, n => `記憶の整理が完了しました。${n} 件追加しました`],
  [/^完成！新增 (\d+) 条记忆(?:，(\d+) 条因重复跳过)?$/, (n,skip) => `完了！記憶を ${n} 件追加しました${skip ? `（重複 ${skip} 件をスキップ）` : ''}`],
  [/^([\s\S]+)闭上眼睛，开始整理内心…$/, name => `${name}は目を閉じ、心の中を整理し始めました…`],
];

const formatCallProgressCoreText = (locale: UiLocale, text: string): string => {
  if (locale !== 'ja-JP') return text;
  if (Object.prototype.hasOwnProperty.call(FIXED, text)) return FIXED[text];
  for (const [pattern, render] of RULES) {
    const match = pattern.exec(text);
    if (match) return render(...match.slice(1));
  }
  return text;
};

// Unwrap only one authored prefix, and translate it only when its inner progress is known.
export const formatCallProgressText = (locale: UiLocale, text: string): string => {
  const prefix = '首次优化模型：';
  if (locale === 'ja-JP' && text.startsWith(prefix)) {
    const inner = text.slice(prefix.length);
    const display = formatCallProgressCoreText(locale, inner);
    return display === inner ? text : `モデルの初回最適化：${display}`;
  }
  return formatCallProgressCoreText(locale, text);
};
