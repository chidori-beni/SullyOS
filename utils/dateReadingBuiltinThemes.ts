/**
 * 见面阅读页的三套内置主题（39 批，取自上游 c523c752 的「纯小说 / 旧书纸页 / 静夜阅读」）。
 *
 * 上游是另起一个「当前美化」开关 + .meeting-reading 类名；本 fork 的阅读页早有
 * 「阅读美化 CSS · 糯叽机兼容」（#this-moment-screen / .tm-* DOM 合同 + 预设），
 * 再加一套开关会两边打架。所以这里把三套主题写成同一合同下的 CSS，点一下就当作
 * 一份阅读 CSS 应用——之后照样能在文本框里改、存成自己的预设、或「恢复默认」清掉。
 *
 * 10-04 修：第一版只改了底色和正文，阅读页每段上方的名牌（.tc-header：名字 / 时间 /
 * 「线下见面」/「此时此刻」/ 头像 / 装饰）平时靠用户自己的 CSS 排版，换上内置主题后
 * 没人管，散成一行行裸字。内置主题是「连续阅读」风格，名牌整个收起，用户发言用左边线区分。
 *
 * 选中内置主题时，阅读页按 presetId 直接用这里的最新 CSS（见 resolveDateReadingCss），
 * 不用存下来的那份副本——改了这里不用让用户再点一次。
 */
export interface DateReadingBuiltinTheme {
    id: 'novel' | 'paper' | 'night';
    name: string;
    description: string;
    css: string;
}

const themeCss = (name: string, c: { paper: string; ink: string; muted: string; line: string; soft: string }) => `/* Sully 内置阅读主题 · ${name} */
#this-moment-screen { background: ${c.paper} !important; color: ${c.ink} !important; }
#this-moment-screen > .tm-bg-image,
#this-moment-screen > .tm-bg-overlay { display: none !important; }
#this-moment-screen > .tm-header {
    background: ${c.paper} !important; color: ${c.ink} !important;
    backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
    border-bottom: 1px solid ${c.line} !important; box-shadow: none !important;
}
#this-moment-screen > .tm-story { background: ${c.paper} !important; mask-image: none !important; -webkit-mask-image: none !important; }
#this-moment-screen .tm-story-inner { max-width: 40rem; padding: 1.5rem 1.4rem 0 !important; }

/* 连续阅读：每段上方的名牌、头像、装饰都收起 */
#this-moment-screen .tc-header,
#this-moment-screen .tc-header-user { display: none !important; }

#this-moment-screen .tm-para {
    margin: 0 0 1.5em !important; padding: 0 !important;
    background: transparent !important; border: 0 !important; box-shadow: none !important;
}
#this-moment-screen .tm-para::before,
#this-moment-screen .tm-para::after { content: none !important; display: none !important; }
#this-moment-screen .tm-body {
    margin: 0 !important; padding: 0 !important;
    background: transparent !important; border: 0 !important; box-shadow: none !important;
}
#this-moment-screen .tm-para-block {
    color: ${c.ink} !important;
    font-family: var(--app-font, "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif) !important;
    line-height: 2 !important;
    letter-spacing: .035em;
    text-align: justify;
    font-style: normal !important;
    text-shadow: none !important;
    background: transparent !important;
    margin: 0 0 .55em !important;
}
/* 你说的话：浅一号颜色 + 左边一道细线，跟角色的正文分开 */
#this-moment-screen .tm-para-user .tm-body {
    padding-left: .9em !important;
    border-left: 2px solid ${c.line} !important;
}
#this-moment-screen .tm-para-user .tm-para-block { color: ${c.muted} !important; }
#this-moment-screen .tm-para-phone { color: ${c.muted} !important; }
#this-moment-screen .tm-thinking-toggle { color: ${c.muted} !important; background: ${c.soft} !important; border-radius: 10px; }
`;

export const DATE_READING_BUILTIN_THEMES: DateReadingBuiltinTheme[] = [
    {
        id: 'novel', name: '纯小说', description: '素白正文 · 连续阅读',
        css: themeCss('纯小说', { paper: '#fcfcfa', ink: '#292929', muted: 'rgba(41,41,41,.58)', line: 'rgba(41,41,41,.14)', soft: 'rgba(41,41,41,.05)' }),
    },
    {
        id: 'paper', name: '旧书纸页', description: '暖纸衬底 · 宽松行距',
        css: themeCss('旧书纸页', { paper: '#f3ead8', ink: '#51432f', muted: 'rgba(81,67,47,.62)', line: 'rgba(81,67,47,.2)', soft: 'rgba(81,67,47,.06)' }),
    },
    {
        id: 'night', name: '静夜阅读', description: '深色页面 · 柔和文字',
        css: themeCss('静夜阅读', { paper: '#191d24', ink: '#d6d9df', muted: 'rgba(214,217,223,.58)', line: 'rgba(214,217,223,.16)', soft: 'rgba(214,217,223,.06)' }),
    },
];

/** 预设 id 用这个前缀，和用户自己存的预设分开。 */
export const builtinReadingPresetId = (id: DateReadingBuiltinTheme['id']) => `builtin:${id}`;

/** 阅读页实际要用的 CSS：选中内置主题时用这里的最新版，否则用存着的那份。 */
export function resolveDateReadingCss(char: { dateReadingCustomCss?: string; dateReadingCssPresetId?: string }): string | undefined {
    const id = char.dateReadingCssPresetId;
    if (id?.startsWith('builtin:')) {
        const theme = DATE_READING_BUILTIN_THEMES.find(t => builtinReadingPresetId(t.id) === id);
        if (theme) return theme.css;
    }
    return char.dateReadingCustomCss;
}
