/**
 * 剧情模式专用主题（皮肤）。
 *
 * 和糯叽机美化不同：这里的 CSS 直接写给剧情页自己的结构（.story-safe-header / .story-turn /
 * .story-scene …），不需要套一层别家的 DOM。所有规则都挂在 .story-skin-<id> 下，只在剧情里生效。
 *
 * 装饰（蕾丝花边、石榴石、角花、胶带、贴纸）全部用内联 SVG / 渐变画，不依赖外部图床——校园网、图床挂掉都不影响。
 * 壁纸随 App 一起打包（assets/story-skins/）。
 */
import chantillyNoirBg from '../../../assets/story-skins/chantilly-noir-bg.jpg';
import chantillyNoirRose from '../../../assets/story-skins/chantilly-noir-rose.jpg';
import otakuDiaryBg from '../../../assets/story-skins/otaku-diary-bg.jpg';
import otakuDiaryWide from '../../../assets/story-skins/otaku-diary-wide.jpg';
import cocoBg from '../../../assets/story-skins/coco-bg.jpg';
import cocoWide from '../../../assets/story-skins/coco-wide.jpg';
import cocoPlain from '../../../assets/story-skins/coco-plain.webp';
import atLargeBg from '../../../assets/story-skins/at-large-bg.jpg';
import atLargeWide from '../../../assets/story-skins/at-large-wide.jpg';
import memoBg from '../../../assets/story-skins/memo-bg.jpg';
import memoThumb from '../../../assets/story-skins/memo-thumb.jpg';
import moonNightBg from '../../../assets/story-skins/moon-night-bg.jpg';
import moonNightWide from '../../../assets/story-skins/moon-night-wide.jpg';
import opiumCity from '../../../assets/story-skins/opium-city.jpg';
import opiumGlitter from '../../../assets/story-skins/opium-glitter.jpg';
import opiumGalaxy from '../../../assets/story-skins/opium-galaxy.jpg';

export type StorySkinId = 'classic' | 'chantilly-noir' | 'otaku-diary' | 'coco' | 'at-large' | 'memo' | 'moon-night' | 'black-opium';

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

/* ── 宅女日记 · 多巴胺手账 ─────────────────────────────── */

/** 手绘小星星贴纸（正文卡左下角） */
const DIARY_STARS = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='60' height='56' viewBox='0 0 60 56'><g transform='translate(26 26)'><path d='M0-12 2.9-3.7 11.5-3.7 4.6 1.7 7.4 10.7 0 6 -7.4 10.7 -4.6 1.7 -11.5-3.7 -2.9-3.7Z' fill='#DCD0F4' stroke='#534A41' stroke-width='1.5' stroke-linejoin='round'/></g><g transform='translate(47 13) rotate(-18)'><path d='M0-6.5 1.5-2 6.2-2 2.5 1 4 5.9 0 3.3 -4 5.9 -2.5 1 -6.2-2 -1.5-2Z' fill='#B8ECD8' stroke='#534A41' stroke-width='1.2' stroke-linejoin='round'/></g><circle cx='8' cy='48' r='3.4' fill='#F4C8D8' stroke='#534A41' stroke-width='1.2'/><circle cx='50' cy='44' r='2.3' fill='#FAF0A8' stroke='#534A41' stroke-width='1.1'/></svg>`);
/** 手绘小爱心贴纸（你写下的右下角） */
const DIARY_HEART = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='30' height='28' viewBox='0 0 30 28'><path d='M15 24C6 17.5 2.5 13 2.5 8.5 2.5 5 5.2 2.8 8.3 2.8c2.6 0 4.8 1.5 6.7 4 1.9-2.5 4.1-4 6.7-4 3.1 0 5.8 2.2 5.8 5.7C27.5 13 24 17.5 15 24Z' fill='#F4C8D8' stroke='#534A41' stroke-width='1.5' stroke-linejoin='round'/><path d='M8 7.5c.8-1.2 2-1.7 3-1.6' fill='none' stroke='#fff' stroke-width='1.4' stroke-linecap='round'/></svg>`);
const DIARY_ROUND = `'ZCOOL KuaiLe', 'Yuanti SC', 'PingFang SC', sans-serif`;
const DIARY_HAND = `'Caveat', 'Segoe Print', 'Bradley Hand', cursive`;
/** 彩虹虚线（页眉页脚分隔） */
const DIARY_DASH = 'repeating-linear-gradient(90deg, #F4C8D8 0 16px, transparent 16px 22px, #B8D8EC 22px 38px, transparent 38px 44px, #B8ECD8 44px 60px, transparent 60px 66px, #FAF0A8 66px 82px, transparent 82px 88px, #DCD0F4 88px 104px, transparent 104px 110px)';
/** 和纸胶带条纹 */
const DIARY_TAPE_PINK = 'repeating-linear-gradient(-45deg, rgba(244, 200, 216, .92) 0 5px, rgba(255, 255, 255, .75) 5px 10px)';
const DIARY_TAPE_BLUE = 'repeating-linear-gradient(90deg, rgba(184, 216, 236, .92) 0 6px, rgba(224, 237, 245, .85) 6px 12px)';

