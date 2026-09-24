import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Moon, Palette, Sparkle, SquaresFour, Sun, X } from '@phosphor-icons/react';
import { STORY_THEATER_APPEARANCE_STORAGE_KEY } from '../../../utils/storyTheaterBackup';
import { useOS } from '../../../context/OSContext';

export type StoryColorMode = 'light' | 'dark';
export type StoryDecorMode = 'plain' | 'cinema';

interface StoryAppearance {
    color: StoryColorMode;
    decor: StoryDecorMode;
    /** 剧情正文字号 px；旧存档没有这个字段时按默认 15px */
    fontSize: number;
    /** 引号（“” 「」 ‘’ 『』）内文字的高亮；三项各自独立开关 */
    quoteBold: boolean;
    quoteColorOn: boolean;
    quoteColor: string;
    quoteBgOn: boolean;
    quoteBg: string;
}

type StoryQuotePatch = Partial<Pick<StoryAppearance, 'quoteBold' | 'quoteColorOn' | 'quoteColor' | 'quoteBgOn' | 'quoteBg'>>;

interface StoryThemeContextValue {
    appearance: StoryAppearance;
    setColor: (value: StoryColorMode) => void;
    setDecor: (value: StoryDecorMode) => void;
    setFontSize: (value: number) => void;
    setQuote: (patch: StoryQuotePatch) => void;
}

const STORAGE_KEY = STORY_THEATER_APPEARANCE_STORAGE_KEY;
const STORY_APPEARANCE_HISTORY_KEY = '__sullyStoryAppearance';
export const STORY_FONT_SIZE_MIN = 11;
export const STORY_FONT_SIZE_MAX = 22;
export const STORY_FONT_SIZE_DEFAULT = 15;
const DEFAULT_QUOTE_COLOR = '#7c3aed';
const DEFAULT_QUOTE_BG = '#fbbf24';
const QUOTE_COLOR_SWATCHES = ['#7c3aed', '#db2777', '#dc2626', '#d97706', '#059669', '#2563eb', '#475569'];
const QUOTE_BG_SWATCHES = ['#fbbf24', '#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#94a3b8'];
const DEFAULT_APPEARANCE: StoryAppearance = {
    color: 'light',
    decor: 'plain',
    fontSize: STORY_FONT_SIZE_DEFAULT,
    quoteBold: false,
    quoteColorOn: false,
    quoteColor: DEFAULT_QUOTE_COLOR,
    quoteBgOn: false,
    quoteBg: DEFAULT_QUOTE_BG,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const readHex = (value: unknown, fallback: string): string => (typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback);

export function clampStoryFontSize(value: unknown): number {
    const size = Math.round(Number(value));
    if (!Number.isFinite(size) || size <= 0) return STORY_FONT_SIZE_DEFAULT;
    return Math.min(STORY_FONT_SIZE_MAX, Math.max(STORY_FONT_SIZE_MIN, size));
}
const StoryThemeContext = createContext<StoryThemeContextValue | null>(null);

function readAppearance(): StoryAppearance {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_APPEARANCE;
        const value = JSON.parse(raw) as Partial<StoryAppearance>;
        return {
            color: value.color === 'dark' ? 'dark' : 'light',
            decor: value.decor === 'cinema' ? 'cinema' : 'plain',
            fontSize: clampStoryFontSize(value.fontSize),
            quoteBold: value.quoteBold === true,
            quoteColorOn: value.quoteColorOn === true,
            quoteColor: readHex(value.quoteColor, DEFAULT_QUOTE_COLOR),
            quoteBgOn: value.quoteBgOn === true,
            quoteBg: readHex(value.quoteBg, DEFAULT_QUOTE_BG),
        };
    } catch {
        return DEFAULT_APPEARANCE;
    }
}

