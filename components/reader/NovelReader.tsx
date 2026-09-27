/**
 * 小说阅读器：翻页 / 滚动、主题字号、目录、角色批注。
 * 2026-09-27 从 apps/VRWorldApp.tsx 原样搬出（彼方书库和书房共用），并加了「删除批注」。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ListBullets, Palette, TextAa, X } from '@phosphor-icons/react';
import type { CharacterProfile, VRNovelAnnotation, VRWorldNovel } from '../../types';
import { DB } from '../../utils/db';
import { groupAnnotationsBySeg } from '../../utils/vrWorld/novel';
import { stripLeakedAttrs } from '../../utils/vrWorld/prompts';
import { chapterIndexAt, detectChapters, fallbackSections, type BookChapter } from '../../utils/bookroom/bookroom';
import { getBookroomRecord } from '../../utils/bookroom/bookroomDb';

// 与彼方一致的安全区让位
const VR_TOP = 'var(--chrome-top)';
const vrBottomPad = (base: string) => `calc(${base} + var(--safe-bottom) + 0.75rem)`;

// ============ 阅读器主题 ============
interface ReaderTheme { id: string; name: string; bg: string; paper: string; text: string; sub: string; accent: string; annBg: string; }
const READER_THEMES: ReaderTheme[] = [
    { id: 'paper', name: '纸白', bg: '#e9e3d6', paper: '#f7f3ea', text: '#322d25', sub: '#8a7f6c', accent: '#a0673b', annBg: '#efe7d4' },
    { id: 'sepia', name: '羊皮', bg: '#d8c6a3', paper: '#ece0c6', text: '#48381f', sub: '#917a52', accent: '#8a5a2b', annBg: '#e2d3b2' },
    { id: 'green', name: '护眼', bg: '#bcd4bc', paper: '#d6e8d4', text: '#26331f', sub: '#5d7350', accent: '#3f6b3a', annBg: '#cadfc6' },
    { id: 'night', name: '夜阅', bg: '#15161a', paper: '#1f2128', text: '#cfc9bd', sub: '#7d7869', accent: '#c0915a', annBg: '#262932' },
    { id: 'ink', name: '墨黑', bg: '#0a0a0e', paper: '#131319', text: '#b9b4ab', sub: '#6f6a78', accent: '#8b9bff', annBg: '#1a1a24' },
];
const FONT_SIZES = [13, 15, 17, 20];
const READER_THEME_KEY = 'vr_reader_theme';
const READER_FONT_KEY = 'vr_reader_font';
const READER_MODE_KEY = 'vr_reader_mode'; // 'page' | 'scroll'
// 用户书签（段索引，per-novel，独立于角色书签）
const userBmKey = (id: string) => `vr_user_bm_${id}`;
const readUserBm = (id: string): number => {
    const v = Number(localStorage.getItem(userBmKey(id)));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};
const writeUserBm = (id: string, idx: number) => {
    try { localStorage.setItem(userBmKey(id), String(Math.max(0, idx))); } catch { /* ignore */ }
};

// 单段渲染（翻页/滚动共用）
const SegBlock: React.FC<{
    seg: { idx: number; text: string }; anns: VRNovelAnnotation[];
    theme: ReaderTheme; fontSize: number; nameOf: (id: string) => string | undefined; highlight?: boolean;
    onDelete?: (a: VRNovelAnnotation) => void;
}> = ({ seg, anns, theme, fontSize, nameOf, highlight, onDelete }) => (
    <div data-seg={seg.idx} className="mb-5 rounded-lg transition-colors" style={highlight ? { background: `${theme.accent}1f`, boxShadow: `0 0 0 2px ${theme.accent}66`, padding: '8px 10px', margin: '0 -10px 20px' } : undefined}>
        <p className="whitespace-pre-wrap" style={{ color: theme.text, fontSize, lineHeight: 1.9, textIndent: '2em' }}>{seg.text}</p>
        {anns.map(a => (
            <div key={a.id} className="mt-2 ml-2 rounded-lg px-3 py-2" style={{ background: theme.annBg, borderLeft: `3px solid ${theme.accent}` }}>
                <span className="font-bold" style={{ color: theme.accent, fontSize: fontSize - 3 }}>{nameOf(a.authorId) || a.authorName}</span>
                {a.targetAnnotationId && <span style={{ color: theme.sub, fontSize: fontSize - 3 }}> 回应</span>}
                <span style={{ color: theme.text, fontSize: fontSize - 3 }}>：{stripLeakedAttrs(a.content)}</span>
                {onDelete && <button onClick={() => onDelete(a)} className="ml-2 align-middle opacity-60 active:opacity-100" style={{ color: theme.sub, fontSize: fontSize - 5 }} aria-label="删除这条批注">删除</button>}
            </div>
        ))}
    </div>
);

