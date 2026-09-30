/**
 * 剧情模式专用主题（皮肤）。
 *
 * 和糯叽机美化不同：这里的 CSS 直接写给剧情页自己的结构（.story-safe-header / .story-turn /
 * .story-scene …），不需要套一层别家的 DOM。所有规则都挂在 .story-skin-<id> 下，只在剧情里生效。
 *
 * 装饰（蕾丝花边、石榴石、角花）全部用内联 SVG / 渐变画，不依赖外部图床——校园网、图床挂掉都不影响。
 * 壁纸随 App 一起打包（assets/story-skins/）。
 */
import chantillyNoirBg from '../../../assets/story-skins/chantilly-noir-bg.jpg';
import chantillyNoirRose from '../../../assets/story-skins/chantilly-noir-rose.jpg';

export type StorySkinId = 'classic' | 'chantilly-noir';

export interface StorySkin {
    id: StorySkinId;
    name: string;
    subtitle: string;
    /** 主题自带明暗；有值时面板里的「明暗 / 装饰」让位给主题 */
    color?: 'light' | 'dark';
    /** 面板里的缩略图 */
    thumb?: string;
    css: string;
}

const svg = (markup: string): string => `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;

/* ── 绮夜暗香 · Chantilly Noir ─────────────────────────────── */

const NOIR_LACE_DOWN = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='11' viewBox='0 0 24 11'><path d='M0 0h24v1.5S22 9.5 12 9.5 0 1.5 0 1.5z' fill='#161314' fill-opacity='.94'/><path d='M0 1.5S2 9.5 12 9.5 24 1.5 24 1.5' fill='none' stroke='#b9aeb1' stroke-opacity='.55' stroke-width='.8'/><path d='M3 2.2S5 7.6 12 7.6 21 2.2 21 2.2' fill='none' stroke='#b9aeb1' stroke-opacity='.22' stroke-width='.6'/><circle cx='12' cy='4.6' r='1.4' fill='none' stroke='#b9aeb1' stroke-opacity='.6' stroke-width='.6'/><circle cx='5.5' cy='3' r='.65' fill='#b9aeb1' fill-opacity='.5'/><circle cx='18.5' cy='3' r='.65' fill='#b9aeb1' fill-opacity='.5'/><circle cx='12' cy='10.3' r='.6' fill='#b9aeb1' fill-opacity='.45'/></svg>`);
const NOIR_LACE_UP = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='11' viewBox='0 0 24 11'><g transform='translate(0 11) scale(1 -1)'><path d='M0 0h24v1.5S22 9.5 12 9.5 0 1.5 0 1.5z' fill='#161314' fill-opacity='.94'/><path d='M0 1.5S2 9.5 12 9.5 24 1.5 24 1.5' fill='none' stroke='#b9aeb1' stroke-opacity='.55' stroke-width='.8'/><path d='M3 2.2S5 7.6 12 7.6 21 2.2 21 2.2' fill='none' stroke='#b9aeb1' stroke-opacity='.22' stroke-width='.6'/><circle cx='12' cy='4.6' r='1.4' fill='none' stroke='#b9aeb1' stroke-opacity='.6' stroke-width='.6'/><circle cx='5.5' cy='3' r='.65' fill='#b9aeb1' fill-opacity='.5'/><circle cx='18.5' cy='3' r='.65' fill='#b9aeb1' fill-opacity='.5'/><circle cx='12' cy='10.3' r='.6' fill='#b9aeb1' fill-opacity='.45'/></g></svg>`);
/** 正文卡左上角的花饰；右下角用同一张旋转 180° */
const NOIR_CORNER = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'><path d='M1.5 32V10.5a9 9 0 0 1 9-9H32' fill='none' stroke='#c2bdbf' stroke-opacity='.55' stroke-width='.9'/><path d='M5 26V12a7 7 0 0 1 7-7h14' fill='none' stroke='#c2bdbf' stroke-opacity='.28' stroke-width='.6'/><path d='M10 10c2.5-3.5 8-3 8 .8 0 2.6-3.6 3.2-4.4 1-.6-1.6 1.2-2.4 2-1.4' fill='none' stroke='#c2bdbf' stroke-opacity='.55' stroke-width='.7'/><path d='M10 10c-3.5 2.5-3 8 .8 8 2.6 0 3.2-3.6 1-4.4-1.6-.6-2.4 1.2-1.4 2' fill='none' stroke='#c2bdbf' stroke-opacity='.55' stroke-width='.7'/><rect x='7.6' y='7.6' width='4.8' height='4.8' transform='rotate(45 10 10)' fill='#9c243b' stroke='#e7c9cf' stroke-opacity='.6' stroke-width='.5'/></svg>`);
/** 细网纱底纹（极淡），垫在正文卡里 */
const NOIR_TULLE = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M0 5L5 0L10 5L5 10Z' fill='none' stroke='#c2bdbf' stroke-opacity='.05' stroke-width='.6'/></svg>`);
const NOIR_GEM = 'radial-gradient(circle at 32% 28%, #f07d93 0 8%, #c23a55 22%, #7d1729 58%, #3a0e16 100%)';
const NOIR_SERIF = `'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', 'Noto Serif CJK SC', serif`;
const NOIR_SCRIPT = `'Snell Roundhand', 'Apple Chancery', 'Palace Script MT', 'Segoe Script', cursive`;

