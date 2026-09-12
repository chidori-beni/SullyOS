import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    CaretLeft,
    CaretRight,
    FileText,
    MagnifyingGlass,
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
import {
    TEXT_FAVORITE_COLLECTIONS_CHANGED_EVENT,
    listTextFavoriteCollections,
    removeTextFavoriteCollection,
    type TextFavoriteCollection,
} from '../../utils/textFavoriteCollections';
import {
    MESSAGE_FAVORITE_COLLECTIONS_CHANGED_EVENT,
    MESSAGE_FAVORITE_COLLECTION_COLLAPSE_THRESHOLD,
    getMessageFavoriteCollectionVisibleMessages,
    getMessageFavoriteCollectionMediaBlob,
    listMessageFavoriteCollections,
    removeMessageFavoriteCollection,
    type MessageFavoriteCollection,
    type MessageFavoriteCollectionMessage,
} from '../../utils/messageFavoriteCollections';
import { chatMessageFuzzyMatchesKeyword } from '../../utils/chatMessageSearch';

const PAGE_SIZE = 10;

/**
 * 一条收藏里「能拿来搜」的文字。
 *
 * 四种收藏结构不一样：语音有原文、朗读稿和翻译，文字有正文，两种合集要把里面每条
 * 消息的说话人和正文摊平进来。角色名一律带上——「搜角色名把 ta 的收藏都翻出来」是
 * 最常用的一种找法。媒体消息用它的可读兜底文案，不拿 URL 去搜。
 */
const searchableFavoriteText = (entry: UnifiedFavorite): string => {
    const parts: string[] = [entry.item.charName || ''];
    if (entry.kind === 'voice') {
        parts.push(entry.item.originalText || '', entry.item.spokenText || '', entry.item.translation || '');
    } else if (entry.kind === 'text') {
        parts.push(entry.item.content || '');
    } else {
        for (const message of entry.item.messages) {
            parts.push(message.speakerName || '', message.content || '');
            if ('spokenText' in message) parts.push(message.spokenText || '');
        }
    }
    return parts.filter(Boolean).join(' ');
};
type FavoriteFilter = 'all' | 'text' | 'voice';
type SourceFilter = 'all' | VoiceFavoriteSource;
type UnifiedFavorite =
    | { kind: 'voice'; item: VoiceFavorite }
    | { kind: 'text'; item: TextFavorite }
    | { kind: 'text-collection'; item: TextFavoriteCollection }
    | { kind: 'message-collection'; item: MessageFavoriteCollection };

interface FavoritesPortalProps {
    onClose: () => void;
}

const filters: Array<{ value: FavoriteFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'text', label: '文字/组' },
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
const sourceOf = (item: UnifiedFavorite): SourceFilter => item.item.source;
const isCollection = (item: UnifiedFavorite): item is Extract<UnifiedFavorite, { kind: 'text-collection' | 'message-collection' }> => (
    item.kind === 'text-collection' || item.kind === 'message-collection'
);
const sourceTimestampOf = (item: UnifiedFavorite): number => {
    if (!isCollection(item)) return item.item.sourceTimestamp;
    return item.item.messages.reduce((latest, message) => Math.max(latest, message.timestamp), 0);
};
const favoritedAtOf = (item: UnifiedFavorite): number => item.item.favoritedAt;

const sortUnifiedFavorites = (items: UnifiedFavorite[]): UnifiedFavorite[] => (
    [...items].sort((a, b) => {
        const sourceTime = sourceTimestampOf(b) - sourceTimestampOf(a);
        if (sourceTime !== 0) return sourceTime;
        const savedTime = favoritedAtOf(b) - favoritedAtOf(a);
        if (savedTime !== 0) return savedTime;
        return itemId(b).localeCompare(itemId(a));
    })
);

