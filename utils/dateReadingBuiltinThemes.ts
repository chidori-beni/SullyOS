/**
 * 见面阅读页的三套内置主题（39 批，取自上游 c523c752 的「纯小说 / 旧书纸页 / 静夜阅读」）。
 *
 * 上游是另起一个「当前美化」开关 + .meeting-reading 类名；本 fork 的阅读页早有
 * 「阅读美化 CSS · 糯叽机兼容」（#this-moment-screen / .tm-* DOM 合同 + 预设），
 * 再加一套开关会两边打架。所以这里把三套主题写成同一合同下的 CSS，点一下就当作
 * 一份阅读 CSS 应用——之后照样能在文本框里改、存成自己的预设、或「恢复默认」清掉。
 */
export interface DateReadingBuiltinTheme {
    id: 'novel' | 'paper' | 'night';
    name: string;
    description: string;
    css: string;
}

const themeCss = (name: string, paper: string, ink: string, muted: string) => `/* Sully 内置阅读主题 · ${name} */
#this-moment-screen { background: ${paper} !important; color: ${ink} !important; }
#this-moment-screen > .tm-bg-image,
#this-moment-screen > .tm-bg-overlay { display: none !important; }
#this-moment-screen > .tm-header { background: ${paper} !important; color: ${ink} !important; backdrop-filter: none !important; }
#this-moment-screen > .tm-story { background: ${paper} !important; mask-image: none !important; -webkit-mask-image: none !important; }
#this-moment-screen .tm-para-block {
    color: ${ink} !important;
    font-family: var(--app-font, "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif) !important;
    line-height: 2 !important;
    letter-spacing: .035em;
    text-align: justify;
    font-style: normal !important;
    text-shadow: none !important;
}
#this-moment-screen .tm-para-user .tm-para-block { color: ${muted} !important; }
#this-moment-screen .tm-body { border: 0 !important; background: transparent !important; }
#this-moment-screen .tc-avatar-area { display: none !important; }
`;

export const DATE_READING_BUILTIN_THEMES: DateReadingBuiltinTheme[] = [
    { id: 'novel', name: '纯小说', description: '素白正文 · 连续阅读', css: themeCss('纯小说', '#fcfcfa', '#292929', 'rgba(41,41,41,.6)') },
    { id: 'paper', name: '旧书纸页', description: '暖纸衬底 · 宽松行距', css: themeCss('旧书纸页', '#f3ead8', '#51432f', 'rgba(81,67,47,.62)') },
    { id: 'night', name: '静夜阅读', description: '深色页面 · 柔和文字', css: themeCss('静夜阅读', '#191d24', '#d6d9df', 'rgba(214,217,223,.6)') },
];

/** 预设 id 用这个前缀，和用户自己存的预设分开。 */
export const builtinReadingPresetId = (id: DateReadingBuiltinTheme['id']) => `builtin:${id}`;