const OTAKU_DIARY_CSS = `
.story-skin-otaku-diary {
  --story-bg: #FBF7F0;
  --story-surface: #FDF4E4;
  --story-raised: #FFFDF8;
  --story-ink: #534A41;
  --story-muted: #8A7A70;
  --story-faint: #B9ADA3;
  --story-line: rgba(83, 74, 65, .22);
  --story-soft: #F0E8DC;
  --story-accent: #E58FAC;
  --story-accent-soft: #FBE3EC;
  --story-accent-ink: #B4577A;
  --diary-ink: rgba(83, 74, 65, .85);
  --diary-sketch-1: 255px 15px 225px 15px / 15px 225px 15px 255px;
  --diary-sketch-2: 15px 225px 15px 255px / 255px 15px 225px 15px;
  --diary-sketch-3: 80px 25px 80px 25px / 25px 80px 25px 80px;
  color-scheme: light;
}
.story-skin-otaku-diary.story-theme-page {
  background: #FDF4E4 url("${otakuDiaryBg}") center / cover no-repeat;
}
.story-skin-otaku-diary.story-theme-page::before {
  opacity: 1;
  background: linear-gradient(180deg, rgba(255, 253, 248, .25), rgba(255, 253, 248, .08) 40%, rgba(255, 253, 248, .3));
}
.story-skin-otaku-diary.story-theme-page > .bg-stone-100 { background-color: transparent !important; }

/* 页眉 / 页脚：奶油纸条 + 彩虹虚线 */
.story-skin-otaku-diary .story-safe-header {
  position: relative;
  background: rgba(251, 247, 240, .9) !important;
  border-bottom: 1.5px solid var(--diary-ink) !important;
  box-shadow: 0 4px 0 rgba(54, 43, 32, .08);
}
.story-skin-otaku-diary .story-safe-header::after,
.story-skin-otaku-diary .story-safe-footer::before {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 4px;
  background: ${DIARY_DASH};
  pointer-events: none;
}
.story-skin-otaku-diary .story-safe-header::after { bottom: 5px; }
.story-skin-otaku-diary .story-safe-footer {
  position: relative;
  background: rgba(251, 247, 240, .92) !important;
  border-top: 1.5px solid var(--diary-ink) !important;
}
.story-skin-otaku-diary .story-safe-footer::before { top: 5px; }
.story-skin-otaku-diary .story-safe-header .uppercase {
  font-family: ${DIARY_HAND};
  text-transform: none;
  letter-spacing: .02em;
  font-size: 15px !important;
  font-weight: 700 !important;
  color: #D8806A !important;
  line-height: 1;
}
.story-skin-otaku-diary .story-safe-header h1,
.story-skin-otaku-diary h2.font-serif { font-family: ${DIARY_ROUND}; font-weight: 400; letter-spacing: .04em; }

/* 正文卡：横线手账纸 + 手绘歪边 + 顶部粉色胶带 + 左下星星贴纸 */
.story-skin-otaku-diary .story-turn,
.story-skin-otaku-diary .story-opening {
  position: relative;
  padding: 30px 20px 26px;
  border: 1.5px solid var(--diary-ink) !important;
  border-radius: var(--diary-sketch-1);
  background-color: #FBF7F0;
  background-image:
    repeating-linear-gradient(to bottom, transparent 0 31px, rgba(160, 104, 64, .09) 31px 32px),
    radial-gradient(circle at 85% 88%, rgba(250, 240, 168, .28) 0, transparent 55%),
    radial-gradient(circle at 12% 12%, rgba(184, 216, 236, .25) 0, transparent 45%);
  box-shadow: 5px 5px 0 rgba(54, 43, 32, .16), inset 0 1px 0 rgba(255, 255, 255, .7);
}
.story-skin-otaku-diary .story-turn::before,
.story-skin-otaku-diary .story-opening::before {
  content: '';
  position: absolute;
  top: -9px; left: 50%;
  width: 78px; height: 18px;
  transform: translateX(-50%) rotate(-3deg);
  background: ${DIARY_TAPE_PINK};
  box-shadow: 0 1px 2px rgba(54, 43, 32, .12);
  pointer-events: none;
  z-index: 2;
}
.story-skin-otaku-diary .story-turn::after {
  content: '';
  position: absolute;
  left: 10%; bottom: -26px;
  width: 60px; height: 56px;
  background: ${DIARY_STARS} no-repeat center / contain;
  pointer-events: none;
  z-index: 2;
}
/* 开场卡：顶部一条水彩画 + 标题荧光笔 */
.story-skin-otaku-diary .story-opening { padding-top: 0; overflow: hidden; }
.story-skin-otaku-diary .story-opening::before { top: 8px; }
.story-skin-otaku-diary .story-opening > :first-child::before {
  content: '';
  display: block;
  height: 96px;
  margin: 0 -20px 18px;
  border-bottom: 1.5px dashed rgba(83, 74, 65, .35);
  background: url("${otakuDiaryWide}") center / cover no-repeat;
}
.story-skin-otaku-diary .story-opening h2 {
  display: inline;
  background: linear-gradient(to top, rgba(255, 222, 89, .6) 0 45%, transparent 45%);
  padding: 0 6px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* 正文 */
.story-skin-otaku-diary .story-prose { color: #4A4139 !important; letter-spacing: .02em; }
.story-skin-otaku-diary:not(.story-q-color) .story-quote { color: #9A5A76; }
.story-skin-otaku-diary:not(.story-q-bg) .story-quote {
  background: repeating-linear-gradient(-48deg, rgba(255, 255, 255, .5) 0 6px, rgba(240, 206, 220, .55) 6px 12px);
  border: 1.5px solid rgba(200, 100, 140, .35);
  border-radius: 10px 4px 12px 3px;
  padding: 1px 5px;
  margin: 0 2px;
  box-shadow: 2px 2px 0 rgba(200, 100, 140, .2);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* 你写下：蜜桃横纹便签 + 蓝胶带 + 小爱心 */
.story-skin-otaku-diary .story-user-turn, .story-skin-otaku-diary .story-user-turn.border-violet-300 {
  position: relative;
  margin-left: 12%;
  padding: 18px 18px 16px;
  border: 1.5px solid var(--diary-ink) !important;
  border-radius: var(--diary-sketch-2);
  background:
    repeating-linear-gradient(180deg, transparent 0 12px, rgba(255, 255, 255, .32) 12px 13px),
    #F0D8D2;
  box-shadow: 5px 5px 0 rgba(54, 43, 32, .15), inset 0 1px 0 rgba(255, 255, 255, .8);
}
.story-skin-otaku-diary .story-user-turn::before {
  content: '';
  position: absolute;
  top: -8px; right: 14%;
  width: 54px; height: 15px;
  transform: rotate(4deg);
  background: ${DIARY_TAPE_BLUE};
  box-shadow: 0 1px 2px rgba(54, 43, 32, .12);
}
.story-skin-otaku-diary .story-user-turn::after {
  content: '';
  position: absolute;
  right: -10px; bottom: -12px;
  width: 30px; height: 28px;
  transform: rotate(12deg);
  background: ${DIARY_HEART} no-repeat center / contain;
}
.story-skin-otaku-diary .story-user-turn > div:first-child { font-family: ${DIARY_ROUND}; font-weight: 400 !important; font-size: 11px !important; color: #D8806A !important; }
.story-skin-otaku-diary .story-prose-user { color: #534A41 !important; }

/* 场景卡：浅蓝点点便签 + 抹茶胶带 */
.story-skin-otaku-diary .story-scene {
  position: relative;
  padding: 14px 16px;
  border: 1.5px solid var(--diary-ink) !important;
  border-radius: var(--diary-sketch-3);
  background-color: #E0EDF5;
  background-image: radial-gradient(circle, rgba(156, 130, 208, .2) 1px, transparent 1px);
  background-size: 18px 18px;
  box-shadow: 4px 4px 0 rgba(54, 43, 32, .1);
}
.story-skin-otaku-diary .story-scene::before {
  content: '';
  position: absolute;
  top: -8px; left: 50%;
  width: 44px; height: 13px;
  transform: translateX(-50%) rotate(-2deg);
  background: rgba(194, 216, 178, .9);
  border: 1px solid rgba(54, 43, 32, .15);
  border-radius: 2px;
}
.story-skin-otaku-diary .story-scene > div:first-child {
  font-family: ${DIARY_HAND};
  font-size: 16px !important;
  letter-spacing: .02em !important;
  text-transform: none;
  color: #2D5878 !important;
}

/* 输入区：手绘边便签 + 抹茶发送键 + 柠檬快捷键 */
.story-skin-otaku-diary .story-compose {
  background: #FFFDF8 !important;
  border: 1.5px solid var(--diary-ink) !important;
  border-radius: 18px 8px 16px 10px !important;
  box-shadow: 4px 4px 0 rgba(54, 43, 32, .12) !important;
}
.story-skin-otaku-diary .story-compose textarea::placeholder { color: #B9ADA3; }
.story-skin-otaku-diary .story-send-button:not(.bg-rose-600) {
  background: #C2D8B2 !important;
  color: #534A41 !important;
  border: 1.5px solid var(--diary-ink);
  box-shadow: 2px 2px 0 rgba(54, 43, 32, .18);
}
.story-skin-otaku-diary .story-quick-preset button {
  background: #FAF0A8 !important;
  color: #534A41 !important;
  border: 1.5px solid var(--diary-ink);
  box-shadow: 3px 3px 0 rgba(54, 43, 32, .18) !important;
}

/* 配色补丁 */
.story-skin-otaku-diary .border-violet-300 { border-color: #E58FAC !important; }
.story-skin-otaku-diary .border-violet-600, .story-skin-otaku-diary .border-violet-700 { border-color: #D86C92 !important; }
.story-skin-otaku-diary .bg-violet-400 { background-color: #E58FAC !important; }
.story-skin-otaku-diary .accent-violet-600 { accent-color: #E58FAC; }
.story-skin-otaku-diary .bg-slate-900 { background-color: #534A41 !important; color: #FFFDF8 !important; }
.story-skin-otaku-diary .ring-stone-100 { --tw-ring-color: #FBF7F0 !important; }
`;

/* ── 可可小姐 · Mademoiselle ─────────────────────────────── */

