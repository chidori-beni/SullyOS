import type { UiLocale } from './uiLocale';

export const CALL_NOTICE_TEMPLATES: Array<[readonly string[], readonly string[]]> = [
  [
    [
      "",
      " 导入完成：请标记哪些按键动作属于服装切换"
    ],
    [
      "",
      " のインポートが完了しました。衣装切り替え用のモーションを指定してください"
    ]
  ],
  [
    [
      "",
      " 已绑定给 ",
      ""
    ],
    [
      "",
      " を ",
      " に設定しました"
    ]
  ],
  [
    [
      "",
      " 已设为桌面与视频通话形象"
    ],
    [
      "",
      " をホームとビデオ通話のアバターに設定しました"
    ]
  ],
  [
    [
      "语音生成失败：",
      ""
    ],
    [
      "音声の生成に失敗しました：",
      ""
    ]
  ],
  [
    [
      "",
      "还在想，等一等"
    ],
    [
      "",
      "はまだ考え中です。少しお待ちください"
    ]
  ],
  [
    [
      "文本回复失败：",
      ""
    ],
    [
      "テキストの返信に失敗しました：",
      ""
    ]
  ],
  [
    [
      "TTS失败：",
      "，已保留文本并启用无声表演"
    ],
    [
      "TTS に失敗しました：",
      "。テキストを保持し、音声なしの演出に切り替えました"
    ]
  ],
  [
    [
      "重 roll 失败：",
      ""
    ],
    [
      "セリフの再生成に失敗しました：",
      ""
    ]
  ],
  [
    [
      "已保存：衣橱 ",
      " 套 · AI 可用 ",
      " 个动作"
    ],
    [
      "保存しました：衣装 ",
      " セット · AI 使用可のモーション ",
      " 個"
    ]
  ],
  [
    [
      "仍在用「",
      "」"
    ],
    [
      "引き続き「",
      "」を使用しています"
    ]
  ],
  [
    [
      "已切换到「",
      "」，下一句开始生效"
    ],
    [
      "「",
      "」に切り替えました。次の発言から適用されます"
    ]
  ],
  [
    [
      "动作库已保存：衣橱 ",
      " 套 · AI 可用 ",
      " 个动作"
    ],
    [
      "モーション一覧を保存しました：衣装 ",
      " セット · AI 使用可のモーション ",
      " 個"
    ]
  ]
];

// Match only the authored template parts. Interpolated names/errors are opaque values.
export const callNoticeTemplate = (locale: UiLocale) => (parts: TemplateStringsArray, ...values: unknown[]): string => {
  const translated = locale === 'ja-JP' ? CALL_NOTICE_TEMPLATES.find(([source]) =>
    source.length === parts.length && source.every((part, index) => part === parts[index]))?.[1] : undefined;
  const display = translated ?? parts;
  return display.reduce((text, part, index) => text + (index ? `${values[index - 1]}` : '') + part, '');
};
