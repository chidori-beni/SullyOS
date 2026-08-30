import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    BellSlash,
    CaretDown,
    CaretLeft,
    ChatCircleDots,
    Check,
    DownloadSimple,
    MagnifyingGlass,
    NotePencil,
    PencilSimple,
    Planet,
    PushPin,
    Rows,
    Star,
    UserCircle,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, CharacterProfile, Message, SocialPost } from '../types';
import { DB } from '../utils/db';
import { listTextFavorites, TextFavorite } from '../utils/textFavorites';
import { getVoiceFavoriteBlob, listVoiceFavorites, VoiceFavorite } from '../utils/voiceFavorites';
import {
    DEFAULT_MESSAGING_LIST_PREFS,
    EMPTY_MESSAGING_THEME_STATE,
    loadMessagingListPrefs,
    loadMessagingThemeState,
    messagingLengthBucket,
    messagingTimeSlot,
    messagingUnreadBucket,
    MessagingListPrefs,
    MessagingThemeState,
    saveMessagingListPrefs,
    saveMessagingThemeState,
    scopeMessagingCss,
} from '../utils/messagingTheme';
import MessagingThemeSettings from '../components/messaging/MessagingThemeSettings';
import Chat from './Chat';
import '../components/messaging/MessagingApp.css';

type MessagingTab = 'chat' | 'moments' | 'favorites' | 'profile';

interface ChatSummary {
    char: CharacterProfile;
    last: Message | null;
}

interface ContextMenuState {
    charId: string;
    x: number;
    y: number;
}

const FALLBACK_GROUP_ID = '__ungrouped__';

const messageTypeLabel: Partial<Record<Message['type'], string>> = {
    image: '[图片]',
    emoji: '[表情]',
    voice: '[语音]',
    interaction: '[互动]',
    transfer: '[转账]',
    social_card: '[动态分享]',
    chat_forward: '[聊天记录]',
    xhs_card: '[小红书]',
    music_card: '[音乐]',
    webpage_card: '[网页]',
    theater_card: '[小剧场]',
    schedule_invite: '[日程邀请]',
};

const cleanPreview = (message: Message | null, composing: boolean): string => {
    if (composing) return '正在送达消息…';
    if (!message) return '还没有消息，来打个招呼吧';
    if (message.type !== 'text') return messageTypeLabel[message.type] || '[消息]';
    return message.content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[[^\]]*(?:系统|隐藏|metadata)[^\]]*\]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || '[消息]';
};

const formatListTime = (timestamp?: number): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    if (now.getTime() - date.getTime() < 6 * 86400000) return '周' + '日一二三四五六'[date.getDay()];
    return `${date.getMonth() + 1}/${date.getDate()}`;
};

const contextAttrs = (tab: MessagingTab, unreadTotal: number, searching: boolean) => {
    const hour = new Date().getHours();
    return {
        'data-active-tab': tab,
        'data-color-scheme': window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        'data-time-of-day': messagingTimeSlot(hour),
        'data-time-slot': messagingTimeSlot(hour),
        'data-hour': String(hour),
        'data-unread-total': String(unreadTotal),
        'data-searching': String(searching),
        'data-view-mode': 'list',
    } as const;
};