const STORY_THEME_CSS = `
.story-theme {
  --story-bg: #f6f4ef;
  --story-surface: #fffdfa;
  --story-raised: #ffffff;
  --story-ink: #243047;
  --story-muted: #728097;
  --story-faint: #aeb7c6;
  --story-line: #dce1e8;
  --story-soft: #e9edf2;
  --story-accent: #7c3aed;
  --story-accent-soft: #ede9fe;
  --story-accent-ink: #6d28d9;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: var(--story-bg);
  color: var(--story-ink);
  color-scheme: light;
}
.story-theme-dark {
  --story-bg: #111519;
  --story-surface: #181e24;
  --story-raised: #202831;
  --story-ink: #edf1f5;
  --story-muted: #a3afbe;
  --story-faint: #6f7b89;
  --story-line: #303a45;
  --story-soft: #252e37;
  --story-accent: #ad8bff;
  --story-accent-soft: #2e2548;
  --story-accent-ink: #c8b4ff;
  color-scheme: dark;
}
.story-theme.story-decor-cinema {
  --story-bg: #faf4f0;
  --story-surface: #fffaf4;
  --story-raised: #fffdf9;
  --story-line: #eadbd5;
  --story-accent: #8b5cf6;
  --story-accent-soft: #f0e7ff;
  --story-accent-ink: #7c3aed;
}
.story-theme-dark.story-decor-cinema {
  --story-bg: #0d1020;
  --story-surface: #15182b;
  --story-raised: #1d2037;
  --story-line: #343854;
  --story-accent: #bd9cff;
  --story-accent-soft: #30264d;
  --story-accent-ink: #d5c3ff;
}
.story-theme::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.story-theme.story-decor-cinema::before {
  opacity: 1;
  background:
    radial-gradient(circle at 10% 4%, color-mix(in srgb, var(--story-accent) 17%, transparent) 0, transparent 28%),
    radial-gradient(circle at 92% 34%, rgba(251, 191, 36, .12) 0, transparent 25%),
    linear-gradient(115deg, transparent 0 47%, rgba(255,255,255,.035) 48% 49%, transparent 50% 100%);
}
.story-theme > * { position: relative; z-index: 1; }
.story-theme .bg-stone-100 { background-color: var(--story-bg) !important; }
.story-theme .bg-stone-100\\/95 { background-color: var(--story-bg) !important; }
.story-theme .bg-white { background-color: var(--story-raised) !important; }
.story-theme .bg-slate-50, .story-theme .bg-slate-100 { background-color: var(--story-surface) !important; }
.story-theme .bg-slate-200 { background-color: var(--story-soft) !important; }
.story-theme .bg-slate-900 { background-color: var(--story-ink) !important; color: var(--story-bg) !important; }
.story-theme .text-slate-900, .story-theme .text-slate-800, .story-theme .text-slate-700, .story-theme .text-slate-600 { color: var(--story-ink) !important; }
.story-theme .text-slate-500, .story-theme .text-slate-400 { color: var(--story-muted) !important; }
.story-theme .text-slate-300 { color: var(--story-faint) !important; }
.story-theme .border-slate-100, .story-theme .border-slate-200, .story-theme .border-slate-300 { border-color: var(--story-line) !important; }
.story-theme .divide-slate-200 > :not([hidden]) ~ :not([hidden]) { border-color: var(--story-line) !important; }
.story-theme .text-violet-500, .story-theme .text-violet-600, .story-theme .text-violet-700 { color: var(--story-accent-ink) !important; }
.story-theme .bg-violet-50, .story-theme .bg-violet-100 { background-color: var(--story-accent-soft) !important; }
.story-theme .bg-violet-500, .story-theme .bg-violet-600 { background-color: var(--story-accent) !important; }
.story-theme .border-violet-100, .story-theme .border-violet-200 { border-color: color-mix(in srgb, var(--story-accent) 34%, var(--story-line)) !important; }
.story-theme-dark .bg-rose-50\\/70 { background-color: rgba(78, 35, 55, .72) !important; }
.story-theme-dark .text-rose-800, .story-theme-dark .text-rose-700, .story-theme-dark .text-rose-600, .story-theme-dark .text-rose-500 { color: #f4a8bd !important; }
.story-theme-dark .border-rose-200, .story-theme-dark .border-rose-200\\/70 { border-color: rgba(244, 168, 189, .28) !important; }
.story-theme .story-safe-header { padding-top: max(1.25rem, var(--safe-top)); }
.story-theme .story-safe-footer { padding-bottom: calc(var(--safe-bottom) + 12px); }
.story-theme .story-safe-sheet { padding-bottom: calc(var(--safe-bottom) + 18px); }
.story-theme .story-quick-preset { bottom: calc(var(--safe-bottom) + 112px); }
.story-theme .story-page-scroll { overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; }
.story-theme.story-decor-plain .shadow-sm { box-shadow: none !important; }
.story-theme.story-decor-cinema .story-cinema-rule { position: relative; }
.story-theme.story-decor-cinema .story-cinema-rule::after {
  content: '✦  ·  ✦';
  position: absolute;
  right: 0;
  bottom: -5px;
  padding-left: 10px;
  color: var(--story-accent);
  background: var(--story-bg);
  font-size: 8px;
  letter-spacing: .24em;
}
.story-theme .story-prose { font-size: var(--story-font-size, 15px); line-height: 2.13; }
.story-theme.story-q-bold .story-quote { font-weight: 700; }
.story-theme.story-q-color .story-quote { color: var(--story-quote-color) !important; }
.story-theme.story-q-bg .story-quote {
  background-color: color-mix(in srgb, var(--story-quote-bg) 32%, transparent);
  border-radius: 4px;
  padding: 0 2px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.story-theme .story-prose-user { font-size: calc(var(--story-font-size, 15px) - 1px); line-height: 2; }
body.ios-keyboard-open .story-theme .story-safe-footer { padding-bottom: 12px !important; }
body.ios-keyboard-open .story-theme .story-safe-sheet { padding-bottom: 18px !important; }
body.ios-keyboard-open .story-theme .story-quick-preset { bottom: 112px !important; }
@media (prefers-reduced-motion: reduce) {
  .story-theme *, .story-theme *::before, .story-theme *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
`;