/** 粉色花呢（软呢）：噪点颗粒 + 斜纹交织 */
const COCO_TWEED_GRAIN = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 .97  0 0 0 0 .93  0 0 0 1.1 -.45'/></filter><rect width='90' height='90' filter='url(#n)'/></svg>`);
const COCO_TWEED = `${COCO_TWEED_GRAIN}, repeating-linear-gradient(45deg, rgba(255, 246, 236, .22) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, rgba(150, 82, 98, .2) 0 1px, transparent 1px 5px), repeating-linear-gradient(0deg, rgba(255, 238, 214, .16) 0 1px, transparent 1px 3px), linear-gradient(#DDA9B4, #D6A0AC)`;
/** 浅金花呢（引号小标签用） */
const COCO_TWEED_GOLD = `repeating-linear-gradient(45deg, rgba(255, 255, 255, .45) 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, rgba(191, 160, 106, .18) 0 1px, transparent 1px 4px), #F6EEDF`;
/** 金色珠链 */
const COCO_CHAIN = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='10' viewBox='0 0 16 10'><defs><radialGradient id='g' cx='.35' cy='.3' r='.75'><stop offset='0' stop-color='#fff3d1'/><stop offset='.45' stop-color='#dfc28c'/><stop offset='1' stop-color='#886d3b'/></radialGradient></defs><path d='M0 5h16' stroke='#bfa06a' stroke-width='1'/><circle cx='8' cy='5' r='3.6' fill='url(#g)'/><circle cx='0' cy='5' r='1.4' fill='#dfc28c'/><circle cx='16' cy='5' r='1.4' fill='#dfc28c'/></svg>`);
/** 山茶花线稿（底纹和徽章用） */
const cocoCamellia = (stroke: string, width: number, opacity = 1): string => svg(`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${width}' viewBox='0 0 40 40'><g fill='none' stroke='${stroke}' stroke-opacity='${opacity}' stroke-width='1.1'><g transform='translate(20 20)'>${[0, 72, 144, 216, 288].map(r => `<path transform='rotate(${r})' d='M0-3C-5-6-7-13 0-15 7-13 5-6 0-3Z'/>`).join('')}${[36, 108, 180, 252, 324].map(r => `<path transform='rotate(${r})' d='M0-2C-3-4-4-8 0-9 4-8 3-4 0-2Z'/>`).join('')}<circle r='2.2'/></g></g></svg>`);
const COCO_CAMELLIA_TILE = cocoCamellia('#c9ae84', 40, .22);
const COCO_GOLD = 'radial-gradient(circle at 34% 28%, #fff3d1 0, #f4e3b1 18%, #dfc28c 48%, #bfa06a 78%, #886d3b 100%)';
const COCO_PEARL = 'radial-gradient(circle at 35% 30%, #fff 0, #fbf6f1 30%, #e8ddd6 70%, #c9b8b0 100%)';
const COCO_DISPLAY = `'Didot', 'Bodoni 72', 'DM Serif Display', 'Playfair Display', 'Songti SC', serif`;

const COCO_CSS = `
.story-skin-coco {
  --story-bg: #F7F3EC;
  --story-surface: #FBF8F3;
  --story-raised: #FFFDFA;
  --story-ink: #1D1D1F;
  --story-muted: #877564;
  --story-faint: #BCAB98;
  --story-line: rgba(191, 160, 106, .35);
  --story-soft: #F1E8DC;
  --story-accent: #C98A98;
  --story-accent-soft: #F6E4E8;
  --story-accent-ink: #A0606F;
  --coco-gold: #DBC9AB;
  --coco-gold-deep: #BFA06A;
  color-scheme: light;
}
/* 列表、编辑等页面用纯菱格（字多，背景要素净）；只有剧情进行中的页面铺带徽标的那张 */
.story-skin-coco.story-theme-page {
  background: #F3DDD2 url("${cocoPlain}") center / cover no-repeat;
}
.story-skin-coco.story-theme-page > .story-session-page.bg-stone-100 {
  background: #EFD9CF url("${cocoBg}") center 40% / cover no-repeat !important;
}
.story-skin-coco.story-theme-page::before {
  opacity: 1;
  background: linear-gradient(180deg, rgba(255, 250, 246, .18), rgba(255, 250, 246, 0) 40%, rgba(255, 250, 246, .22));
}
.story-skin-coco.story-theme-page > .bg-stone-100 { background-color: transparent !important; }

/* 页眉 / 页脚：粉色花呢 + 金珠链 */
.story-skin-coco .story-safe-header,
.story-skin-coco .story-safe-footer {
  position: relative;
  background: ${COCO_TWEED} !important;
  border: 0 !important;
  color: #1D1D1F;
}
.story-skin-coco .story-safe-header { box-shadow: 0 6px 14px rgba(136, 109, 59, .18); }
.story-skin-coco .story-safe-header::after,
.story-skin-coco .story-safe-footer::before {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 10px;
  background: ${COCO_CHAIN} repeat-x center / 16px 10px;
  filter: drop-shadow(0 1px 1px rgba(136, 109, 59, .35));
  pointer-events: none;
  z-index: 2;
}
.story-skin-coco .story-safe-header::after { bottom: -5px; }
.story-skin-coco .story-safe-footer::before { top: -5px; }
.story-skin-coco .story-safe-header .text-slate-400,
.story-skin-coco .story-safe-footer .text-slate-400 { color: #6E4B53 !important; }
.story-skin-coco .story-safe-header .text-slate-700 { color: #1D1D1F !important; }
.story-skin-coco .story-safe-header .uppercase {
  font-family: ${COCO_DISPLAY};
  font-style: italic;
  font-weight: 400 !important;
  letter-spacing: .3em !important;
  text-transform: none;
  font-size: 11px !important;
  color: #FFFDF8 !important;
  text-shadow: 0 1px 2px rgba(110, 60, 70, .55);
}
.story-skin-coco .story-safe-header h1 { font-family: ${COCO_DISPLAY}; letter-spacing: .08em; font-weight: 700; }
.story-skin-coco .story-safe-header .text-violet-600 { color: #6E4B53 !important; }

/* 正文卡：象牙衬布 + 花呢包边 + 金线 + 顶部山茶金扣 + 右下珍珠 */
.story-skin-coco .story-turn,
.story-skin-coco .story-opening {
  position: relative;
  padding: 30px 20px 24px;
  border: 6px solid transparent !important;
  border-radius: 18px;
  background:
    ${COCO_CAMELLIA_TILE} center / 46px 46px padding-box,
    linear-gradient(#FBF8F3, #F6F1E9) padding-box,
    ${COCO_TWEED} border-box;
  box-shadow: inset 0 0 0 1px var(--coco-gold), inset 0 0 0 4px rgba(255, 253, 250, .9), inset 0 0 0 5px rgba(219, 201, 171, .6), 0 10px 26px rgba(136, 109, 59, .22);
}
.story-skin-coco .story-turn::before,
.story-skin-coco .story-opening::after {
  content: '';
  position: absolute;
  top: -17px; left: 50%;
  width: 30px; height: 30px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: ${cocoCamellia('#886d3b', 30)} center / 22px 22px no-repeat, ${COCO_GOLD};
  box-shadow: 0 0 0 2px #FFF8EC, 0 0 0 3px var(--coco-gold-deep), 0 3px 6px rgba(136, 109, 59, .35);
  pointer-events: none;
  z-index: 2;
}
.story-skin-coco .story-turn::after {
  content: '';
  position: absolute;
  right: 8px; bottom: 8px;
  width: 22px; height: 14px;
  background: ${COCO_PEARL} 0 3px / 11px 11px no-repeat, ${COCO_PEARL} 12px 0 / 9px 9px no-repeat;
  filter: drop-shadow(0 1px 1px rgba(136, 109, 59, .3));
  pointer-events: none;
}
/* 开场卡：顶部一幅山茶珍珠画 */
.story-skin-coco .story-opening { padding-top: 0; text-align: center; }
.story-skin-coco .story-opening::before {
  content: '';
  display: block;
  height: 150px;
  margin: 0 -20px 20px;
  border-radius: 12px 12px 0 0;
  border-bottom: 1px solid var(--coco-gold);
  background: url("${cocoWide}") center 96% / 150% auto no-repeat;
}
.story-skin-coco .story-opening::after { top: 133px; }
.story-skin-coco .story-opening > :first-child { font-family: ${COCO_DISPLAY}; font-style: italic; text-transform: none; letter-spacing: .3em; font-weight: 400; color: var(--coco-gold-deep) !important; }
.story-skin-coco .story-opening h2 { font-family: ${COCO_DISPLAY}; letter-spacing: .08em; }

/* 正文 */
.story-skin-coco .story-prose { color: #1D1D1F !important; letter-spacing: .02em; }
.story-skin-coco:not(.story-q-color) .story-quote { color: #877564; }
.story-skin-coco:not(.story-q-bg) .story-quote {
  background: ${COCO_TWEED_GOLD};
  border: .5px solid var(--coco-gold-deep);
  border-radius: 5px;
  padding: 0 5px;
  margin: 0 2px;
  box-shadow: inset 0 2px 2px rgba(255, 255, 255, .7), 0 1px 2px rgba(29, 29, 31, .12);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* 你写下：玫瑰粉缎面 + 左侧花呢镶边 */
.story-skin-coco .story-user-turn,
.story-skin-coco .story-user-turn.border-violet-300 {
  position: relative;
  padding: 14px 16px 14px 20px;
  border: 1px solid var(--coco-gold) !important;
  border-radius: 14px;
  background:
    linear-gradient(90deg, rgba(209, 162, 172, 0) 0, rgba(255, 255, 255, .35) 60%, rgba(209, 162, 172, 0) 100%),
    rgba(244, 224, 229, .94);
  box-shadow: inset 6px 0 0 #D6A0AC, inset 7px 0 0 var(--coco-gold), 0 6px 16px rgba(136, 109, 59, .16);
}
.story-skin-coco .story-user-turn > div:first-child { font-family: ${COCO_DISPLAY}; font-style: italic; letter-spacing: .22em !important; color: #A0606F !important; font-weight: 400 !important; }
.story-skin-coco .story-prose-user { color: #3A2E31 !important; }

/* 场景卡：象牙底 + 金色虚线 */
.story-skin-coco .story-scene {
  padding: 12px 14px;
  border: 1.5px dashed var(--coco-gold) !important;
  border-radius: 12px;
  background: rgba(255, 252, 247, .85);
  box-shadow: inset 0 0 0 3px rgba(255, 255, 255, .6);
}
.story-skin-coco .story-scene > div:first-child {
  font-family: ${COCO_DISPLAY};
  font-style: italic;
  font-weight: 400 !important;
  text-transform: none;
  letter-spacing: .3em !important;
  font-size: 11px !important;
  color: var(--coco-gold-deep) !important;
}

/* 输入区：象牙小羊皮 + 金扣发送键 + 黑瓷漆快捷键 */
.story-skin-coco .story-compose {
  background: rgba(253, 250, 245, .96) !important;
  border: 1px solid var(--coco-gold-deep) !important;
  border-radius: 16px !important;
  box-shadow: inset 0 0 0 3px #FFFDFA, inset 0 0 0 4px rgba(219, 201, 171, .55), 0 4px 12px rgba(136, 109, 59, .15) !important;
}
.story-skin-coco .story-compose textarea::placeholder { color: #B79F8E; font-style: italic; }
.story-skin-coco .story-send-button:not(.bg-rose-600) {
  background: ${COCO_GOLD} !important;
  color: #5A4424 !important;
  border-radius: 999px !important;
  box-shadow: 0 0 0 2px #FFF8EC, 0 0 0 3px var(--coco-gold-deep), 0 3px 8px rgba(136, 109, 59, .35);
}
.story-skin-coco .story-quick-preset button {
  background: #1D1D1F !important;
  color: #DFC28C !important;
  border-radius: 999px !important;
  box-shadow: 0 0 0 2px var(--coco-gold), 0 4px 12px rgba(29, 29, 31, .35) !important;
}
.story-skin-coco .story-compose .bg-violet-50 {
  background: ${COCO_TWEED} !important;
  color: #FFFDF8 !important;
  border-color: var(--coco-gold-deep) !important;
  text-shadow: 0 1px 2px rgba(90, 40, 52, .75);
}

/* 配色补丁 */
.story-skin-coco .border-violet-600, .story-skin-coco .border-violet-700 { border-color: #C98A98 !important; }
.story-skin-coco .bg-violet-400 { background-color: #D6A0AC !important; }
.story-skin-coco .accent-violet-600 { accent-color: #C98A98; }
.story-skin-coco .bg-slate-900 { background-color: #1D1D1F !important; color: #DFC28C !important; }
.story-skin-coco .ring-stone-100 { --tw-ring-color: #FBF8F3 !important; }
.story-skin-coco h2.font-serif { font-family: ${COCO_DISPLAY}; letter-spacing: .06em; }
`;

/* ── 在逃共犯 · Wanted ─────────────────────────────── */

const WANTED_MONO = `'Courier Prime', 'American Typewriter', 'Courier New', monospace`;
/** 条形码 */
const WANTED_BARCODE = 'repeating-linear-gradient(90deg, #191919 0 2px, transparent 2px 4px, #191919 4px 7px, transparent 7px 9px, #191919 9px 10px, transparent 10px 14px, #191919 14px 17px, transparent 17px 19px)';
/** 旧纸：中间亮、四周微微发灰 */
const WANTED_PAPER = 'radial-gradient(120% 130% at 50% 38%, #F4F3EE 30%, #E6E3DA)';
/** 直角三线框：外粗 3px 墨线 + 2px 纸隙 + 1px 细线 */
const WANTED_FRAME = 'inset 0 0 0 2px #F4F3EE, inset 0 0 0 3px #191919';

const AT_LARGE_CSS = `
.story-skin-at-large {
  --story-bg: #F4F3EE;
  --story-surface: #EFEDE6;
  --story-raised: #FAF9F5;
  --story-ink: #191919;
  --story-muted: #7D7D7D;
  --story-faint: #AFAFAF;
  --story-line: rgba(25, 25, 25, .2);
  --story-soft: #E4E1D9;
  --story-accent: #8A3024;
  --story-accent-soft: rgba(138, 48, 36, .1);
  --story-accent-ink: #8A3024;
  --wanted-rust: #8A3024;
  color-scheme: light;
}
/* 列表、编辑等字多的页面用素纸；只有剧情进行中的页面铺卷宗壁纸 */
.story-skin-at-large.story-theme-page { background: ${WANTED_PAPER}; }
.story-skin-at-large.story-theme-page::before {
  opacity: 1;
  background: repeating-linear-gradient(0deg, rgba(25, 25, 25, .025) 0 1px, transparent 1px 3px);
}
.story-skin-at-large.story-theme-page > .bg-stone-100 { background-color: transparent !important; }
.story-skin-at-large.story-theme-page > .story-session-page.bg-stone-100 {
  background: #D9D6CE url("${atLargeBg}") center / cover no-repeat !important;
}

/* 页眉：纸面 + 三线 + 黑色警示条 DO NOT APPROACH */
.story-skin-at-large .story-safe-header {
  position: relative;
  margin-bottom: 16px;
  background: #F4F3EE !important;
  border-bottom: 3px solid #191919 !important;
  box-shadow: 0 3px 0 #F4F3EE, 0 4px 0 #191919;
}
.story-skin-at-large .story-safe-header::after {
  content: 'DO NOT APPROACH';
  position: absolute;
  left: 0; right: 0; bottom: -20px;
  height: 14px;
  background: #191919;
  color: #F4F3EE;
  font: 700 9px/14px ${WANTED_MONO};
  letter-spacing: .4em;
  text-align: center;
  pointer-events: none;
}
.story-skin-at-large .story-safe-header .uppercase {
  font-family: ${WANTED_MONO};
  letter-spacing: .3em !important;
  color: #8A3024 !important;
  font-size: 10px !important;
}
.story-skin-at-large .story-safe-header h1 { font-weight: 900; letter-spacing: .06em; }
.story-skin-at-large .story-safe-footer {
  background: #F4F3EE !important;
  border-top: 3px solid #191919 !important;
  box-shadow: 0 -3px 0 #F4F3EE, 0 -4px 0 #191919;
}

/* 所有圆角一刀切成直角 */
.story-skin-at-large .rounded-full:not(img),
.story-skin-at-large .rounded-2xl,
.story-skin-at-large .rounded-xl,
.story-skin-at-large .rounded-lg { border-radius: 0 !important; }

/* 正文卡：卷宗三线框 + 四角取景框 + 顶部锈红图钉 */
.story-skin-at-large .story-turn,
.story-skin-at-large .story-opening {
  position: relative;
  padding: 28px 20px 24px;
  border: 3px solid #191919 !important;
  background: ${WANTED_PAPER};
  box-shadow: ${WANTED_FRAME}, 6px 8px 18px rgba(0, 0, 0, .28);
}
.story-skin-at-large .story-turn::before,
.story-skin-at-large .story-turn::after {
  content: '';
  position: absolute;
  width: 14px; height: 14px;
  pointer-events: none;
}
.story-skin-at-large .story-turn::before { left: 10px; top: 10px; border-left: 1.5px solid #7D7D7D; border-top: 1.5px solid #7D7D7D; }
.story-skin-at-large .story-turn::after { right: 10px; bottom: 10px; border-right: 1.5px solid #7D7D7D; border-bottom: 1.5px solid #7D7D7D; }

/* 开场卡：通缉令海报 + 右下角 CASE OPEN 印章 */
.story-skin-at-large .story-opening { padding-top: 0; padding-bottom: 44px; text-align: center; overflow: hidden; }
.story-skin-at-large .story-opening::before {
  content: '';
  display: block;
  height: 170px;
  margin: 0 -20px 18px;
  border-bottom: 3px double #191919;
  background: url("${atLargeWide}") center 45% / 175% auto no-repeat;
}
.story-skin-at-large .story-opening::after {
  content: 'CASE OPEN';
  position: absolute;
  right: 14px; bottom: 12px;
  padding: 2px 8px;
  border: 2px solid #8A3024;
  color: #8A3024;
  font: 700 11px/1.2 ${WANTED_MONO};
  letter-spacing: .2em;
  transform: rotate(-12deg);
  opacity: .85;
  pointer-events: none;
}
.story-skin-at-large .story-opening > :first-child { font-family: ${WANTED_MONO}; letter-spacing: .3em; color: #7D7D7D !important; }
.story-skin-at-large .story-opening h2 { font-family: inherit; font-weight: 900; letter-spacing: .08em; }

/* 正文：墨黑字，对白锈红 */
.story-skin-at-large .story-prose { color: #191919 !important; }
.story-skin-at-large:not(.story-q-color) .story-quote { color: #8A3024; }

/* 你写下：灰底口供条 + 左侧墨黑竖线 */
.story-skin-at-large .story-user-turn,
.story-skin-at-large .story-user-turn.border-violet-300 {
  position: relative;
  padding: 12px 16px;
  border-left: 5px solid #191919 !important;
  background: rgba(214, 211, 203, .92);
  box-shadow: 4px 5px 14px rgba(0, 0, 0, .2);
}
.story-skin-at-large .story-user-turn > div:first-child { font-family: ${WANTED_MONO}; letter-spacing: .3em !important; color: #8A3024 !important; }
.story-skin-at-large .story-user-turn::after {
  content: 'CONFIDENTIAL';
  position: absolute;
  right: 10px; top: 8px;
  padding: 0 5px;
  border: 1.5px solid rgba(138, 48, 36, .75);
  color: rgba(138, 48, 36, .8);
  font: 700 8px/1.5 ${WANTED_MONO};
  letter-spacing: .15em;
  transform: rotate(-6deg);
  pointer-events: none;
}
.story-skin-at-large .story-prose-user { color: #191919 !important; }

/* 场景卡：档案栏 —— 黑底标题条 + 细线框 */
.story-skin-at-large .story-scene {
  padding: 0 14px 12px;
  border: 1px solid #191919 !important;
  background: rgba(250, 249, 245, .7);
}
.story-skin-at-large .story-scene > div:first-child {
  margin: 0 -14px 0;
  padding: 4px 14px;
  background: #191919;
  color: #F4F3EE !important;
  font-family: ${WANTED_MONO};
  letter-spacing: .3em !important;
}
.story-skin-at-large .story-scene > div:first-child::after {
  content: '';
  margin-left: auto;
  width: 44px; height: 10px;
  background: ${WANTED_BARCODE};
  filter: invert(1);
}
.story-skin-at-large .story-scene .text-slate-400 { font-family: ${WANTED_MONO}; letter-spacing: .12em; color: #8A3024 !important; }

/* 输入区：直角纸条 + 墨黑发送键 + 锈红快捷键 */
.story-skin-at-large .story-compose {
  background: #FAF9F5 !important;
  border: 1.5px solid #191919 !important;
  box-shadow: 3px 3px 0 #191919 !important;
}
.story-skin-at-large .story-compose textarea::placeholder { color: #9A968C; font-family: ${WANTED_MONO}; }
.story-skin-at-large .story-send-button:not(.bg-rose-600) { background: #191919 !important; color: #F4F3EE !important; }
.story-skin-at-large .story-quick-preset button { background: #8A3024 !important; color: #F4F3EE !important; box-shadow: 3px 3px 0 #191919 !important; }
.story-skin-at-large .story-compose .bg-violet-50 { background: transparent !important; border-color: #191919 !important; color: #191919 !important; font-family: ${WANTED_MONO}; }

/* 配色补丁 */
.story-skin-at-large .border-violet-600, .story-skin-at-large .border-violet-700 { border-color: #8A3024 !important; }
.story-skin-at-large .bg-violet-400 { background-color: #8A3024 !important; }
.story-skin-at-large .accent-violet-600 { accent-color: #8A3024; }
.story-skin-at-large .bg-slate-900 { background-color: #191919 !important; color: #F4F3EE !important; }
.story-skin-at-large .ring-stone-100 { --tw-ring-color: #F4F3EE !important; }
.story-skin-at-large h2.font-serif { font-family: inherit; font-weight: 900; letter-spacing: .06em; }
`;

/* ── MEMO · 雾蓝留白 ─────────────────────────────── */

const MEMO_LABEL = `'Avenir Next', 'Helvetica Neue', 'Quicksand', sans-serif`;
const MEMO_HAND = `'Snell Roundhand', 'Caveat', 'Segoe Script', cursive`;
/** 十字星点（卡片四角的小 + 号） */
const MEMO_CROSS = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M6 1v10M1 6h10' stroke='#8CABC0' stroke-width='.9'/></svg>`);

const MEMO_CSS = `
.story-skin-memo {
  --story-bg: #EAF0F2;
  --story-surface: #EDF3F2;
  --story-raised: #F6F9F9;
  --story-ink: #5E7280;
  --story-muted: #889AA3;
  --story-faint: #AFBFC6;
  --story-line: rgba(140, 171, 192, .45);
  --story-soft: #DBE8EE;
  --story-accent: #689187;
  --story-accent-soft: #DFE9E8;
  --story-accent-ink: #5F887E;
  --memo-bar: #BED5E0;
  color-scheme: light;
}
/* 字多的页面：素净雾蓝；剧情进行中才铺壁纸 */
.story-skin-memo.story-theme-page { background: linear-gradient(180deg, #E4EDF0, #EAF1F0 60%, #E1ECEA); }
.story-skin-memo.story-theme-page > .bg-stone-100 { background-color: transparent !important; }
.story-skin-memo.story-theme-page > .story-session-page.bg-stone-100 {
  background: #E6EEEF url("${memoBg}") center / cover no-repeat !important;
}
.story-skin-memo .story-prose,
.story-skin-memo .story-prose-user { letter-spacing: .06em; }

/* 页眉：雾蓝导航栏 + 细虚线 */
.story-skin-memo .story-safe-header {
  background: rgba(234, 240, 242, .94) !important;
  border-bottom: 1px dashed rgba(140, 171, 192, .8) !important;
}
.story-skin-memo .story-safe-header .uppercase {
  font-family: ${MEMO_LABEL};
  font-weight: 500 !important;
  letter-spacing: .32em !important;
  color: #889AA3 !important;
}
.story-skin-memo .story-safe-header h1 { font-weight: 400; letter-spacing: .14em; color: #6A7D8C; }
.story-skin-memo .story-safe-footer {
  background: rgba(190, 213, 224, .92) !important;
  border-top: 0 !important;
}

/* 正文卡：薄荷灰纸片，无圆角无阴影，四角小十字 */
.story-skin-memo .story-turn,
.story-skin-memo .story-opening {
  position: relative;
  padding: 26px 20px 22px;
  background: rgba(223, 233, 232, .9);
  border: 0 !important;
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}
.story-skin-memo .story-turn::before,
.story-skin-memo .story-turn::after {
  content: '';
  position: absolute;
  width: 12px; height: 12px;
  background: ${MEMO_CROSS} no-repeat center / contain;
  pointer-events: none;
}
.story-skin-memo .story-turn::before { left: 6px; top: 6px; }
.story-skin-memo .story-turn::after { right: 6px; bottom: 6px; }
.story-skin-memo .story-prose { color: #5E7280 !important; }

/* 开场卡：壁纸底部那封系丝带的 SECRET 信 */
.story-skin-memo .story-opening { padding-top: 0; overflow: hidden; }
.story-skin-memo .story-opening::before {
  content: '';
  display: block;
  height: 150px;
  margin: 0 -20px 20px;
  background: url("${memoBg}") 0 86% / 200% auto no-repeat;
  border-bottom: 1px dashed rgba(140, 171, 192, .8);
}
.story-skin-memo .story-opening > :first-child { font-family: ${MEMO_LABEL}; letter-spacing: .32em; color: #889AA3 !important; }
.story-skin-memo .story-opening h2 { font-weight: 300; letter-spacing: .2em; color: #6A7D8C; }

/* 引号：左侧薄荷细线 + 斜体 + 下划虚线，和原主题一致 */
.story-skin-memo:not(.story-q-color) .story-quote { color: #6C9488; }
.story-skin-memo .story-quote {
  font-style: italic;
  border-left: 2px solid #A7C0B8;
  padding: 0 3px;
  margin-left: 3px;
  text-decoration: underline dashed rgba(140, 171, 192, .7);
  text-underline-offset: 4px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* 你写下：右上角「ME / 你写下」，竖线在右 */
.story-skin-memo .story-user-turn,
.story-skin-memo .story-user-turn.border-violet-300 {
  padding: 10px 14px 10px 18px;
  border-left: 0 !important;
  border-right: 2px solid #8CABC0 !important;
  background: rgba(237, 243, 242, .88);
}
.story-skin-memo .story-user-turn > div:first-child { text-align: right; font-family: ${MEMO_LABEL}; font-style: italic; letter-spacing: .3em !important; color: #889AA3 !important; font-weight: 500 !important; }
.story-skin-memo .story-user-turn > div:first-child::before { content: 'ME / '; }
.story-skin-memo .story-prose-user { color: #6C9488 !important; font-style: italic; }

/* 场景卡：只留上下两道虚线 */
.story-skin-memo .story-scene {
  border-top: 1px dashed rgba(140, 171, 192, .8) !important;
  border-bottom: 1px dashed rgba(140, 171, 192, .8) !important;
}
.story-skin-memo .story-scene > div:first-child {
  font-family: ${MEMO_HAND};
  font-size: 15px !important;
  font-weight: 400 !important;
  text-transform: none;
  letter-spacing: .04em !important;
  color: #689187 !important;
}

/* 输入区：雾白条 + 只有线条的按钮 */
.story-skin-memo .story-compose {
  background: rgba(246, 249, 249, .9) !important;
  border: 0 !important;
  border-bottom: 1px solid #8CABC0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
.story-skin-memo .story-compose textarea { letter-spacing: .06em; }
.story-skin-memo .story-compose textarea::placeholder { color: #9DB0B9; font-style: italic; }
.story-skin-memo .story-send-button:not(.bg-rose-600) { background: transparent !important; color: #689187 !important; border: 1px solid #689187; border-radius: 0 !important; }
.story-skin-memo .story-quick-preset button { background: rgba(190, 213, 224, .95) !important; color: #5F887E !important; border-radius: 0 !important; box-shadow: none !important; border: 1px solid #8CABC0; }
.story-skin-memo .story-compose .bg-violet-50 { background: transparent !important; border-color: #8CABC0 !important; color: #689187 !important; border-radius: 0 !important; }

/* 配色补丁 */
.story-skin-memo .border-violet-600, .story-skin-memo .border-violet-700 { border-color: #689187 !important; }
.story-skin-memo .bg-violet-400 { background-color: #8CABC0 !important; }
.story-skin-memo .accent-violet-600 { accent-color: #689187; }
.story-skin-memo .bg-slate-900 { background-color: #689187 !important; color: #F6F9F9 !important; }
.story-skin-memo .ring-stone-100 { --tw-ring-color: #EAF0F2 !important; }
.story-skin-memo h2.font-serif { font-family: inherit; font-weight: 300; letter-spacing: .14em; }
`;

/* ── 十三月夜 · Night ─────────────────────────────── */

const MOON_SERIF = `'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', serif`;
/** 菱格星光带（页眉页脚边缘） */
const MOON_LATTICE = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='28' height='14' viewBox='0 0 28 14'><path d='M0 7 7 0 14 7 21 0 28 7M0 7 7 14 14 7 21 14 28 7' fill='none' stroke='#9cc3ff' stroke-opacity='.45' stroke-width='.8'/><path d='M14 4.6 14.6 6.4 16.4 7 14.6 7.6 14 9.4 13.4 7.6 11.6 7 13.4 6.4Z' fill='#eaf3ff'/><circle cx='0' cy='7' r='.9' fill='#cfe2ff'/><circle cx='28' cy='7' r='.9' fill='#cfe2ff'/></svg>`);
/** 细碎星点（字多的页面用，代替整张星空图） */
const MOON_STARS = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><g fill='#dbe8ff'><circle cx='12' cy='20' r='.8' opacity='.7'/><circle cx='58' cy='8' r='.5' opacity='.5'/><circle cx='97' cy='41' r='1' opacity='.8'/><circle cx='140' cy='18' r='.6' opacity='.6'/><circle cx='30' cy='77' r='.5' opacity='.5'/><circle cx='75' cy='102' r='.8' opacity='.7'/><circle cx='121' cy='88' r='.5' opacity='.4'/><circle cx='150' cy='131' r='.9' opacity='.7'/><circle cx='44' cy='140' r='.6' opacity='.6'/><circle cx='102' cy='150' r='.4' opacity='.5'/></g><path d='M97 36.5 97.7 40.3 101.5 41 97.7 41.7 97 45.5 96.3 41.7 92.5 41 96.3 40.3Z' fill='#fff' opacity='.8'/></svg>`);
/** 新月：透明圆 + 内阴影切出月牙 */
const MOON_CRESCENT = 'box-shadow: inset 7px -3px 0 0 #dce8ff; filter: drop-shadow(0 0 6px rgba(146, 229, 255, .75));';