/**
 * 小说阅读器（彼方书库与书房共用）。
 * peek = 查看某段（如某条批注的原文）：落在 initialSeg 并高亮，全程不改用户书签。
 * allowDeleteAnnotations = 批注旁显示「删除」。
 */
export const NovelReader: React.FC<{ novel: VRWorldNovel; characters: CharacterProfile[]; onClose: () => void; initialSeg?: number; peek?: boolean; allowDeleteAnnotations?: boolean; }> = ({ novel, characters, onClose, initialSeg, peek, allowDeleteAnnotations }) => {
    const PAGE_SIZE = 8;
    const total = novel.segments.length;
    // peek（查看某条批注）时落在 initialSeg，且全程不写用户书签
    const initialBm = useMemo(() => {
        const base = (initialSeg != null) ? initialSeg : readUserBm(novel.id);
        return Math.min(Math.max(0, base), Math.max(0, total - 1));
    }, [novel.id, total, initialSeg]);

    const [annotations, setAnnotations] = useState<VRNovelAnnotation[]>([]);
    const [themeId, setThemeId] = useState<string>(() => localStorage.getItem(READER_THEME_KEY) || 'paper');
    const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(READER_FONT_KEY)) || 15);
    const [mode, setMode] = useState<'page' | 'scroll'>(() => (localStorage.getItem(READER_MODE_KEY) === 'scroll' ? 'scroll' : 'page'));
    const [showCtl, setShowCtl] = useState(false);
    const [showToc, setShowToc] = useState(false);
    const tocListRef = useRef<HTMLDivElement>(null);
    // 打开目录时把「在读」那一章滚到中间
    useEffect(() => { if (showToc) tocListRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' }); }, [showToc]);
    // 目录：书房存过的（EPUB 自带目录）优先，否则自动认「第 X 章」，再不行按位置分 20 段
    const autoChapters = useMemo(() => detectChapters(novel.segments), [novel.segments]);
    const [savedChapters, setSavedChapters] = useState<BookChapter[] | null>(null);
    useEffect(() => { void getBookroomRecord(novel.id).then(r => setSavedChapters(r?.chapters?.length ? r.chapters : null)).catch(() => {}); }, [novel.id]);
    const chapters = savedChapters || (autoChapters.length ? autoChapters : fallbackSections(total));
    const chaptersGuessed = !savedChapters && !autoChapters.length;

    // 翻页态
    const [page, setPage] = useState(() => Math.floor(initialBm / PAGE_SIZE));
    // 滚动态：窗口 [winStart, winEnd)，初始落在书签处
    const [winStart, setWinStart] = useState(() => initialBm);
    const [winEnd, setWinEnd] = useState(() => Math.min(total, initialBm + 30));
    const [topSeg, setTopSeg] = useState(initialBm);

    const scrollRef = useRef<HTMLDivElement>(null);
    const prevHeightRef = useRef<number | null>(null);
    const bmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { void (async () => setAnnotations(await DB.getVRAnnotations(novel.id)))(); }, [novel.id]);
    useEffect(() => { localStorage.setItem(READER_THEME_KEY, themeId); }, [themeId]);
    useEffect(() => { localStorage.setItem(READER_FONT_KEY, String(fontSize)); }, [fontSize]);

    // 翻页：换页存书签 + 回顶（peek 模式不写书签）
    useEffect(() => {
        if (mode !== 'page') return;
        if (!peek) writeUserBm(novel.id, page * PAGE_SIZE);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [page, mode, novel.id, peek]);

    // 从批注 / 笔记跳进来：把那一段滚到眼前（翻页模式下它可能在这一页的下半截）
    useEffect(() => {
        if (initialSeg == null) return;
        const t = window.setTimeout(() => {
            scrollRef.current?.querySelector<HTMLElement>(`[data-seg="${initialSeg}"]`)?.scrollIntoView({ block: peek ? 'center' : 'start' });
        }, 80);
        return () => window.clearTimeout(t);
    }, []); // 只在打开时滚一次

    // 滚动：prepend 后补偿滚动位置，避免跳动
    useLayoutEffect(() => {
        if (prevHeightRef.current != null && scrollRef.current) {
            const el = scrollRef.current;
            el.scrollTop += el.scrollHeight - prevHeightRef.current;
            prevHeightRef.current = null;
        }
    }, [winStart]);

    const switchMode = (m: 'page' | 'scroll') => {
        if (m === mode) return;
        if (m === 'scroll') {
            const bm = page * PAGE_SIZE;
            setWinStart(bm); setWinEnd(Math.min(total, bm + 30)); setTopSeg(bm);
        } else {
            setPage(Math.floor(readUserBm(novel.id) / PAGE_SIZE));
        }
        setMode(m);
        localStorage.setItem(READER_MODE_KEY, m);
    };

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el || mode !== 'scroll') return;
        // 触底加载更多
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 900 && winEnd < total) {
            setWinEnd(e => Math.min(total, e + 20));
        }
        // 触顶往回加载
        if (el.scrollTop < 400 && winStart > 0) {
            prevHeightRef.current = el.scrollHeight;
            setWinStart(s => Math.max(0, s - 20));
        }
        // 节流存书签（取顶部首个可见段）
        if (bmTimerRef.current) return;
        bmTimerRef.current = setTimeout(() => {
            bmTimerRef.current = null;
            const cur = scrollRef.current;
            if (!cur) return;
            const top = cur.scrollTop;
            const nodes = cur.querySelectorAll<HTMLElement>('[data-seg]');
            for (const n of Array.from(nodes)) {
                if (n.offsetTop + n.offsetHeight > top + 4) {
                    const idx = Number(n.dataset.seg);
                    setTopSeg(idx); if (!peek) writeUserBm(novel.id, idx);
                    break;
                }
            }
        }, 300);
    };

    // 跳到某一章：翻页模式翻到那页并滚到那一段；滚动模式把窗口挪过去
    const jumpTo = (segIdx: number) => {
        setShowToc(false);
        if (mode === 'page') {
            setPage(Math.floor(segIdx / PAGE_SIZE));
            window.setTimeout(() => {
                scrollRef.current?.querySelector<HTMLElement>(`[data-seg="${segIdx}"]`)?.scrollIntoView({ block: 'start' });
            }, 60);
        } else {
            prevHeightRef.current = null;
            setWinStart(segIdx); setWinEnd(Math.min(total, segIdx + 30)); setTopSeg(segIdx);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
            if (!peek) writeUserBm(novel.id, segIdx);
        }
    };
    // 从批注跳进来还停在那一页时，顶栏显示那一段所在的章，而不是这一页开头
    const onJumpPage = initialSeg != null && mode === 'page' && page === Math.floor(initialSeg / PAGE_SIZE);
    const curSeg = onJumpPage ? initialSeg! : mode === 'page' ? page * PAGE_SIZE : topSeg;
    const curChapter = chapterIndexAt(chapters, curSeg);

    const theme = READER_THEMES.find(t => t.id === themeId) || READER_THEMES[0];
    const annBySeg = useMemo(() => groupAnnotationsBySeg(annotations), [annotations]);
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name;
    const deleteAnnotation = (a: VRNovelAnnotation) => {
        if (!window.confirm(`删掉 ${nameOf(a.authorId) || a.authorName} 的这条批注？删了找不回来。`)) return;
        void DB.deleteVRAnnotation(a.id).then(() => setAnnotations(list => list.filter(x => x.id !== a.id)));
    };
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const renderSegs = mode === 'page'
        ? novel.segments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        : novel.segments.slice(winStart, winEnd);

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: theme.bg }}>
            {/* 顶栏 */}
            <div className="flex items-center gap-2 px-4 pb-2 shrink-0" style={{ borderBottom: `1px solid ${theme.accent}22`, paddingTop: VR_TOP }}>
                <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full active:bg-black/5" style={{ color: theme.text }}><X size={20} weight="bold" /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold truncate" style={{ color: theme.text }}>{novel.title}</div>
                    <div className="text-[10px] truncate" style={{ color: theme.sub }}>
                        {curChapter >= 0 && !chaptersGuessed ? `${chapters[curChapter].title} · ` : ''}{Math.round((curSeg / Math.max(1, total)) * 100)}%
                    </div>
                </div>
                <button onClick={() => setShowToc(true)} className="p-1.5 rounded-full active:bg-black/5" style={{ color: theme.accent }} aria-label="目录"><ListBullets size={19} weight="bold" /></button>
                <button onClick={() => setShowCtl(s => !s)} className="p-1.5 rounded-full active:bg-black/5" style={{ color: theme.accent }}><Palette size={18} weight="bold" /></button>
            </div>

            {peek && (
                <div className="px-4 py-1.5 shrink-0 text-[11px] text-center" style={{ background: `${theme.accent}1a`, color: theme.accent }}>
                    正在查看批注位置 · 不会改动你的书签
                </div>
            )}

            {/* 控制条：主题 / 字号 / 模式 */}
            {showCtl && (
                <div className="px-4 py-2.5 shrink-0 space-y-2.5" style={{ background: theme.paper, borderBottom: `1px solid ${theme.accent}22` }}>
                    <div className="flex items-center gap-2">
                        <Palette size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {READER_THEMES.map(t => (
                                <button key={t.id} onClick={() => setThemeId(t.id)}
                                    className="flex-1 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all"
                                    style={{ background: t.paper, color: t.text, border: themeId === t.id ? `2px solid ${t.accent}` : `1px solid ${t.accent}33` }}>
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <TextAa size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {FONT_SIZES.map(fs => (
                                <button key={fs} onClick={() => setFontSize(fs)}
                                    className="w-9 h-7 rounded-lg font-bold transition-all"
                                    style={{ background: fontSize === fs ? theme.accent : 'transparent', color: fontSize === fs ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44`, fontSize: Math.min(fs, 15) }}>
                                    A
                                </button>
                            ))}
                        </div>
                        {/* 模式切换 */}
                        <div className="flex gap-1.5">
                            {(['page', 'scroll'] as const).map(m => (
                                <button key={m} onClick={() => switchMode(m)}
                                    className="px-2.5 h-7 rounded-lg text-[11px] font-bold transition-all"
                                    style={{ background: mode === m ? theme.accent : 'transparent', color: mode === m ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44` }}>
                                    {m === 'page' ? '翻页' : '滚动'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="text-[10px] leading-snug pt-0.5" style={{ color: theme.sub }}>书里的批注都是角色自己留的；你可以翻看，暂时还不能亲自写批注。</div>
                </div>
            )}

            {/* 正文 */}
            <div ref={scrollRef} onScroll={mode === 'scroll' ? onScroll : undefined}
                className="flex-1 overflow-y-auto vr-reader-scroll px-5 py-4" style={{ background: theme.bg, fontFamily: `'Noto Serif SC','Songti SC','Noto Serif','Georgia',serif` }}>
                {mode === 'scroll' && winStart > 0 && (
                    <div className="text-center text-[10px] mb-3" style={{ color: theme.sub }}>—— 上滑加载更早内容 ——</div>
                )}
                {renderSegs.map(seg => (
                    <SegBlock key={seg.idx} seg={seg} anns={annBySeg.get(seg.idx) || []} theme={theme} fontSize={fontSize} nameOf={nameOf} highlight={peek && seg.idx === initialSeg} onDelete={allowDeleteAnnotations ? deleteAnnotation : undefined} />
                ))}
            </div>

            {/* 目录 */}
            {showToc && (
                <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: theme.bg }}>
                    <div className="flex items-center gap-2 px-4 pb-2 shrink-0" style={{ borderBottom: `1px solid ${theme.accent}22`, paddingTop: VR_TOP }}>
                        <button onClick={() => setShowToc(false)} className="p-1.5 -ml-1.5 rounded-full active:bg-black/5" style={{ color: theme.text }} aria-label="关闭目录"><X size={20} weight="bold" /></button>
                        <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-bold truncate" style={{ color: theme.text }}>目录</div>
                            <div className="text-[10px]" style={{ color: theme.sub }}>{chaptersGuessed ? '没认出章节标题，按位置分段' : `共 ${chapters.length} 章`}</div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto vr-reader-scroll px-3 py-2" ref={tocListRef}>
                        {chapters.map((c, i) => (
                            <button key={`${c.segIdx}-${i}`} data-current={i === curChapter} onClick={() => jumpTo(c.segIdx)}
                                className="w-full flex items-center gap-2 text-left px-3 py-3 rounded-lg active:opacity-70"
                                style={{ borderBottom: `1px solid ${theme.accent}14`, background: i === curChapter ? `${theme.accent}1a` : 'transparent' }}>
                                <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: i === curChapter ? theme.accent : i < curChapter ? theme.sub : theme.text, fontWeight: i === curChapter ? 700 : 400 }}>{c.title}</span>
                                {i === curChapter && <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: theme.accent, color: theme.paper }}>在读</span>}
                                <span className="text-[10px] shrink-0" style={{ color: theme.sub }}>{Math.round((c.segIdx / Math.max(1, total)) * 100)}%</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 底栏 */}
            {mode === 'page' ? (
                <div className="flex items-center justify-between px-5 py-2.5 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22`, paddingBottom: vrBottomPad('0.625rem') }}>
                    <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>‹ 上一页</button>
                    <span className="text-[11px]" style={{ color: theme.sub }}>{page + 1} / {totalPages}</span>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>下一页 ›</button>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-4 px-5 py-2 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22`, paddingBottom: vrBottomPad('0.5rem') }}>
                    <button onClick={() => { setWinStart(0); setWinEnd(Math.min(total, 30)); setTopSeg(0); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
                        className="text-[11px] font-semibold" style={{ color: theme.accent }}>↑ 从头</button>
                    <span className="text-[10px]" style={{ color: theme.sub }}>滚动阅读 · 自动记录位置</span>
                </div>
            )}
        </div>
    );
};
