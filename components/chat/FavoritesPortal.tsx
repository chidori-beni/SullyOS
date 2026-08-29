import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    CaretLeft,
    CaretRight,
    FileText,
    Pause,
    Play,
    Star,
    Trash,
    Waveform,
    X,
} from '@phosphor-icons/react';
import {
    VOICE_FAVORITES_CHANGED_EVENT,
    getVoiceFavoriteBlob,
    listVoiceFavorites,
    removeVoiceFavoriteById,
    voiceFavoriteSourceLabel,
    type VoiceFavorite,
    type VoiceFavoriteSource,
} from '../../utils/voiceFavorites';
import {
    TEXT_FAVORITES_CHANGED_EVENT,
    listTextFavorites,
    removeTextFavoriteById,
    textFavoriteSourceLabel,
    type TextFavorite,
} from '../../utils/textFavorites';

const PAGE_SIZE = 10;
type FavoriteFilter = 'all' | 'text' | 'voice';
type SourceFilter = 'all' | VoiceFavoriteSource;
type UnifiedFavorite =
    | { kind: 'voice'; item: VoiceFavorite }
    | { kind: 'text'; item: TextFavorite };

interface FavoritesPortalProps {
    onClose: () => void;
}

const filters: Array<{ value: FavoriteFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'text', label: '文字' },
    { value: 'voice', label: '语音' },
];
const sourceFilters: Array<{ value: SourceFilter; label: string }> = [
    { value: 'all', label: '全部来源' },
    { value: 'chat', label: '聊天' },
    { value: 'call', label: '通话' },
    { value: 'date', label: '见面' },
];

const favoriteTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});
const formatTime = (timestamp: number) => favoriteTimeFormatter.format(new Date(timestamp));
const itemId = (item: UnifiedFavorite): string => `${item.kind}:${item.item.id}`;

const sortUnifiedFavorites = (items: UnifiedFavorite[]): UnifiedFavorite[] => (
    [...items].sort((a, b) => {
        const sourceTime = b.item.sourceTimestamp - a.item.sourceTimestamp;
        if (sourceTime !== 0) return sourceTime;
        const savedTime = b.item.favoritedAt - a.item.favoritedAt;
        if (savedTime !== 0) return savedTime;
        return b.item.id.localeCompare(a.item.id);
    })
);