const Messaging: React.FC = () => {
    const {
        addToast,
        characterGroups,
        characters,
        clearUnread,
        closeApp,
        lastMsgTimestamp,
        openApp,
        proactiveComposingChars,
        setActiveCharacterId,
        unreadMessages,
        userProfile,
    } = useOS();
    const [view, setView] = useState<'list' | 'detail'>('list');
    const [tab, setTab] = useState<MessagingTab>('chat');
    const [previousTab, setPreviousTab] = useState<MessagingTab>('chat');
    const [search, setSearch] = useState('');
    const [summaries, setSummaries] = useState<ChatSummary[]>([]);
    const [posts, setPosts] = useState<SocialPost[]>([]);
    const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
    const [textFavorites, setTextFavorites] = useState<TextFavorite[]>([]);
    const [voiceFavorites, setVoiceFavorites] = useState<VoiceFavorite[]>([]);
    const [favoriteKind, setFavoriteKind] = useState<'text' | 'voice'>('text');
    const [themeState, setThemeState] = useState<MessagingThemeState>({ ...EMPTY_MESSAGING_THEME_STATE });
    const [previewCss, setPreviewCss] = useState('');
    const [themeOpen, setThemeOpen] = useState(false);
    const [prefs, setPrefs] = useState<MessagingListPrefs>({ ...DEFAULT_MESSAGING_LIST_PREFS });
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const themeLongPressTimer = useRef<number | null>(null);
    const themeLongPressed = useRef(false);
    const itemLongPressTimer = useRef<number | null>(null);
    const itemLongPressed = useRef(false);

    useEffect(() => {
        let alive = true;
        Promise.all([loadMessagingThemeState(), loadMessagingListPrefs()]).then(([loadedTheme, loadedPrefs]) => {
            if (!alive) return;
            setThemeState(loadedTheme);
            setPreviewCss(loadedTheme.css);
            setPrefs(loadedPrefs);
        });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        let alive = true;
        Promise.all(characters.map(async char => {
            const recent = await DB.getRecentMessagesByCharId(char.id, 1, true).catch(() => [] as Message[]);
            return { char, last: recent[recent.length - 1] || null } satisfies ChatSummary;
        })).then(items => {
            if (!alive) return;
            setSummaries(items);
        });
        return () => { alive = false; };
    }, [characters, lastMsgTimestamp]);

    useEffect(() => {
        let alive = true;
        Promise.all([
            DB.getSocialPosts().catch(() => [] as SocialPost[]),
            DB.getGalleryImages().catch(() => []),
            listTextFavorites().catch(() => []),
            listVoiceFavorites().catch(() => []),
        ]).then(([nextPosts, images, nextText, nextVoice]) => {
            if (!alive) return;
            setPosts(nextPosts.sort((a, b) => b.timestamp - a.timestamp));
            setGalleryUrls(images.sort((a, b) => b.timestamp - a.timestamp).slice(0, 12).map(item => item.url));
            setTextFavorites(nextText);
            setVoiceFavorites(nextVoice);
        });
        return () => { alive = false; };
    }, [tab, lastMsgTimestamp]);

    const unreadTotal = useMemo(() => Object.values(unreadMessages).reduce((sum, value) => sum + (Number(value) || 0), 0), [unreadMessages]);
    const scopedCss = useMemo(() => {
        try { return scopeMessagingCss(previewCss); }
        catch { return ''; }
    }, [previewCss]);

    const orderedSummaries = useMemo(() => {
        const needle = search.trim().toLocaleLowerCase();
        return summaries
            .filter(item => !needle || item.char.name.toLocaleLowerCase().includes(needle) || cleanPreview(item.last, !!proactiveComposingChars[item.char.id]).toLocaleLowerCase().includes(needle))
            .sort((a, b) => {
                const pinDiff = Number(prefs.pinnedCharacterIds.includes(b.char.id)) - Number(prefs.pinnedCharacterIds.includes(a.char.id));
                if (pinDiff) return pinDiff;
                return (b.last?.timestamp || 0) - (a.last?.timestamp || 0);
            });
    }, [prefs.pinnedCharacterIds, proactiveComposingChars, search, summaries]);

    const groupedSummaries = useMemo(() => {
        if (!prefs.groupingEnabled) return [{ id: 'all', name: '', items: orderedSummaries }];
        const groupMap = new Map<string, ChatSummary[]>();
        orderedSummaries.forEach(item => {
            const groupId = item.char.groupId || FALLBACK_GROUP_ID;
            groupMap.set(groupId, [...(groupMap.get(groupId) || []), item]);
        });
        const named = characterGroups
            .filter(group => groupMap.has(group.id))
            .sort((a, b) => (a.order || a.createdAt || 0) - (b.order || b.createdAt || 0))
            .map(group => ({ id: group.id, name: group.name, items: groupMap.get(group.id)! }));
        if (groupMap.has(FALLBACK_GROUP_ID)) named.push({ id: FALLBACK_GROUP_ID, name: '未分组', items: groupMap.get(FALLBACK_GROUP_ID)! });
        return named;
    }, [characterGroups, orderedSummaries, prefs.groupingEnabled]);

    const persistPrefs = useCallback(async (next: MessagingListPrefs) => {
        setPrefs(next);
        await saveMessagingListPrefs(next).catch(() => addToast('好友列表设置保存失败', 'error'));
    }, [addToast]);

    const selectTab = (next: MessagingTab) => {
        if (themeLongPressed.current) { themeLongPressed.current = false; return; }
        setPreviousTab(tab);
        setTab(next);
        setContextMenu(null);
    };

    const openChat = (charId: string) => {
        setActiveCharacterId(charId);
        clearUnread(charId);
        setView('detail');
    };

    const openThemeSettings = () => {
        setPreviewCss(themeState.css);
        setThemeOpen(true);
    };

    const startThemeLongPress = () => {
        themeLongPressed.current = false;
        if (themeLongPressTimer.current) window.clearTimeout(themeLongPressTimer.current);
        themeLongPressTimer.current = window.setTimeout(() => {
            themeLongPressed.current = true;
            openThemeSettings();
        }, 550);
    };

    const cancelThemeLongPress = () => {
        if (themeLongPressTimer.current) window.clearTimeout(themeLongPressTimer.current);
        themeLongPressTimer.current = null;
    };

    const openItemMenu = (event: React.PointerEvent | React.MouseEvent, charId: string) => {
        const x = Math.min(event.clientX, window.innerWidth - 184);
        const y = Math.min(event.clientY, window.innerHeight - 150);
        setContextMenu({ charId, x: Math.max(8, x), y: Math.max(8, y) });
    };

    const startItemLongPress = (event: React.PointerEvent, charId: string) => {
        itemLongPressed.current = false;
        if (itemLongPressTimer.current) window.clearTimeout(itemLongPressTimer.current);
        itemLongPressTimer.current = window.setTimeout(() => {
            itemLongPressed.current = true;
            openItemMenu(event, charId);
        }, 520);
    };

    const cancelItemLongPress = () => {
        if (itemLongPressTimer.current) window.clearTimeout(itemLongPressTimer.current);
        itemLongPressTimer.current = null;
    };

    const togglePinned = async (charId: string) => {
        const pinned = prefs.pinnedCharacterIds.includes(charId);
        await persistPrefs({
            ...prefs,
            pinnedCharacterIds: pinned ? prefs.pinnedCharacterIds.filter(id => id !== charId) : [charId, ...prefs.pinnedCharacterIds],
        });
        setContextMenu(null);
    };

    const playVoiceFavorite = async (favorite: VoiceFavorite) => {
        const blob = await getVoiceFavoriteBlob(favorite.id);
        if (!blob) return addToast('这条语音的音频文件已不存在', 'error');
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        await audio.play().catch(() => addToast('语音播放失败', 'error'));
    };

    if (view === 'detail') return <Chat onBack={() => setView('list')} />;

    const attrs = contextAttrs(tab, unreadTotal, !!search.trim());

    const header = (title: string, action?: React.ReactNode, extraClass = '') => (
        <header className={`nj-chat-tab-header ${extraClass}`}>
            <button className="nj-chat-tab-header-back nj-chat-tab-header-back-btn" aria-label="返回桌面" onClick={closeApp}><CaretLeft weight="bold" /></button>
            <div className="nj-chat-tab-header-title nj-chat-tab-header-title-container nj-chat-tab-header-title-wrap"><span className="nj-chat-tab-header-title-btn">{title}</span></div>
            {action || <span />}
        </header>
    );

    const renderChatTab = () => (
        <section id="messaging-chat-tab" className="nj-chat-tab" data-empty={String(orderedSummaries.length === 0)}>
            <div className="nj-chat-tab-decor-top" /><div className="nj-chat-tab-decor-mid" /><div className="nj-chat-tab-decor-bottom" />
            {header('消息', <button className="nj-chat-tab-header-action nj-chat-tab-header-action-btn nj-chat-tab-header-edit" aria-label="编辑角色" onClick={() => openApp(AppID.Character)}><NotePencil /></button>)}
            <div className="nj-chat-tab-search-wrap">
                <label className="nj-chat-tab-search">
                    <MagnifyingGlass size={16} />
                    <input className="nj-chat-tab-search-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索" aria-label="搜索好友和消息" />
                </label>
            </div>
            {!!characters.length && !search && (
                <div className="nj-chat-tab-note-row nj-chat-tab-notes">
                    {orderedSummaries.slice(0, 6).map(({ char, last }) => (
                        <button key={char.id} className="nj-chat-tab-note-item nj-chat-tab-note-friend" onClick={() => openChat(char.id)}>
                            <span className="nj-chat-tab-note-bubble">{cleanPreview(last, !!proactiveComposingChars[char.id]).slice(0, 14)}</span>
                            <img className="nj-chat-tab-note-avatar" src={char.avatar} alt="" />
                            <span className="nj-chat-tab-note-name">{char.name}</span>
                        </button>
                    ))}
                </div>
            )}
            <div className="nj-chat-tab-section-header">
                <div className="nj-chat-tab-section-title">消息</div>
                {!prefs.groupButtonHidden && <span className="nj-chat-tab-group-toggle-wrap"><button className={`nj-chat-tab-group-toggle ${groupMenuOpen ? 'active' : ''}`} aria-label="好友分组设置" onClick={() => setGroupMenuOpen(value => !value)}><Rows className="nj-chat-tab-group-toggle-icon" /></button></span>}
                {groupMenuOpen && <>
                    <button className="nj-group-menu-mask" aria-label="关闭分组菜单" onClick={() => setGroupMenuOpen(false)} />
                    <div className="nj-group-menu nj-chat-group-toggle-menu">
                        <button className="nj-group-menu-item nj-chat-group-toggle-menu-item" onClick={() => { void persistPrefs({ ...prefs, groupingEnabled: !prefs.groupingEnabled }); setGroupMenuOpen(false); }}><Check opacity={prefs.groupingEnabled ? 1 : 0} />按角色分组显示</button>
                        <button className="nj-group-menu-item nj-chat-group-toggle-menu-item" onClick={() => { void persistPrefs({ ...prefs, collapsedGroupIds: [] }); setGroupMenuOpen(false); }}><Rows />展开全部分组</button>
                        <button className="nj-group-menu-item nj-chat-group-toggle-menu-item" onClick={() => { void persistPrefs({ ...prefs, collapsedGroupIds: groupedSummaries.map(group => group.id) }); setGroupMenuOpen(false); }}><CaretDown />收起全部分组</button>
                    </div>
                </>}
            </div>
            <div className="nj-chat-tab-list">
                {groupedSummaries.map(group => {
                    const collapsed = prefs.collapsedGroupIds.includes(group.id);
                    return (
                        <div className="nj-chat-tab-group" key={group.id} data-group-id={group.id} data-collapsed={String(collapsed)}>
                            {prefs.groupingEnabled && <div className="nj-chat-tab-group-header nj-chat-group-header"><button onClick={() => void persistPrefs({ ...prefs, collapsedGroupIds: collapsed ? prefs.collapsedGroupIds.filter(id => id !== group.id) : [...prefs.collapsedGroupIds, group.id] })}><span className="nj-chat-group-caret">{collapsed ? '›' : '⌄'}</span> <span className="nj-chat-group-label">{group.name}</span> · <span className="nj-chat-group-count">{group.items.length}</span></button></div>}
                            {!collapsed && group.items.map(({ char, last }, index) => {
                                const unread = unreadMessages[char.id] || 0;
                                const preview = cleanPreview(last, !!proactiveComposingChars[char.id]);
                                const hour = last ? new Date(last.timestamp).getHours() : new Date().getHours();
                                const pinned = prefs.pinnedCharacterIds.includes(char.id);
                                const style = {
                                    '--nj-item-index': String(index),
                                    '--nj-item-unread': String(unread),
                                    '--nj-item-avatar-url': `url(${JSON.stringify(char.avatar)})`,
                                } as CSSProperties;
                                return (
                                    <div
                                        key={char.id}
                                        className={`nj-chat-tab-item nj-chat-item ${pinned ? 'nj-chat-item-pinned' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        style={style}
                                        data-kind="friend"
                                        data-index={String(index)}
                                        data-alt={index % 2 ? 'odd' : 'even'}
                                        data-unread={String(unread > 0)}
                                        data-unread-count={messagingUnreadBucket(unread)}
                                        data-pinned={String(pinned)}
                                        data-muted="false"
                                        data-generating={String(!!proactiveComposingChars[char.id])}
                                        data-last-type={last?.type || 'empty'}
                                        data-length={messagingLengthBucket(preview)}
                                        data-time-slot={messagingTimeSlot(hour)}
                                        data-hour={String(hour)}
                                        onClick={() => { if (itemLongPressed.current) { itemLongPressed.current = false; return; } openChat(char.id); }}
                                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openChat(char.id); }}
                                        onPointerDown={event => startItemLongPress(event, char.id)}
                                        onPointerUp={cancelItemLongPress}
                                        onPointerCancel={cancelItemLongPress}
                                        onPointerLeave={cancelItemLongPress}
                                        onContextMenu={event => { event.preventDefault(); openItemMenu(event, char.id); }}
                                    >
                                        <div className="nj-item-deco nj-item-deco-1 heavy-anim" />
                                        <div className="nj-item-deco nj-item-deco-2 heavy-anim" />
                                        <div className="nj-chat-tab-item-avatar-wrap">
                                            <img className="nj-chat-tab-item-avatar nj-chat-item-avatar nj-avatar" src={char.avatar} alt="" />
                                            {unread > 0 && <span className="nj-chat-tab-item-unread nj-chat-item-badge nj-chat-item-unread-badge">{unread > 99 ? '99+' : unread}</span>}
                                            {!!proactiveComposingChars[char.id] && <span className="nj-chat-tab-item-generating" />}
                                        </div>
                                        <div className="nj-chat-tab-item-main nj-chat-item-body">
                                            <div className="nj-chat-tab-item-line nj-chat-item-row1">
                                                <span className="nj-chat-tab-item-name nj-chat-item-name"><span className="nj-chat-item-char">{char.name}</span>{pinned && <PushPin className="nj-chat-item-pin-mark" size={10} weight="fill" />}</span>
                                                <time className="nj-chat-tab-item-time nj-chat-item-time">{formatListTime(last?.timestamp)}</time>
                                            </div>
                                            <div className="nj-chat-tab-item-preview nj-chat-item-preview">{preview}<BellSlash className="nj-chat-tab-item-muted sully-messaging-hidden" /></div>
                                            <span className="nj-chat-item-alt-mark" aria-hidden="true" />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
                {!orderedSummaries.length && <div className="nj-empty-state"><div className="nj-empty-state-symbol">☁︎</div>{search ? '没有找到匹配的好友或消息' : '还没有好友，先去神经链接创建角色吧'}</div>}
            </div>
        </section>
    );

    const renderMomentsTab = () => (
        <section id="messaging-moments-tab" className="nj-moments-tab" data-post-count={String(posts.length)}>
            <div className="nj-moments-decor-top" /><div className="nj-moments-decor-mid" /><div className="nj-moments-decor-bottom" />
            {header('动态', <button className="nj-chat-tab-header-action nj-chat-tab-header-action-btn nj-moments-header-btn nj-moments-header-btn-gen nj-moments-header-btn-post nj-moments-header-btn-clear" aria-label="打开 Spark" onClick={() => openApp(AppID.Social)}><Planet /></button>, 'nj-moments-header nj-moments-header-sticky')}
            <div className="nj-moments-cover-wrap"><div className="nj-moments-cover">{userProfile.avatar && <img className="nj-moments-cover-avatar" src={userProfile.avatar} alt="" />}<div className="nj-moments-cover-gradient" /><div className="nj-moments-cover-userinfo"><span className="nj-moments-cover-username">{userProfile.name || '我'}</span></div></div></div>
            <div className="nj-moments-notif-entry" aria-hidden="true" />
            <div className="nj-moments-list nj-moments-feed">
                {posts.slice(0, 30).map(post => <article className="nj-moments-item nj-moments-post" key={post.id} data-author-type={post.authorType || 'unknown'} data-liked={String(post.isLiked)}>
                    <div className="nj-moments-item-head nj-moments-post-body"><img className="nj-moments-item-avatar nj-moments-post-avatar" src={post.authorAvatar} alt="" /><div><div className="nj-moments-item-author nj-moments-post-name">{post.authorName}</div><div className="nj-moments-item-time nj-moments-post-time">{formatListTime(post.timestamp)}</div></div></div>
                    <div className="nj-moments-item-content nj-moments-post-text">{post.content || post.title}</div>
                    {!!post.images?.length && <div className={`nj-moments-item-images nj-moments-post-imgs nj-moments-post-imgs-${Math.min(3, post.images.length)}`}>{post.images.slice(0, 9).map((url, index) => <img className="nj-moments-item-image nj-moments-post-img-cell" src={url} alt="" key={`${url}-${index}`} />)}</div>}
                    <div className="nj-moments-engagement"><span className="nj-moments-likes">{post.likes ? `♡ ${post.likes}` : ''}</span></div>
                </article>)}
                {!posts.length && <div className="nj-empty-state"><div className="nj-empty-state-symbol">◌</div>暂时还没有动态</div>}
            </div>
        </section>
    );

    const renderFavoritesTab = () => (
        <section id="messaging-favorites-tab" className="nj-favorites-tab" data-empty={String(!(textFavorites.length || voiceFavorites.length))}>
            <div className="nj-fav-decor-top" /><div className="nj-fav-decor-bottom" />
            {header('收藏', undefined, 'nj-favorites-tab-header')}
            <div className="nj-favorites-tabs">
                <button className={`nj-favorites-tab-button ${favoriteKind === 'text' ? 'active' : ''}`} onClick={() => setFavoriteKind('text')}>文字 {textFavorites.length}</button>
                <button className={`nj-favorites-tab-button ${favoriteKind === 'voice' ? 'active' : ''}`} onClick={() => setFavoriteKind('voice')}>语音 {voiceFavorites.length}</button>
            </div>
            <div className="nj-favorites-list nj-fav-list">
                {favoriteKind === 'text' ? textFavorites.map(item => <article className="nj-favorites-item nj-fav-card" key={item.id} data-kind="text" onClick={() => openChat(item.charId)}><div className="nj-favorites-item-author">{item.charName} · {formatListTime(item.sourceTimestamp)}</div><div className="nj-favorites-item-content">{item.content}</div></article>) : voiceFavorites.map(item => <article className="nj-favorites-item nj-fav-card" key={item.id} data-kind="voice"><div className="nj-favorites-item-author">{item.charName} · {formatListTime(item.sourceTimestamp)}</div><div className="nj-favorites-item-voice"><button className="nj-favorites-item-play" onClick={() => void playVoiceFavorite(item)}>▶</button><div className="nj-favorites-item-content">{item.spokenText || item.originalText || '语音收藏'}</div></div></article>)}
                {favoriteKind === 'text' && !textFavorites.length && <div className="nj-empty-state">聊天里收藏的文字会出现在这里</div>}
                {favoriteKind === 'voice' && !voiceFavorites.length && <div className="nj-empty-state">收藏的语音会出现在这里</div>}
            </div>
        </section>
    );

    const renderProfileTab = () => (
        <section id="messaging-profile-tab" className="nj-profile-tab">
            <div className="nj-profile-decor-top" /><div className="nj-profile-decor-mid" /><div className="nj-profile-decor-bottom" />
            {header('我的', undefined, 'nj-profile-tab-header')}
            <div className="nj-profile-cover">{userProfile.avatar && <img className="nj-profile-cover-image" src={userProfile.avatar} alt="" />}</div>
            <div className="nj-profile-card nj-profile-view nj-profile-content">
                <div className="nj-profile-top"><div className="nj-profile-avatar-wrap"><img className="nj-profile-avatar" src={userProfile.avatar} alt="" /></div></div>
                <div className="nj-profile-info nj-profile-identity"><div className="nj-profile-name-row"><div className="nj-profile-name">{userProfile.name || '我'}</div></div><div className="nj-profile-bio nj-profile-signature">{userProfile.bio || '在 Sully 的小世界里，认真生活。'}</div></div>
                <div className="nj-profile-stats"><div className="nj-profile-stat nj-profile-stat-item"><div className="nj-profile-stat-value nj-profile-stat-count">{characters.length}</div><div className="nj-profile-stat-label">好友</div></div><div className="nj-profile-stat nj-profile-stat-item"><div className="nj-profile-stat-value nj-profile-stat-count">{posts.length}</div><div className="nj-profile-stat-label">动态</div></div><div className="nj-profile-stat nj-profile-stat-item"><div className="nj-profile-stat-value nj-profile-stat-count">{textFavorites.length + voiceFavorites.length}</div><div className="nj-profile-stat-label">收藏</div></div></div>
            </div>
            <div className="nj-profile-section"><div className="nj-profile-section-title">最近照片</div>{galleryUrls.length ? <div className="nj-profile-gallery nj-profile-gallery-grid">{galleryUrls.map((url, index) => <span className="nj-profile-gallery-cell" key={`${url}-${index}`}><img className="nj-profile-gallery-image" src={url} alt="" /></span>)}</div> : <div className="nj-empty-state">相册里还没有照片</div>}</div>
        </section>
    );

    return (
        <div className="sully-messaging-app" {...attrs} data-prev-tab={previousTab} onClick={() => contextMenu && setContextMenu(null)}>
            {!!scopedCss && <style data-sully-messaging-theme>{scopedCss}</style>}
            <main id="sully-messaging-screen" className="sully-messaging-screen">
                <div className="sully-messaging-content">
                    {tab === 'chat' && renderChatTab()}
                    {tab === 'moments' && renderMomentsTab()}
                    {tab === 'favorites' && renderFavoritesTab()}
                    {tab === 'profile' && renderProfileTab()}
                </div>
                <nav id="messaging-bottom-bar" className="nj-tab-bottom-bar" aria-label="消息应用标签栏">
                    <button className={`nj-tab-bottom-item nj-tab-bottom-item-chat ${tab === 'chat' ? 'active nj-tab-bottom-item-active' : ''}`} onClick={() => selectTab('chat')} onPointerDown={startThemeLongPress} onPointerUp={cancelThemeLongPress} onPointerCancel={cancelThemeLongPress} onPointerLeave={cancelThemeLongPress} onContextMenu={event => { event.preventDefault(); openThemeSettings(); }}><span className="nj-tab-bottom-icon"><ChatCircleDots weight={tab === 'chat' ? 'fill' : 'regular'} />{unreadTotal > 0 && <span className="nj-tab-bottom-badge nj-tab-bottom-total-unread">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}</span><span className="nj-tab-bottom-label nj-tab-bottom-text">消息</span></button>
                    <button className={`nj-tab-bottom-item nj-tab-bottom-item-moments ${tab === 'moments' ? 'active nj-tab-bottom-item-active' : ''}`} onClick={() => selectTab('moments')}><span className="nj-tab-bottom-icon"><Planet weight={tab === 'moments' ? 'fill' : 'regular'} />{!!posts.length && <i className="nj-tab-bottom-moments-dot" />}</span><span className="nj-tab-bottom-label nj-tab-bottom-text">动态</span></button>
                    <button className={`nj-tab-bottom-item nj-tab-bottom-item-favorites ${tab === 'favorites' ? 'active nj-tab-bottom-item-active' : ''}`} onClick={() => selectTab('favorites')}><span className="nj-tab-bottom-icon"><Star weight={tab === 'favorites' ? 'fill' : 'regular'} /></span><span className="nj-tab-bottom-label nj-tab-bottom-text">收藏</span></button>
                    <button className={`nj-tab-bottom-item nj-tab-bottom-item-profile ${tab === 'profile' ? 'active nj-tab-bottom-item-active' : ''}`} onClick={() => selectTab('profile')}><span className="nj-tab-bottom-icon"><UserCircle weight={tab === 'profile' ? 'fill' : 'regular'} /></span><span className="nj-tab-bottom-label nj-tab-bottom-text">我的</span></button>
                </nav>
            </main>
            {contextMenu && <div className="nj-chat-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={event => event.stopPropagation()}>
                <button onClick={() => void togglePinned(contextMenu.charId)}>{prefs.pinnedCharacterIds.includes(contextMenu.charId) ? '取消置顶' : '置顶好友'}</button>
                <button onClick={() => { clearUnread(contextMenu.charId); setContextMenu(null); }}>标为已读</button>
            </div>}
            {themeOpen && <MessagingThemeSettings
                state={themeState}
                onPreview={setPreviewCss}
                onPersist={async next => { await saveMessagingThemeState(next); setThemeState(next); setPreviewCss(next.css); }}
                onClose={() => { setThemeOpen(false); setPreviewCss(themeState.css); }}
                notify={addToast}
            />}
        </div>
    );
};

export default Messaging;