const MOON_NIGHT_CSS = `
.story-skin-moon-night {
  --story-bg: #0E1A38;
  --story-surface: #14244A;
  --story-raised: #1B2F5C;
  --story-ink: #BAD5EE;
  --story-muted: #8DA6CC;
  --story-faint: #5F76A3;
  --story-line: rgba(110, 139, 195, .45);
  --story-soft: #22386A;
  --story-accent: #5772FF;
  --story-accent-soft: rgba(87, 114, 255, .22);
  --story-accent-ink: #9CC3FF;
  color-scheme: dark;
}
/* 字多的页面：深蓝夜空 + 细碎星点；剧情进行中铺月夜窗景 */
.story-skin-moon-night.story-theme-page {
  background: ${MOON_STARS} 0 0 / 160px 160px, radial-gradient(120% 70% at 70% 0%, #2A4382 0%, #14244A 45%, #0A1430 100%);
}
.story-skin-moon-night.story-theme-page > .bg-stone-100 { background-color: transparent !important; }
.story-skin-moon-night.story-theme-page > .story-session-page.bg-stone-100 {
  background: #0E1A38 url("${moonNightBg}") center / cover no-repeat !important;
}

/* 页眉页脚：深蓝玻璃 + 菱格星光带 */
.story-skin-moon-night .story-safe-header,
.story-skin-moon-night .story-safe-footer {
  position: relative;
  background: rgba(20, 36, 74, .86) !important;
  border: 0 !important;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.story-skin-moon-night .story-safe-header::after,
.story-skin-moon-night .story-safe-footer::before {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 14px;
  background: ${MOON_LATTICE} repeat-x center / 28px 14px, linear-gradient(rgba(37, 60, 107, .9), rgba(37, 60, 107, .9));
  border-top: 1px solid rgba(156, 195, 255, .35);
  border-bottom: 1px solid rgba(156, 195, 255, .35);
  pointer-events: none;
}
.story-skin-moon-night .story-safe-header::after { bottom: -14px; }
.story-skin-moon-night .story-safe-footer::before { top: -14px; }
.story-skin-moon-night .story-safe-header .uppercase {
  font-family: ${MOON_SERIF};
  font-weight: 400 !important;
  letter-spacing: .5em !important;
  color: #7FA6E8 !important;
}
.story-skin-moon-night .story-safe-header h1 { font-family: ${MOON_SERIF}; letter-spacing: .1em; color: #DCE8FF; text-shadow: 0 0 8px rgba(146, 229, 255, .45); }

/* 正文卡：夜色玻璃 + 细光边 + 顶部一弯新月 */
.story-skin-moon-night .story-turn,
.story-skin-moon-night .story-opening {
  position: relative;
  margin-top: 8px;
  padding: 30px 18px 20px;
  background: rgba(7, 19, 51, .74);
  border: 1px solid rgba(110, 139, 195, .7) !important;
  border-radius: 4px;
  box-shadow: 0 0 14px rgba(146, 229, 255, .16), inset 0 0 22px rgba(87, 114, 255, .12);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
.story-skin-moon-night .story-turn::before {
  content: '';
  position: absolute;
  top: -15px; left: 50%;
  width: 30px; height: 30px;
  margin-left: -15px;
  border-radius: 50%;
  ${MOON_CRESCENT}
  transform: rotate(-20deg);
  pointer-events: none;
}
.story-skin-moon-night .story-turn::after {
  content: '✦  ✦';
  position: absolute;
  left: 10px; top: 6px;
  color: #CFE2FF;
  font-size: 9px;
  letter-spacing: .3em;
  text-shadow: 0 0 6px rgba(146, 229, 255, .9);
  pointer-events: none;
}
.story-skin-moon-night .story-prose {
  font-family: ${MOON_SERIF};
  color: #D2E4F6 !important;
  letter-spacing: .03em;
  text-shadow: 0 0 6px rgba(146, 229, 255, .22);
}

/* 开场卡：雪松林与流星 */
.story-skin-moon-night .story-opening { padding-top: 0; overflow: hidden; text-align: center; }
.story-skin-moon-night .story-opening::before {
  content: '';
  display: block;
  height: 160px;
  margin: 0 -18px 20px;
  background: linear-gradient(180deg, rgba(7, 19, 51, 0) 55%, rgba(7, 19, 51, .95)), url("${moonNightWide}") 56% 62% / 175% auto no-repeat;
}
.story-skin-moon-night .story-opening > :first-child { font-family: ${MOON_SERIF}; letter-spacing: .5em; color: #7FA6E8 !important; }
.story-skin-moon-night .story-opening h2 { font-family: ${MOON_SERIF}; letter-spacing: .1em; color: #EAF3FF; text-shadow: 0 0 10px rgba(146, 229, 255, .5); }

/* 对白：发光的蓝色胶囊 */
.story-skin-moon-night:not(.story-q-color) .story-quote { color: #E6EFFF; }
.story-skin-moon-night:not(.story-q-bg) .story-quote {
  background: linear-gradient(180deg, rgba(87, 114, 255, .38), rgba(55, 80, 190, .32));
  border: 1px solid rgba(156, 195, 255, .5);
  border-radius: 9px;
  padding: 1px 6px;
  margin: 0 2px;
  box-shadow: 0 0 8px rgba(120, 160, 255, .45);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* 你写下：浅一层的蓝玻璃 + 左侧蓝光竖线 */
.story-skin-moon-night .story-user-turn,
.story-skin-moon-night .story-user-turn.border-violet-300 {
  padding: 12px 16px;
  border-left: 3px solid #5772FF !important;
  background: rgba(107, 133, 201, .42);
  border-radius: 0 4px 4px 0;
  box-shadow: -2px 0 10px rgba(87, 114, 255, .6);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}
.story-skin-moon-night .story-user-turn > div:first-child { color: #9CC3FF !important; letter-spacing: .4em !important; }
.story-skin-moon-night .story-prose-user { font-family: ${MOON_SERIF}; color: #E3EEFA !important; }

/* 场景卡：代码块式细框 */
.story-skin-moon-night .story-scene {
  padding: 12px 14px;
  border: 1px solid rgba(186, 213, 238, .45) !important;
  background: rgba(37, 60, 107, .45);
  border-radius: 2px;
}
.story-skin-moon-night .story-scene > div:first-child { font-family: ${MOON_SERIF}; letter-spacing: .5em !important; color: #9CC3FF !important; font-weight: 400 !important; }

/* 输入区与按钮：菱形微光 */
.story-skin-moon-night .story-compose {
  background: rgba(7, 19, 51, .8) !important;
  border: 1px solid rgba(110, 139, 195, .8) !important;
  border-radius: 4px !important;
  box-shadow: 0 0 10px rgba(146, 229, 255, .15) !important;
}
.story-skin-moon-night .story-compose textarea { color: #D2E4F6; font-family: ${MOON_SERIF}; }
.story-skin-moon-night .story-compose textarea::placeholder { color: #5F76A3; }
.story-skin-moon-night .story-send-button:not(.bg-rose-600),
.story-skin-moon-night .story-quick-preset button {
  background: radial-gradient(circle at 50% 35%, #3B5CA8, #1B2F5C 70%) !important;
  color: #EAF3FF !important;
  border: 1px solid rgba(156, 195, 255, .75);
  border-radius: 999px !important;
  box-shadow: 0 0 10px rgba(146, 229, 255, .45), inset 0 0 6px rgba(146, 229, 255, .3) !important;
}
.story-skin-moon-night .story-compose .bg-violet-50 { background: rgba(87, 114, 255, .2) !important; border-color: rgba(156, 195, 255, .5) !important; color: #CFE2FF !important; }

/* 配色补丁 */
.story-skin-moon-night .border-violet-600, .story-skin-moon-night .border-violet-700 { border-color: #9CC3FF !important; }
.story-skin-moon-night .bg-violet-400 { background-color: #9CC3FF !important; }
.story-skin-moon-night .accent-violet-600 { accent-color: #5772FF; }
.story-skin-moon-night .text-violet-900 { color: #EAF3FF !important; }
.story-skin-moon-night .bg-slate-900 { background-color: #5772FF !important; color: #F4F8FF !important; }
.story-skin-moon-night .bg-slate-800 { background-color: #22386A !important; }
.story-skin-moon-night .border-slate-800 { border-color: #22386A !important; }
.story-skin-moon-night .border-stone-100 { border-color: #14244A !important; }
.story-skin-moon-night .ring-stone-100 { --tw-ring-color: #14244A !important; }
.story-skin-moon-night .text-amber-700, .story-skin-moon-night .text-amber-600 { color: #F2D08A !important; }
.story-skin-moon-night .border-amber-200 { border-color: rgba(242, 208, 138, .3) !important; }
.story-skin-moon-night .bg-amber-50, .story-skin-moon-night .bg-amber-100 { background-color: rgba(120, 95, 40, .3) !important; }
.story-skin-moon-night h2.font-serif { font-family: ${MOON_SERIF}; letter-spacing: .06em; }
`;