/** 主题根节点的 class / 变量；剧情页和弹出的外观面板（portal 在 body 下）共用 */
function themeRootProps(appearance: StoryAppearance): { className: string; style: React.CSSProperties } {
    const flags = [
        appearance.quoteBold ? 'story-q-bold' : '',
        appearance.quoteColorOn ? 'story-q-color' : '',
        appearance.quoteBgOn ? 'story-q-bg' : '',
    ].filter(Boolean).join(' ');
    return {
        className: `story-theme story-theme-${appearance.color} story-decor-${appearance.decor} ${flags}`,
        style: {
            ['--story-font-size' as string]: `${appearance.fontSize}px`,
            ['--story-quote-color' as string]: appearance.quoteColor,
            ['--story-quote-bg' as string]: appearance.quoteBg,
        },
    };
}

const ToggleChip: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
    <button type='button' role='switch' aria-checked={on} aria-label={label} onClick={onClick} className={`w-11 h-6 shrink-0 rounded-full relative transition-colors ${on ? 'bg-violet-600' : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
);

const ColorRow: React.FC<{ value: string; swatches: string[]; onChange: (value: string) => void; label: string }> = ({ value, swatches, onChange, label }) => (
    <div className='mt-2 flex flex-wrap items-center gap-2'>
        {swatches.map(color => <button key={color} type='button' onClick={() => onChange(color)} aria-label={`${label} ${color}`} className={`w-6 h-6 rounded-full border-2 ${value.toLowerCase() === color ? 'border-violet-700' : 'border-transparent'}`} style={{ backgroundColor: color }} />)}
        <label className='relative w-6 h-6 rounded-full overflow-hidden cursor-pointer' style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} title='自选颜色'>
            <input type='color' value={value} onChange={event => onChange(event.target.value)} aria-label={`${label} 自选`} className='absolute inset-0 w-full h-full opacity-0 cursor-pointer' />
        </label>
        <span className='text-[10px] tabular-nums text-slate-400'>{value}</span>
    </div>
);

export const StoryTheaterThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [appearance, setAppearance] = useState<StoryAppearance>(readAppearance);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    }, [appearance]);

    const value = useMemo<StoryThemeContextValue>(() => ({
        appearance,
        setColor: color => setAppearance(current => ({ ...current, color })),
        setDecor: decor => setAppearance(current => ({ ...current, decor })),
        setFontSize: fontSize => setAppearance(current => ({ ...current, fontSize: clampStoryFontSize(fontSize) })),
        setQuote: patch => setAppearance(current => ({ ...current, ...patch })),
    }), [appearance]);

    return <StoryThemeContext.Provider value={value}>
        <div className={`${themeRootProps(appearance).className} h-full w-full min-h-0`} style={themeRootProps(appearance).style}>
            <style>{STORY_THEME_CSS}</style>
            {children}
        </div>
    </StoryThemeContext.Provider>;
};

export const StoryAppearanceButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const context = useContext(StoryThemeContext);
    const { registerBackHandler } = useOS();
    const [open, setOpen] = useState(false);
    const closePanel = useCallback(() => {
        setOpen(false);
        try {
            if (window.history.state?.[STORY_APPEARANCE_HISTORY_KEY]) window.history.back();
        } catch { /* history 不可用时仍正常关闭 */ }
    }, []);

    useEffect(() => {
        if (!open) return;

        try {
            const previous = window.history.state && typeof window.history.state === 'object'
                ? window.history.state
                : {};
            if (!previous[STORY_APPEARANCE_HISTORY_KEY]) {
                window.history.pushState({ ...previous, [STORY_APPEARANCE_HISTORY_KEY]: true }, '');
            }
        } catch { /* 某些内嵌 WebView 禁用 history，保留其它关闭方式 */ }

        const unregister = registerBackHandler(() => {
            closePanel();
            return true;
        });
        const handlePopState = () => setOpen(false);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePanel();
        };
        window.addEventListener('popstate', handlePopState);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            unregister();
            window.removeEventListener('popstate', handlePopState);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closePanel, open, registerBackHandler]);
    if (!context) return null;
    const { appearance, setColor, setDecor, setFontSize, setQuote } = context;
    const rootProps = themeRootProps(appearance);

    return <>
        <button type='button' onClick={() => setOpen(true)} className={`w-9 h-9 rounded-full grid place-items-center ${className}`} title='剧情外观' aria-label='剧情外观'>
            <Palette size={18} weight={appearance.decor === 'cinema' ? 'fill' : 'regular'} />
        </button>
        {open && createPortal(<div
            className={`${rootProps.className} fixed inset-0 z-[90] flex items-end sm:items-center justify-center overflow-y-auto overscroll-contain`}
            style={{ ...rootProps.style, position: 'fixed', paddingTop: 'max(12px, var(--safe-top))', paddingBottom: 'max(0px, var(--safe-bottom))', backgroundColor: 'rgba(2, 6, 23, .35)' }}
            onClick={closePanel}
            role='presentation'
        >
            <div
                className='story-safe-sheet relative flex w-full max-h-full flex-col overflow-hidden sm:max-w-sm rounded-t-[28px] sm:rounded-[28px] bg-stone-100 px-5 pt-5 shadow-2xl'
                onClick={event => event.stopPropagation()}
                role='dialog'
                aria-modal='true'
                aria-labelledby='story-appearance-title'
            >
                <div className='shrink-0 flex items-start gap-4'>
                    <div className='min-w-0 flex-1'><div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>Story appearance</div><h2 id='story-appearance-title' className='mt-1 text-lg font-semibold'>剧情放映厅外观</h2><p className='mt-1 text-[10px] leading-5 text-slate-500'>只影响剧情模式，普通聊天与记忆宫殿保持原样。</p></div>
                    <button type='button' onClick={closePanel} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' aria-label='关闭剧情外观'><X size={17} /></button>
                </div>
                <div className='mt-5 min-h-0 overflow-y-auto overscroll-contain border-t border-slate-200'>
                    <div className='py-4 flex items-center gap-3'><span className='text-xs font-semibold w-16'>明暗</span><div className='min-w-0 flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => setColor('light')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.color === 'light' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Sun size={14} />浅色</button><button onClick={() => setColor('dark')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.color === 'dark' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Moon size={14} />深色</button></div></div>
                    <div className='py-4 border-t border-slate-200 flex items-center gap-3'><span className='text-xs font-semibold w-16'>装饰</span><div className='min-w-0 flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-200'><button onClick={() => setDecor('plain')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.decor === 'plain' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><SquaresFour size={14} />素雅</button><button onClick={() => setDecor('cinema')} className={`py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 ${appearance.decor === 'cinema' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Sparkle size={14} />花里胡哨</button></div></div>
                    <div className='py-4 border-t border-slate-200'>
                        <div className='flex items-center gap-3'><span className='text-xs font-semibold w-16'>正文字号</span><input type='range' min={STORY_FONT_SIZE_MIN} max={STORY_FONT_SIZE_MAX} step={1} value={appearance.fontSize} onChange={event => setFontSize(Number(event.target.value))} aria-label='剧情正文字号' className='min-w-0 flex-1 accent-violet-600' /><span className='w-11 shrink-0 text-right text-[11px] font-bold tabular-nums text-violet-700'>{appearance.fontSize}px</span></div>
                        <div className='mt-3 ml-[4.75rem] flex flex-wrap gap-2'>{[13, 14, 15, 16, 18].map(size => <button key={size} type='button' onClick={() => setFontSize(size)} className={`px-3 py-1.5 rounded-full text-[10px] font-bold ${appearance.fontSize === size ? 'bg-violet-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>{size}{size === STORY_FONT_SIZE_DEFAULT ? ' 默认' : ''}</button>)}</div>
                        <p className='story-prose mt-3 rounded-xl bg-white px-3 py-2 font-serif text-slate-800'>雨停了。他把伞收起来，回头看了你一眼。</p>
                    </div>
                    <div className='py-4 border-t border-slate-200'>
                        <div className='text-xs font-semibold'>引号高亮</div>
                        <p className='mt-1 text-[10px] leading-5 text-slate-500'>“” 「」 ‘’ 『』 包住的文字（连同引号）。三项可以随意组合。</p>
                        <div className='mt-3 flex items-center gap-3'><span className='min-w-0 flex-1 text-[11px] font-semibold'>粗体</span><ToggleChip on={appearance.quoteBold} onClick={() => setQuote({ quoteBold: !appearance.quoteBold })} label='引号内文字粗体' /></div>
                        <div className='mt-3'>
                            <div className='flex items-center gap-3'><span className='min-w-0 flex-1 text-[11px] font-semibold'>换字体颜色</span><ToggleChip on={appearance.quoteColorOn} onClick={() => setQuote({ quoteColorOn: !appearance.quoteColorOn })} label='引号内文字换颜色' /></div>
                            {appearance.quoteColorOn && <ColorRow value={appearance.quoteColor} swatches={QUOTE_COLOR_SWATCHES} onChange={quoteColor => setQuote({ quoteColor })} label='字体颜色' />}
                        </div>
                        <div className='mt-3'>
                            <div className='flex items-center gap-3'><span className='min-w-0 flex-1 text-[11px] font-semibold'>加底色</span><ToggleChip on={appearance.quoteBgOn} onClick={() => setQuote({ quoteBgOn: !appearance.quoteBgOn })} label='引号内文字加底色' /></div>
                            {appearance.quoteBgOn && <ColorRow value={appearance.quoteBg} swatches={QUOTE_BG_SWATCHES} onChange={quoteBg => setQuote({ quoteBg })} label='底色' />}
                        </div>
                        <p className='story-prose mt-3 rounded-xl bg-white px-3 py-2 font-serif text-slate-800'>她停下脚步。<span className='story-quote'>“你还记得吗？”</span>风把声音吹散了。<span className='story-quote'>「走吧。」</span></p>
                    </div>
                </div>
            </div>
        </div>, document.body)}
    </>;
};