const CollectionMessageMedia: React.FC<{
    message: MessageFavoriteCollectionMessage;
    compact?: boolean;
}> = ({ message, compact = false }) => {
    const [mediaUrl, setMediaUrl] = useState<string | null>(null);
    const [mediaState, setMediaState] = useState<'loading' | 'ready' | 'missing' | 'error'>(
        message.kind === 'text' ? 'ready' : 'loading',
    );

    useEffect(() => {
        if (message.kind === 'text') return;
        let cancelled = false;
        let objectUrl: string | null = null;
        setMediaUrl(null);
        setMediaState('loading');
        (async () => {
            let url: string | null = null;
            if (message.media?.assetKey) {
                const blob = await getMessageFavoriteCollectionMediaBlob(message.media.assetKey).catch(() => null);
                if (blob) {
                    const nextObjectUrl = URL.createObjectURL(blob);
                    if (cancelled) {
                        URL.revokeObjectURL(nextObjectUrl);
                        return;
                    }
                    objectUrl = nextObjectUrl;
                    url = nextObjectUrl;
                }
            }
            if (!url && message.media?.remoteUrl) url = message.media.remoteUrl;
            if (cancelled) return;
            if (url) {
                setMediaUrl(url);
                setMediaState('ready');
            } else {
                setMediaState('missing');
            }
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [message.kind, message.media?.assetKey, message.media?.remoteUrl]);

    if (message.kind === 'text') {
        return <p className="mt-1.5 text-[14px] leading-6 text-slate-800 whitespace-pre-wrap break-words">{message.content}</p>;
    }

    if (message.kind === 'voice') {
        return (
            <div className="mt-2 space-y-1.5" data-no-toggle>
                {mediaUrl && mediaState === 'ready' ? (
                    <audio controls preload="metadata" src={mediaUrl} className="w-full h-10" onError={() => setMediaState('error')} />
                ) : (
                    <div className="rounded-xl bg-slate-900/5 px-3 py-2 text-[12px] text-slate-500">
                        {mediaState === 'loading' ? '正在加载语音…' : '语音文件暂不可用'}
                    </div>
                )}
                <p className="text-[13px] leading-5 text-slate-600 whitespace-pre-wrap break-words">{message.content}</p>
                {message.spokenText && message.spokenText !== message.content && (
                    <p className="text-[12px] leading-5 text-slate-400 whitespace-pre-wrap break-words">语音：{message.spokenText}</p>
                )}
            </div>
        );
    }

    return (
        <div className="mt-2" data-no-toggle>
            {mediaUrl && mediaState === 'ready' ? (
                <img
                    src={mediaUrl}
                    alt={message.kind === 'emoji' ? '表情包' : '图片'}
                    loading="lazy"
                    onError={() => setMediaState('error')}
                    className={`block w-auto max-w-full rounded-xl object-contain ${compact ? 'max-h-24' : 'max-h-64'}`}
                />
            ) : (
                <div className="rounded-xl bg-slate-900/5 px-3 py-2 text-[12px] text-slate-500">
                    {mediaState === 'loading' ? '正在加载图片…' : `${message.kind === 'emoji' ? '表情包' : '图片'}暂不可用`}
                </div>
            )}
            <p className="mt-1.5 text-[12px] leading-5 text-slate-400">{message.content}</p>
        </div>
    );
};

const FavoritesPortal: React.FC<FavoritesPortalProps> = ({ onClose }) => {
    const [voiceItems, setVoiceItems] = useState<VoiceFavorite[]>([]);
    const [textItems, setTextItems] = useState<TextFavorite[]>([]);
    const [textCollections, setTextCollections] = useState<TextFavoriteCollection[]>([]);
    const [messageCollections, setMessageCollections] = useState<MessageFavoriteCollection[]>([]);
    const [filter, setFilter] = useState<FavoriteFilter>('all');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [page, setPage] = useState(0);
    const [searchOpen, setSearchOpen] = useState(false);
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(true);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set());
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const refreshGenerationRef = useRef(0);
    const mountedRef = useRef(true);

    const refresh = useCallback(async () => {
        const generation = ++refreshGenerationRef.current;
        const [voices, texts, collections, mixedCollections] = await Promise.all([
            listVoiceFavorites().catch(() => [] as VoiceFavorite[]),
            listTextFavorites().catch(() => [] as TextFavorite[]),
            listTextFavoriteCollections().catch(() => [] as TextFavoriteCollection[]),
            listMessageFavoriteCollections().catch(() => [] as MessageFavoriteCollection[]),
        ]);
        if (!mountedRef.current || generation !== refreshGenerationRef.current) return;
        setVoiceItems(voices);
        setTextItems(texts);
        setTextCollections(collections);
        setMessageCollections(mixedCollections);
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
        window.addEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh);
        window.addEventListener(TEXT_FAVORITES_CHANGED_EVENT, refresh);
        window.addEventListener(TEXT_FAVORITE_COLLECTIONS_CHANGED_EVENT, refresh);
        window.addEventListener(MESSAGE_FAVORITE_COLLECTIONS_CHANGED_EVENT, refresh);
        return () => {
            mountedRef.current = false;
            window.removeEventListener(VOICE_FAVORITES_CHANGED_EVENT, refresh);
            window.removeEventListener(TEXT_FAVORITES_CHANGED_EVENT, refresh);
            window.removeEventListener(TEXT_FAVORITE_COLLECTIONS_CHANGED_EVENT, refresh);
            window.removeEventListener(MESSAGE_FAVORITE_COLLECTIONS_CHANGED_EVENT, refresh);
        };
    }, [refresh]);

    useEffect(() => () => {
        audioRef.current?.pause();
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    }, []);

    useEffect(() => {
        const currentIds = new Set([
            ...textCollections.map(item => `text-collection:${item.id}`),
            ...messageCollections.map(item => `message-collection:${item.id}`),
        ]);
        setExpandedCollectionIds(previous => {
            const next = new Set([...previous].filter(id => currentIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
    }, [messageCollections, textCollections]);

    const allItems = useMemo<UnifiedFavorite[]>(() => sortUnifiedFavorites([
        ...voiceItems.map(item => ({ kind: 'voice' as const, item })),
        ...textItems.map(item => ({ kind: 'text' as const, item })),
        ...textCollections.map(item => ({ kind: 'text-collection' as const, item })),
        ...messageCollections.map(item => ({ kind: 'message-collection' as const, item })),
    ]), [messageCollections, textCollections, textItems, voiceItems]);
    const filtered = useMemo(
        () => allItems.filter(item => (
            (filter === 'all'
                || (filter === 'text' && (item.kind === 'text' || item.kind === 'text-collection' || item.kind === 'message-collection'))
                || (filter === 'voice' && (
                    item.kind === 'voice'
                    || (item.kind === 'message-collection' && item.item.messages.some(message => message.kind === 'voice'))
                )))
            && (sourceFilter === 'all' || sourceOf(item) === sourceFilter)
            // 关键词挂在最后一层：先按类型 / 来源筛，再在结果里找词。
            // 复用聊天记录搜索那一套匹配（NFKC 归一化 + 子序列模糊匹配），两处行为一致。
            && chatMessageFuzzyMatchesKeyword({ type: 'text', content: searchableFavoriteText(item) }, keyword)
        )),
        [allItems, filter, keyword, sourceFilter],
    );
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    useEffect(() => {
        if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
    }, [page, pageCount]);

    // 改完关键词还停在第 3 页会看起来「什么都没搜到」，回第一页。
    useEffect(() => { setPage(0); }, [keyword]);

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
        if (removingId) return;
        if (playingId === rowId) stopPlayback();
        setRemovingId(rowId);
        try {
            if (entry.kind === 'voice') await removeVoiceFavoriteById(entry.item.id);
            else if (entry.kind === 'text-collection') await removeTextFavoriteCollection(entry.item.id);
            else if (entry.kind === 'message-collection') await removeMessageFavoriteCollection(entry.item.id);
            else await removeTextFavoriteById(entry.item.id);
            if (isCollection(entry)) {
                setExpandedCollectionIds(previous => {
                    if (!previous.has(rowId)) return previous;
                    const next = new Set(previous);
                    next.delete(rowId);
                    return next;
                });
            }
            await refresh();
        } finally {
            if (mountedRef.current) setRemovingId(null);
        }
    };

    const emptyTitle = filter === 'text' ? '这里还没有文字或消息组'
        : filter === 'voice' ? '这里还没有语音收藏'
            : '这里还没有收藏';
    const emptyHint = filter === 'text'
        ? '聊天里长按可收藏单条；想保留前因后果，请进入多选后点“收藏为一组”。语音和图片也会保留在组里。'
        : filter === 'voice'
            ? '在聊天、通话或见面里长按语音，就能收进来。'
            : '在消息上长按，把想留下的文字、语音或图片收进来；多选还能保存成完整片段。';

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
                            <p className="mt-0.5 text-[10px] text-slate-500">{allItems.length} 项 · 文字 {textItems.length} 条 / {textCollections.length} 组 · 语音 {voiceItems.length}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setSearchOpen(open => {
                                    if (open) setKeyword('');   // 收起时清空，免得筛选悄悄留着
                                    return !open;
                                });
                            }}
                            aria-pressed={searchOpen}
                            aria-label={searchOpen ? '关闭搜索' : '搜索收藏'}
                            className={`w-10 h-10 -mr-1 grid place-items-center rounded-full transition-colors ${searchOpen ? 'bg-slate-900/10 text-slate-800' : 'text-slate-600 active:bg-black/5'}`}
                        >
                            <MagnifyingGlass size={21} weight="bold" />
                        </button>
                    </div>
                    {searchOpen && (
                        <div className="mt-2 flex items-center gap-2 rounded-full bg-slate-900/5 px-3 h-9">
                            <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-slate-400" />
                            <input
                                autoFocus
                                value={keyword}
                                onChange={event => setKeyword(event.target.value)}
                                placeholder="搜正文、角色名、朗读稿…"
                                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
                                aria-label="搜索收藏"
                            />
                            {keyword && (
                                <button type="button" onClick={() => setKeyword('')} className="shrink-0 w-6 h-6 grid place-items-center rounded-full text-slate-400 active:bg-black/5" aria-label="清空关键词">
                                    <X size={13} weight="bold" />
                                </button>
                            )}
                        </div>
                    )}
                    {searchOpen && keyword.trim() !== '' && (
                        <p className="mt-1.5 text-center text-[10px] text-slate-400">
                            找到 {filtered.length} 项
                        </p>
                    )}
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
                    {filter === 'text' && (
                        <p className="mt-2 text-center text-[10px] leading-4 text-slate-400">
                            多选聊天消息后点“收藏为一组”，这里会按一段完整对话显示；语音和图片也会保留在组里
                        </p>
                    )}
                </header>

                <main key={`${filter}-${sourceFilter}-${page}`} className="favorites-list flex-1 min-h-0 overflow-y-auto py-2">
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
                        if (isCollection(entry)) {
                            const messages = entry.item.messages;
                            const mixedMessages = entry.kind === 'message-collection' ? entry.item.messages : null;
                            const mixed = !!mixedMessages;
                            const collapsible = messages.length > MESSAGE_FAVORITE_COLLECTION_COLLAPSE_THRESHOLD;
                            const expanded = expandedCollectionIds.has(rowId);
                            const shownMessages = getMessageFavoriteCollectionVisibleMessages(messages, expanded);
                            const first = messages[0];
                            const last = messages[messages.length - 1];
                            const timeLabel = first.timestamp === last.timestamp
                                ? formatTime(first.timestamp)
                                : `${formatTime(first.timestamp)} - ${formatTime(last.timestamp)}`;
                            const toggleExpanded = () => setExpandedCollectionIds(previous => {
                                const next = new Set(previous);
                                if (next.has(rowId)) next.delete(rowId);
                                else next.add(rowId);
                                return next;
                            });
                            const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
                                if (!collapsible) return;
                                const target = event.target;
                                if (target instanceof Element && target.closest('button,audio,img,input,select,textarea,[data-no-toggle]')) return;
                                toggleExpanded();
                            };
                            const kindLabels = mixedMessages
                                ? [...new Set(mixedMessages.map(message => message.kind))].map(kind => ({
                                    text: '文字', voice: '语音', emoji: '表情', image: '图片',
                                }[kind])).join(' · ')
                                : '文字片段';
                            return (
                                <article
                                    key={rowId}
                                    className={`favorite-row py-4 border-b border-slate-900/10 ${collapsible ? 'cursor-pointer' : ''}`}
                                    style={{ animationDelay: `${Math.min(index, 5) * 18}ms` }}
                                    data-kind={entry.kind}
                                    onClick={handleCardClick}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 shrink-0 w-11 h-11 grid place-items-center rounded-full bg-amber-50 text-amber-600 border border-amber-100" aria-hidden>
                                            {mixed ? <Star size={18} weight="fill" /> : <FileText size={18} weight="bold" />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                                                <span className="font-bold text-slate-700">{entry.item.charName}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700">{kindLabels}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-slate-900/5">{messages.length} 条</span>
                                                <time>{timeLabel}</time>
                                            </div>
                                            {collapsible && (
                                                <button
                                                    type="button"
                                                    onClick={event => { event.stopPropagation(); toggleExpanded(); }}
                                                    className="mt-1.5 text-[11px] font-bold text-amber-700 active:text-amber-900"
                                                    aria-expanded={expanded}
                                                >
                                                    {expanded ? '收起全文' : '卡片预览 · 点开查看全部'}
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            disabled={removingId === rowId}
                                            onClick={event => { event.stopPropagation(); void remove(entry); }}
                                            className="self-start shrink-0 w-9 h-9 grid place-items-center rounded-full text-slate-400 active:bg-rose-50 active:text-rose-500 disabled:opacity-40"
                                            aria-label="取消整组收藏"
                                        >
                                            <Trash size={16} />
                                        </button>
                                    </div>
                                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-900/5 bg-white/70">
                                        {shownMessages.map((message, messageIndex) => (
                                            <div key={`${message.messageId}-${messageIndex}`} className={`px-3.5 py-3 ${messageIndex > 0 ? 'border-t border-slate-900/5' : ''}`}>
                                                <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400">
                                                    <span className="font-bold text-slate-600">{message.speakerName}</span>
                                                    <time className="shrink-0">{formatTime(message.timestamp)}</time>
                                                </div>
                                                {mixed
                                                    ? <CollectionMessageMedia message={message as MessageFavoriteCollectionMessage} compact={!expanded} />
                                                    : <p className="mt-1.5 text-[14px] leading-6 text-slate-800 whitespace-pre-wrap break-words">{message.content}</p>}
                                            </div>
                                        ))}
                                    </div>
                                    {collapsible && !expanded && (
                                        <button
                                            type="button"
                                            onClick={event => { event.stopPropagation(); toggleExpanded(); }}
                                            className="mt-2 w-full rounded-xl bg-slate-900/5 py-2 text-[11px] font-bold text-slate-600 active:bg-slate-900/10"
                                            aria-expanded={false}
                                        >
                                            还有 {messages.length - shownMessages.length} 条，展开查看完整内容
                                        </button>
                                    )}
                                </article>
                            );
                        }

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
                                <button type="button" disabled={removingId === rowId} onClick={() => void remove(entry)} className="self-start shrink-0 w-9 h-9 grid place-items-center rounded-full text-slate-400 active:bg-rose-50 active:text-rose-500 disabled:opacity-40" aria-label="取消收藏">
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