/* ── 黑鸦片 · Own the night ─────────────────────────────── */

/** 玫瑰 → 紫的霓光渐变（按钮、光边） */
const OPIUM_NEON = 'linear-gradient(135deg, #D06456 0%, #BF468D 45%, #7752C5 100%)';
/** 闪粉：随机细点，叠在卡片上 */
const OPIUM_GLITTER = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><g fill='#f3d6e6'><circle cx='9' cy='14' r='.6' opacity='.35'/><circle cx='44' cy='6' r='.4' opacity='.25'/><circle cx='83' cy='27' r='.7' opacity='.4'/><circle cx='111' cy='9' r='.5' opacity='.3'/><circle cx='24' cy='58' r='.5' opacity='.3'/><circle cx='66' cy='73' r='.6' opacity='.35'/><circle cx='101' cy='64' r='.4' opacity='.25'/><circle cx='15' cy='103' r='.7' opacity='.35'/><circle cx='57' cy='112' r='.4' opacity='.25'/><circle cx='93' cy='98' r='.6' opacity='.3'/></g></svg>`);

const BLACK_OPIUM_CSS = `
.story-skin-black-opium {
  --story-bg: #141018;
  --story-surface: #1D1823;
  --story-raised: #261F27;
  --story-ink: #D6D0D9;
  --story-muted: #A39AA8;
  --story-faint: #6C6270;
  --story-line: rgba(255, 255, 255, .13);
  --story-soft: #2C2430;
  --story-accent: #BF468D;
  --story-accent-soft: rgba(191, 70, 141, .18);
  --story-accent-ink: #E08DB7;
  color-scheme: dark;
}
/* 字多的页面：黑色闪粉岩 + 压暗；剧情进行中：城市夜景 */
.story-skin-black-opium.story-theme-page {
  background: linear-gradient(rgba(12, 9, 14, .55), rgba(12, 9, 14, .7)), #0E0B10 url("${opiumGlitter}") center / cover no-repeat;
}
.story-skin-black-opium.story-theme-page > .bg-stone-100 { background-color: transparent !important; }
.story-skin-black-opium.story-theme-page > .story-session-page.bg-stone-100 {
  background: linear-gradient(180deg, rgba(119, 82, 197, .12), rgba(12, 9, 14, 0) 40%), #0B0A0C url("${opiumCity}") center / cover no-repeat !important;
}