const FavoritesPortal: React.FC<FavoritesPortalProps> = ({ onClose }) => {
    const [voiceItems, setVoiceItems] = useState<VoiceFavorite[]>([]);
    const [textItems, setTextItems] = useState<TextFavorite[]>([]);
    const [filter, setFilter] = useState<FavoriteFilter>('all');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [audioError, setAudioError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);

    const refresh = useCallback(async () => {
        const [voices, texts] = await Promise.all([
            listVoiceFavorites().catch(() => [] as VoiceFavorite[]),
            listTextFavorites().catch(() => [] as TextFavorite[]),
        ]);
        setVoiceItems(voices);
        setTextItems(texts);
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
        window.addEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh);
        window.addEventListener(TEXT_FAVORITES_CHANGED_EVENT, refresh);
        return () => {
            window.removeEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh);
            window.removeEventListener(TEXT_FAVORITES_CHANGED_EVENT, refresh);
        };
    }, [refresh]);

    useEffect(() => () => {
        audioRef.current?.pause();
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    }, []);

    const allItems = useMemo<UnifiedFavorite[]>(() => sortUnifiedFavorites([
        ...voiceItems.map(item => ({ kind: 'voice' as const, item })),
        ...textItems.map(item => ({ kind: 'text' as const, item })),
    ]), [textItems, voiceItems]);
    const filtered = useMemo(
        () => allItems.filter(item => (
            (filter === 'all' || item.kind === filter)
            && (sourceFilter === 'all' || item.item.source === sourceFilter)
        )),
        [allItems, filter, sourceFilter],
    );
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    useEffect(() => {
        if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
    }, [page, pageCount]);

    const stopPlayback = useCallback(() => {
        audioRef.current?.pause();
        setPlayingId(null);
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
    }, []);

    const playVoice = async (item: VoiceFavorite) => {
        const rowId = `voice:${item.id}`;
        setAudioError(null);
        if (playingId === rowId) {
            stopPlayback();
            return;
        }
        stopPlayback();
        const blob = await getVoiceFavoriteBlob(item.id);
        if (!blob) {
            setAudioError('这条收藏的音频文件缺失，请回到来源重新收藏。');
            return;
        }
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = audioRef.current || new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = stopPlayback;
        audio.onerror = () => {
            stopPlayback();
            setAudioError('音频暂时无法播放。');
        };
        try {
            await audio.play();
            setPlayingId(rowId);
        } catch {
            stopPlayback();
            setAudioError('浏览器阻止了播放，请再点一次。');
        }
    };

    const remove = async (entry: UnifiedFavorite) => {
        const rowId = itemId(entry);
        if (playingId === rowId) stopPlayback();
        if (entry.kind === 'voice') await removeVoiceFavoriteById(entry.item.id);
        else await removeTextFavoriteById(entry.item.id);
        await refresh();
    };

    const emptyTitle = filter === 'text' ? '这里还没有文字收藏'
        : filter === 'voice' ? '这里还没有语音收藏'
            : '这里还没有收藏';
    const emptyHint = filter === 'text'
        ? '在聊天里长按文字消息，就能收进来。'
        : filter === 'voice'
            ? '在聊天、通话或见面里长按语音，就能收进来。'
            : '在消息上长按，把想留下的文字或语音收进来。';

    const portal = (
        <div className="favorites-root">
            <style>{`
                .favorites-root {
                    position: fixed; inset: 0; z-index: 1650; overflow: hidden;
                    color: #172033; background: #f4f1eb;
                    font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif;
                    animation: favoritesEnter .22s ease-out both;
                }
                .favorites-shell { height: 100%; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; }
                .favorites-list { scrollbar-width: none; }
                .favorites-list::-webkit-scrollbar { display: none; }
                .favorite-row { animation: favoriteRowEnter .18s ease both; }
                @keyframes favoritesEnter { from { opacity: 0; } to { opacity: 1; } }
                @keyframes favoriteRowEnter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                @media (prefers-reduced-motion: reduce) {
                    .favorites-root, .favorite-row { animation: none !important; }
                }
            `}</style>
            <div className="favorites-shell px-4 sm:px-7">
                <header className="shrink-0 pt-[max(16px,env(safe-area-inset-top))] pb-3 border-b border-slate-900/10">
                    <div className="flex items-center justify-between gap-4 h-12">
                        <button type="button" onClick={onClose} className="w-10 h-10 -ml-1 grid place-items-center rounded-full text-slate-600 active:bg-black/5" aria-label="关闭收藏">
                            <X size={21} weight="bold" />
                        </button>
                        <div className="min-w-0 text-center">
                            <h1 className="text-[17px] font-bold tracking-[.08em]">收藏</h1>
                            <p className="mt-0.5 text-[10px] text-slate-500">{allItems.length} 条 · 文字 {textItems.length} · 语音 {voiceItems.length}</p>
                        </div>
                        <span className="w-10" aria-hidden />
                    </div>
                    <div className="flex items-center justify-center gap-1.5 mt-2" role="tablist" aria-label="收藏类型">
                        {filters.map(option => (
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filter === option.value}
                                key={option.value}
                                onClick={() => { stopPlayback(); setFilter(option.value); setSourceFilter('all'); setPage(0); setAudioError(null); }}
                                className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-colors ${filter === option.value ? 'bg-slate-800 text-white' : 'text-slate-500 active:bg-black/5'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    {filter !== 'text' && (
                        <div className="flex items-center justify-center gap-1 mt-1.5" role="tablist" aria-label="收藏来源">
                            {sourceFilters.map(option => (
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={sourceFilter === option.value}
                                    key={option.value}
                                    onClick={() => { stopPlayback(); setSourceFilter(option.value); setPage(0); setAudioError(null); }}
                                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${sourceFilter === option.value ? 'bg-slate-900/10 text-slate-700' : 'text-slate-400 active:bg-black/5'}`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </header>

                <main key={`${filter}-${page}`} className="favorites-list flex-1 min-h-0 overflow-y-auto py-2">
                    {loading ? (
                        <div className="h-full grid place-items-center text-sm text-slate-400">正在整理收藏…</div>
                    ) : visible.length === 0 ? (
                        <div className="h-full min-h-64 grid place-items-center text-center px-8">
                            <div>
                                {filter === 'voice' ? <Waveform size={34} className="mx-auto text-slate-300" /> : filter === 'text' ? <FileText size={34} className="mx-auto text-slate-300" /> : <Star size={34} className="mx-auto text-slate-300" />}
                                <p className="mt-4 text-sm font-bold text-slate-500">{emptyTitle}</p>
                                <p className="mt-1.5 text-xs leading-5 text-slate-400">{emptyHint}</p>
                            </div>
                        </div>
                    ) : visible.map((entry, index) => {
                        const rowId = itemId(entry);
                        const isVoice = entry.kind === 'voice';
                        const voice = isVoice ? entry.item : null;
                        const text = isVoice ? null : entry.item;
                        const active = playingId === rowId;
                        const senderName = text ? (text.role === 'user' ? '我' : text.charName) : voice?.charName;
                        const sourceLabel = text ? textFavoriteSourceLabel(text.source) : voiceFavoriteSourceLabel(voice!.source);
                        const primaryText = text?.content || voice?.originalText || voice?.spokenText || '（无文字）';
                        const secondary = voice ? (voice.translation || voice.spokenText) : undefined;
                        const showSecondary = !!secondary && secondary.trim() !== voice?.originalText.trim();
                        return (
                            <article key={rowId} className="favorite-row flex gap-3 py-4 border-b border-slate-900/10" style={{ animationDelay: `${Math.min(index, 5) * 18}ms` }}>
                                {voice ? (
                                    <button
                                        type="button"
                                        onClick={() => void playVoice(voice)}
                                        className={`mt-0.5 shrink-0 w-11 h-11 grid place-items-center rounded-full transition-colors ${active ? 'bg-amber-500 text-white' : 'bg-slate-800 text-white active:bg-slate-700'}`}
                                        aria-label={active ? '暂停' : '播放'}
                                    >
                                        {active ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" className="ml-0.5" />}
                                    </button>
                                ) : (
                                    <div className="mt-0.5 shrink-0 w-11 h-11 grid place-items-center rounded-full bg-amber-50 text-amber-600 border border-amber-100" aria-hidden>
                                        <FileText size={18} weight="bold" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                                        <span className="font-bold text-slate-700">{senderName}</span>
                                        <span className={`px-1.5 py-0.5 rounded ${isVoice ? 'bg-slate-900/5' : 'bg-amber-500/10 text-amber-700'}`}>{isVoice ? '语音' : '文字'}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-slate-900/5">{sourceLabel}</span>
                                        <time>{formatTime(entry.item.sourceTimestamp)}</time>
                                    </div>
                                    <p className="mt-2 text-[14px] leading-6 text-slate-800 whitespace-pre-wrap break-words">{primaryText}</p>
                                    {showSecondary && (
                                        <p className="mt-1 text-[12px] leading-5 text-slate-500 whitespace-pre-wrap break-words">
                                            <span className="mr-1.5 text-[10px] font-bold text-amber-700">{voice?.translation ? '翻译' : '语音'}</span>{secondary}
                                        </p>
                                    )}
                                </div>
                                <button type="button" onClick={() => void remove(entry)} className="self-start shrink-0 w-9 h-9 grid place-items-center rounded-full text-slate-400 active:bg-rose-50 active:text-rose-500" aria-label="取消收藏">
                                    <Trash size={16} />
                                </button>
                            </article>
                        );
                    })}
                </main>

                {audioError && <div className="shrink-0 py-2 text-center text-[11px] text-rose-600">{audioError}</div>}
                <footer className="shrink-0 min-h-[62px] pb-[max(12px,env(safe-area-inset-bottom))] pt-2 border-t border-slate-900/10 flex items-center justify-between">
                    <button type="button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))} className="w-10 h-10 grid place-items-center rounded-full text-slate-600 disabled:opacity-20 active:bg-black/5" aria-label="上一页"><CaretLeft size={18} weight="bold" /></button>
                    <span className="text-[11px] tabular-nums text-slate-500">第 {page + 1} / {pageCount} 页 · 每页 10 条</span>
                    <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} className="w-10 h-10 grid place-items-center rounded-full text-slate-600 disabled:opacity-20 active:bg-black/5" aria-label="下一页"><CaretRight size={18} weight="bold" /></button>
                </footer>
            </div>
        </div>
    );

    return createPortal(portal, document.body);
};

export default FavoritesPortal;