const CHANTILLY_NOIR_CSS = `
.story-skin-chantilly-noir {
  --story-bg: #141112;
  --story-surface: #1b1718;
  --story-raised: #221d1f;
  --story-ink: #e6dcda;
  --story-muted: #a8979b;
  --story-faint: #6f6266;
  --story-line: rgba(185, 170, 175, .24);
  --story-soft: #2a2326;
  --story-accent: #8e1f35;
  --story-accent-soft: rgba(142, 31, 53, .3);
  --story-accent-ink: #d98fa0;
  --noir-quote: #d2b394;
  --noir-silver: #c2bdbf;
  --noir-card: rgba(19, 16, 17, .82);
  color-scheme: dark;
}
.story-skin-chantilly-noir.story-theme-page {
  background: #0c0a0b url("${chantillyNoirBg}") center 30% / cover no-repeat;
}
.story-skin-chantilly-noir.story-theme-page::before {
  opacity: 1;
  background: linear-gradient(180deg, rgba(8, 6, 7, .5) 0%, rgba(8, 6, 7, .18) 35%, rgba(8, 6, 7, .5) 75%, rgba(8, 6, 7, .8) 100%);
}
/* 页面本身透明，露出壁纸；弹层 / 面板仍是实心深色 */
.story-skin-chantilly-noir.story-theme-page > .bg-stone-100 { background-color: transparent !important; }

/* 页眉 / 页脚：丝绒黑 + 蕾丝花边 + 中央一颗石榴石 */
.story-skin-chantilly-noir .story-safe-header {
  position: relative;
  background: linear-gradient(180deg, rgba(22, 19, 20, .97), rgba(22, 19, 20, .9)) !important;
  border-bottom: 0 !important;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.story-skin-chantilly-noir .story-safe-header::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -10px;
  height: 11px;
  background: ${NOIR_LACE_DOWN} repeat-x center top / 24px 11px;
  pointer-events: none;
}
.story-skin-chantilly-noir .story-safe-header::before {
  content: '';
  position: absolute;
  left: 50%; bottom: -6px;
  width: 9px; height: 9px;
  transform: translateX(-50%) rotate(45deg);
  background: ${NOIR_GEM};
  border: 1px solid rgba(231, 201, 207, .55);
  box-shadow: 0 0 10px rgba(194, 58, 85, .7);
  z-index: 2;
  pointer-events: none;
}
.story-skin-chantilly-noir .story-safe-footer {
  position: relative;
  background: linear-gradient(0deg, rgba(22, 19, 20, .97), rgba(22, 19, 20, .9)) !important;
  border-top: 0 !important;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.story-skin-chantilly-noir .story-safe-footer::before {
  content: '';
  position: absolute;
  left: 0; right: 0; top: -10px;
  height: 11px;
  background: ${NOIR_LACE_UP} repeat-x center bottom / 24px 11px;
  pointer-events: none;
}
.story-skin-chantilly-noir .story-safe-header .uppercase {
  font-family: ${NOIR_SCRIPT};
  text-transform: none;
  letter-spacing: .04em;
  font-size: 13px !important;
  font-weight: 400 !important;
  color: #c98a9a !important;
}
.story-skin-chantilly-noir .story-safe-header h1 { letter-spacing: .06em; font-family: ${NOIR_SERIF}; }

/* 正文卡：半透明黑纱 + 双线框 + 对角花饰 */
.story-skin-chantilly-noir .story-turn,
.story-skin-chantilly-noir .story-opening {
  position: relative;
  padding: 26px 20px 20px;
  border: 1px solid rgba(194, 189, 191, .26) !important;
  border-radius: 3px;
  background: ${NOIR_TULLE} repeat, var(--noir-card);
  box-shadow: inset 0 0 0 4px rgba(19, 16, 17, .7), inset 0 0 0 5px rgba(194, 189, 191, .1), 0 10px 30px rgba(0, 0, 0, .45);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
.story-skin-chantilly-noir .story-turn::before,
.story-skin-chantilly-noir .story-turn::after,
.story-skin-chantilly-noir .story-opening::after {
  content: '';
  position: absolute;
  width: 34px; height: 34px;
  background: ${NOIR_CORNER} no-repeat center / contain;
  pointer-events: none;
}
.story-skin-chantilly-noir .story-turn::before { left: 3px; top: 3px; }
.story-skin-chantilly-noir .story-turn::after,
.story-skin-chantilly-noir .story-opening::after { right: 3px; bottom: 3px; transform: rotate(180deg); }
.story-skin-chantilly-noir .story-opening { padding-top: 0; overflow: hidden; text-align: center; }
.story-skin-chantilly-noir .story-opening::before {
  content: '';
  display: block;
  height: 168px;
  margin: 0 -20px 22px;
  background: linear-gradient(180deg, rgba(19, 16, 17, 0) 45%, rgba(19, 16, 17, .96) 100%), url("${chantillyNoirRose}") center 58% / cover no-repeat;
}
.story-skin-chantilly-noir .story-opening h2 { font-family: ${NOIR_SERIF}; letter-spacing: .08em; }

/* 正文 */
.story-skin-chantilly-noir .story-prose,
.story-skin-chantilly-noir .story-prose-user {
  font-family: ${NOIR_SERIF};
  letter-spacing: .03em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .55);
}
.story-skin-chantilly-noir .story-prose { color: #e6dcda !important; }
.story-skin-chantilly-noir:not(.story-q-color) .story-quote { color: var(--noir-quote); }
.story-skin-chantilly-noir .story-quote { border-bottom: 1px dotted rgba(210, 179, 148, .42); }

/* 你写下：石榴红竖线 + 酒红纱底 */
.story-skin-chantilly-noir .story-user-turn {
  padding: 12px 16px;
  border-left: 2px solid #9c243b !important;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(90deg, rgba(58, 30, 38, .86), rgba(40, 26, 31, .7));
  box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
}

/* 场景卡：虚线框 + 暗红底 */
.story-skin-chantilly-noir .story-scene {
  padding: 12px 14px;
  border: 1px dashed rgba(194, 189, 191, .3) !important;
  border-radius: 3px;
  background: rgba(58, 14, 22, .26);
}
.story-skin-chantilly-noir .story-scene > div:first-child {
  font-family: ${NOIR_SCRIPT};
  font-size: 13px !important;
  letter-spacing: .04em !important;
  text-transform: none;
  font-weight: 400 !important;
}

/* 输入区：双线框墨黑 */
.story-skin-chantilly-noir .story-compose {
  background: rgba(24, 20, 22, .95) !important;
  border: 1px solid rgba(194, 189, 191, .3) !important;
  border-radius: 6px !important;
  box-shadow: inset 0 0 0 3px rgba(19, 16, 17, .9), inset 0 0 0 4px rgba(194, 189, 191, .1) !important;
}
.story-skin-chantilly-noir .story-compose textarea { font-family: ${NOIR_SERIF}; color: var(--story-ink); }
.story-skin-chantilly-noir .story-compose textarea::placeholder { color: #857479; font-style: italic; }
.story-skin-chantilly-noir .story-send-button:not(.bg-rose-600),
.story-skin-chantilly-noir .story-quick-preset button {
  background: ${NOIR_GEM} !important;
  color: #f7e9ec !important;
  border: 1px solid rgba(231, 201, 207, .45);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .5), 0 0 12px rgba(194, 58, 85, .35);
}

/* 剧情专属区块在深底上的配色补丁 */
.story-skin-chantilly-noir .border-violet-300 { border-color: rgba(156, 36, 59, .7) !important; }
.story-skin-chantilly-noir .border-violet-600, .story-skin-chantilly-noir .border-violet-700 { border-color: #c23a55 !important; }
.story-skin-chantilly-noir .accent-violet-600, .story-skin-chantilly-noir .accent-rose-500 { accent-color: #b3304a; }
.story-skin-chantilly-noir .bg-violet-400 { background-color: #c23a55 !important; }
.story-skin-chantilly-noir .ring-stone-100 { --tw-ring-color: #1b1718 !important; }
.story-skin-chantilly-noir .border-stone-100 { border-color: #1b1718 !important; }
.story-skin-chantilly-noir .text-violet-900 { color: #f1d9df !important; }
.story-skin-chantilly-noir .text-violet-300 { color: rgba(217, 143, 160, .55) !important; }
.story-skin-chantilly-noir .divide-violet-100 > :not([hidden]) ~ :not([hidden]),
.story-skin-chantilly-noir .divide-rose-100 > :not([hidden]) ~ :not([hidden]),
.story-skin-chantilly-noir .divide-amber-100 > :not([hidden]) ~ :not([hidden]) { border-color: var(--story-line) !important; }
.story-skin-chantilly-noir .bg-rose-50 { background-color: rgba(120, 30, 50, .35) !important; }
.story-skin-chantilly-noir .border-rose-300 { border-color: rgba(244, 168, 189, .4) !important; }
.story-skin-chantilly-noir .bg-amber-50, .story-skin-chantilly-noir .bg-amber-100 { background-color: rgba(120, 88, 40, .3) !important; }
.story-skin-chantilly-noir .text-amber-700, .story-skin-chantilly-noir .text-amber-600 { color: #dcb983 !important; }
.story-skin-chantilly-noir .border-amber-200 { border-color: rgba(220, 185, 131, .3) !important; }
.story-skin-chantilly-noir .bg-slate-900 { background-color: #8e1f35 !important; color: #f7e9ec !important; }
.story-skin-chantilly-noir .bg-slate-800 { background-color: #2a2326 !important; }
.story-skin-chantilly-noir .border-slate-800 { border-color: #2a2326 !important; }
.story-skin-chantilly-noir h2.font-serif { font-family: ${NOIR_SERIF}; letter-spacing: .04em; }
`;

export const STORY_SKINS: StorySkin[] = [
    {
        id: 'classic',
        name: '经典',
        subtitle: '素雅 / 花里胡哨，可切明暗',
        css: '',
    },
    {
        id: 'chantilly-noir',
        name: '绮夜暗香',
        subtitle: 'Chantilly Noir · 黑蕾丝与石榴石',
        color: 'dark',
        thumb: chantillyNoirRose,
        css: CHANTILLY_NOIR_CSS,
    },
];

export const STORY_SKIN_CSS = STORY_SKINS.map(skin => skin.css).join('\n');

export const readStorySkinId = (value: unknown): StorySkinId =>
    STORY_SKINS.some(skin => skin.id === value) ? value as StorySkinId : 'classic';

export const findStorySkin = (id: StorySkinId): StorySkin => STORY_SKINS.find(skin => skin.id === id) || STORY_SKINS[0];