/* 页眉页脚：磨砂黑玻璃 + 底部一道玫瑰紫霓光 */
.story-skin-black-opium .story-safe-header,
.story-skin-black-opium .story-safe-footer {
  position: relative;
  background: rgba(20, 16, 24, .72) !important;
  border: 0 !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  backdrop-filter: blur(14px) saturate(1.2);
}
.story-skin-black-opium .story-safe-header::after,
.story-skin-black-opium .story-safe-footer::before {
  content: '';
  position: absolute;
  left: 8%; right: 8%;
  height: 1px;
  background: linear-gradient(90deg, transparent, #D06456 20%, #BF468D 50%, #7752C5 80%, transparent);
  box-shadow: 0 0 8px rgba(191, 70, 141, .8);
  pointer-events: none;
}
.story-skin-black-opium .story-safe-header::after { bottom: 0; }
.story-skin-black-opium .story-safe-footer::before { top: 0; }
.story-skin-black-opium .story-safe-header .uppercase {
  font-weight: 600 !important;
  letter-spacing: .38em !important;
  background: ${OPIUM_NEON};
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent !important;
}
.story-skin-black-opium .story-safe-header h1 { color: #F1EAF3; letter-spacing: .06em; }

/* 正文卡：iOS 圆角磨砂黑卡 + 闪粉 + 霓光描边 */
.story-skin-black-opium .story-turn,
.story-skin-black-opium .story-opening {
  position: relative;
  padding: 24px 18px 20px;
  border-radius: 26px;
  border: 1px solid transparent !important;
  background:
    ${OPIUM_GLITTER} 0 0 / 120px 120px padding-box,
    linear-gradient(-10deg, rgba(184, 92, 120, .16), rgba(35, 35, 35, .55) 12%, rgba(119, 82, 197, .08) 50%, rgba(184, 92, 120, .16)) padding-box,
    linear-gradient(rgba(22, 18, 25, .8), rgba(22, 18, 25, .8)) padding-box,
    linear-gradient(135deg, rgba(208, 100, 86, .55), rgba(255, 255, 255, .08) 35%, rgba(255, 255, 255, .06) 65%, rgba(119, 82, 197, .6)) border-box;
  box-shadow: 0 14px 34px rgba(0, 0, 0, .5);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.story-skin-black-opium .story-prose { color: #DDD6E0 !important; letter-spacing: .02em; }

/* 开场卡：紫色银河雪山 */
.story-skin-black-opium .story-opening { padding-top: 0; overflow: hidden; text-align: center; }
.story-skin-black-opium .story-opening::before {
  content: '';
  display: block;
  height: 170px;
  margin: 0 -18px 20px;
  background: linear-gradient(180deg, rgba(22, 18, 25, 0) 55%, rgba(22, 18, 25, .95)), url("${opiumGalaxy}") 30% 40% / 190% auto no-repeat;
}
.story-skin-black-opium .story-opening::after {
  content: 'Own the night ...';
  position: absolute;
  left: 0; right: 0; top: 134px;
  color: rgba(255, 240, 248, .85);
  font: italic 300 12px/1 'Didot', 'DM Serif Display', serif;
  letter-spacing: .3em;
  text-shadow: 0 0 10px rgba(191, 70, 141, .9);
  pointer-events: none;
}
.story-skin-black-opium .story-opening > :first-child { letter-spacing: .38em; color: #CD7D84 !important; }
.story-skin-black-opium .story-opening h2 { color: #F4ECF6; }

/* 对白：玫瑰 → 紫的淡渐变胶囊，和原主题一致 */
.story-skin-black-opium:not(.story-q-color) .story-quote { color: #D59AB9; }
.story-skin-black-opium:not(.story-q-bg) .story-quote {
  padding: 1px .3em;
  margin: 0 2px;
  border-radius: 6px;
  background-image: linear-gradient(100deg, rgba(190, 128, 158, .2), rgba(119, 82, 197, .1) 60%, transparent);
  box-shadow: 0 0 0 .5px rgba(190, 128, 158, .4);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* 你写下：原主题的用户气泡——深酒紫圆角卡 */
.story-skin-black-opium .story-user-turn,
.story-skin-black-opium .story-user-turn.border-violet-300 {
  margin-left: 14%;
  padding: 14px 16px;
  border: 0 !important;
  border-radius: 22px 22px 6px 22px;
  background: linear-gradient(-5deg, rgba(103, 51, 90, .92), rgba(119, 82, 197, .55));
  box-shadow: 0 8px 22px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .12);
}
.story-skin-black-opium .story-user-turn > div:first-child { color: #F2B7CF !important; letter-spacing: .3em !important; }
.story-skin-black-opium .story-prose-user { color: #F4EAF1 !important; }

/* 场景卡：更深一层的圆角磨砂块 */
.story-skin-black-opium .story-scene {
  padding: 12px 14px;
  border: .5px solid rgba(255, 255, 255, .15) !important;
  border-radius: 18px;
  background: rgba(10, 8, 12, .5);
}
.story-skin-black-opium .story-scene > div:first-child { color: #CD7D84 !important; letter-spacing: .3em !important; }

/* 输入区：胶囊磨砂 + 霓光发送键 */
.story-skin-black-opium .story-compose {
  background: rgba(20, 16, 24, .8) !important;
  border: .5px solid rgba(255, 255, 255, .15) !important;
  border-radius: 24px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45) !important;
}
.story-skin-black-opium .story-compose textarea { color: #DDD6E0; }
.story-skin-black-opium .story-compose textarea::placeholder { color: rgba(214, 208, 217, .45); font-style: italic; }
.story-skin-black-opium .story-send-button:not(.bg-rose-600),
.story-skin-black-opium .story-quick-preset button {
  background: ${OPIUM_NEON} !important;
  color: #FFF4FA !important;
  border-radius: 999px !important;
  box-shadow: 0 0 14px rgba(191, 70, 141, .55), inset 0 1px 0 rgba(255, 255, 255, .25) !important;
}
.story-skin-black-opium .story-compose .bg-violet-50 { background: rgba(191, 70, 141, .16) !important; border-color: rgba(191, 70, 141, .4) !important; color: #E8A7C6 !important; border-radius: 999px !important; }

/* 配色补丁 */
.story-skin-black-opium .border-violet-600, .story-skin-black-opium .border-violet-700 { border-color: #BF468D !important; }
.story-skin-black-opium .bg-violet-400 { background-color: #BF468D !important; }
.story-skin-black-opium .accent-violet-600 { accent-color: #BF468D; }
.story-skin-black-opium .text-violet-900 { color: #F4EAF1 !important; }
.story-skin-black-opium .bg-slate-900 { background: ${OPIUM_NEON} !important; color: #FFF4FA !important; }
.story-skin-black-opium .bg-slate-800 { background-color: #2C2430 !important; }
.story-skin-black-opium .border-slate-800 { border-color: #2C2430 !important; }
.story-skin-black-opium .border-stone-100 { border-color: #1D1823 !important; }
.story-skin-black-opium .ring-stone-100 { --tw-ring-color: #1D1823 !important; }
.story-skin-black-opium .text-amber-700, .story-skin-black-opium .text-amber-600 { color: #E8A58F !important; }
.story-skin-black-opium .border-amber-200 { border-color: rgba(208, 100, 86, .35) !important; }
.story-skin-black-opium .bg-amber-50, .story-skin-black-opium .bg-amber-100 { background-color: rgba(208, 100, 86, .18) !important; }
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
    {
        id: 'otaku-diary',
        name: '宅女日记',
        subtitle: 'Dopamine Diary · 手账拼贴',
        color: 'light',
        thumb: otakuDiaryBg,
        css: OTAKU_DIARY_CSS,
    },
    {
        id: 'coco',
        name: '可可小姐',
        subtitle: 'Mademoiselle · 粉色软呢与珍珠',
        color: 'light',
        thumb: cocoBg,
        css: COCO_CSS,
    },
    {
        id: 'at-large',
        name: '在逃共犯',
        subtitle: 'Wanted · 黑白卷宗与一抹锈红',
        color: 'light',
        thumb: atLargeWide,
        css: AT_LARGE_CSS,
    },
    {
        id: 'memo',
        name: 'MEMO',
        subtitle: 'My secret · 雾蓝薄荷的留白手记',
        color: 'light',
        thumb: memoThumb,
        css: MEMO_CSS,
    },
    {
        id: 'moon-night',
        name: '十三月夜',
        subtitle: 'Night · 星空、新月与菱格微光',
        color: 'dark',
        thumb: moonNightWide,
        css: MOON_NIGHT_CSS,
    },
    {
        id: 'black-opium',
        name: '黑鸦片',
        subtitle: 'Own the night · 紫黑闪粉与玫瑰霓光',
        color: 'dark',
        thumb: opiumGalaxy,
        css: BLACK_OPIUM_CSS,
    },
];

export const STORY_SKIN_CSS = STORY_SKINS.map(skin => skin.css).join('\n');

export const readStorySkinId = (value: unknown): StorySkinId =>
    STORY_SKINS.some(skin => skin.id === value) ? value as StorySkinId : 'classic';

export const findStorySkin = (id: StorySkinId): StorySkin => STORY_SKINS.find(skin => skin.id === id) || STORY_SKINS[0];
