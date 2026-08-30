import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    BellSlash,
    CalendarBlank,
    Camera,
    CaretDown,
    CaretLeft,
    ChatCircleDots,
    Check,
    MapPin,
    MagnifyingGlass,
    NotePencil,
    PencilSimple,
    Planet,
    PushPin,
    Rows,
    ArrowsClockwise,
    Sparkle,
    Star,
    Trash,
    UserCircle,
    X,
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
    loadMessagingProfile,
    loadMessagingThemeState,
    messagingLengthBucket,
    messagingTimeSlot,
    messagingUnreadBucket,
    MessagingListPrefs,
    MessagingProfile,
    MessagingThemeState,
    saveMessagingListPrefs,
    saveMessagingProfile,
    saveMessagingThemeState,
    scopeMessagingCss,
} from '../utils/messagingTheme';
import MessagingThemeSettings from '../components/messaging/MessagingThemeSettings';
import Chat from './Chat';
import { ContextBuilder } from '../utils/context';
import { processImage } from '../utils/file';
import { buildSelfiePrompt, generateImageDataUrl, getImageGenConfig, isImageGenReady } from '../utils/novelaiImage';
import { safeResponseJson } from '../utils/safeApi';
import { isMomentsPost, withSocialPostScope } from '../utils/socialPostScope';
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

interface MomentRerollState {
    postId: string;
    sourceImageIndex: number;
}

type MomentGenerateMode = 'random' | 'select';

const isImageSource = (value: string): boolean => /^(?:data:image\/|https?:\/\/|blob:|blobref:)/i.test(String(value || '').trim());

const parseJsonArray = (value: string): any[] => {
    const clean = String(value || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.posts)) return parsed.posts;
    } catch { /* try the outermost array below */ }
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { return JSON.parse(match[0]); } catch { return []; }
};

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
        apiConfig,
        characterGroups,
        characters,
        clearUnread,
        closeApp,
        lastMsgTimestamp,
        openApp,
        proactiveComposingChars,
        setActiveCharacterId,
        unreadMessages,
        updateUserProfile,
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
    const [profile, setProfile] = useState<MessagingProfile>(() => ({
        version: 2, name: userProfile.name || '我', avatar: userProfile.avatar || '', cover: '', handle: '',
        signature: '', birthday: '', gender: '', location: '', hobbies: [], about: userProfile.bio || '',
    }));
    const [profileDraft, setProfileDraft] = useState<MessagingProfile>(profile);
    const [profileEditOpen, setProfileEditOpen] = useState(false);
    const [momentGenerateOpen, setMomentGenerateOpen] = useState(false);
    const [momentPostOpen, setMomentPostOpen] = useState(false);
    const [momentGenerateMode, setMomentGenerateMode] = useState<MomentGenerateMode>('random');
    const [momentSelectedIds, setMomentSelectedIds] = useState<string[]>([]);
    const [momentGenerateCount, setMomentGenerateCount] = useState(3);
    const [momentGenerating, setMomentGenerating] = useState(false);
    const [momentProgress, setMomentProgress] = useState('');
    const [newMomentText, setNewMomentText] = useState('');
    const [newMomentLocation, setNewMomentLocation] = useState('');
    const [newMomentImagePrompt, setNewMomentImagePrompt] = useState('');
    const [newMomentImages, setNewMomentImages] = useState<string[]>([]);
    const [newMomentImageBusy, setNewMomentImageBusy] = useState(false);
    const [momentReroll, setMomentReroll] = useState<MomentRerollState | null>(null);
    const [momentRerollPrompt, setMomentRerollPrompt] = useState('');
    const [momentRerollBusy, setMomentRerollBusy] = useState(false);
    const [profileAboutExpanded, setProfileAboutExpanded] = useState(false);
    const [tabAnim, setTabAnim] = useState<'idle' | 'enter'>('idle');
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const themeLongPressTimer = useRef<number | null>(null);
    const themeLongPressed = useRef(false);
    const itemLongPressTimer = useRef<number | null>(null);
    const itemLongPressed = useRef(false);
    const appRef = useRef<HTMLDivElement>(null);
    const momentImageInputRef = useRef<HTMLInputElement>(null);
    const profileAvatarInputRef = useRef<HTMLInputElement>(null);
    const profileCoverInputRef = useRef<HTMLInputElement>(null);
    const tabAnimTimer = useRef<number | null>(null);

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
        loadMessagingProfile(userProfile).then(next => {
            if (!alive) return;
            setProfile(next);
            setProfileDraft(next);
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
            const friendIds = new Set(characters.map(char => String(char.id)));
            setPosts(nextPosts.filter(post => isMomentsPost(post, friendIds)).sort((a, b) => b.timestamp - a.timestamp));
            setGalleryUrls(images.sort((a, b) => b.timestamp - a.timestamp).slice(0, 12).map(item => item.url));
            setTextFavorites(nextText);
            setVoiceFavorites(nextVoice);
        });
        return () => { alive = false; };
    }, [characters, tab, lastMsgTimestamp]);

    useEffect(() => () => {
        if (tabAnimTimer.current) window.clearTimeout(tabAnimTimer.current);
    }, []);

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
        // 没有任何自建分组时，糯叽机是直接平铺，不会单独给「未分组」再出一个标题。
        // 多出来的标题节点会打断主题的 `.nj-chat-item-pinned + .nj-chat-item`
        // 和 `:nth-child(n)`，导致 contact / message 标签、分割线、书签装饰全部失效。
        if (named.length === 1 && named[0].id === FALLBACK_GROUP_ID) return [{ id: 'all', name: '', items: orderedSummaries }];
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
        setTabAnim('enter');
        if (tabAnimTimer.current) window.clearTimeout(tabAnimTimer.current);
        tabAnimTimer.current = window.setTimeout(() => setTabAnim('idle'), 360);
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
        const appRect = appRef.current?.getBoundingClientRect();
        const originX = appRect?.left ?? 0;
        const originY = appRect?.top ?? 0;
        const appWidth = appRect?.width ?? window.innerWidth;
        const appHeight = appRect?.height ?? window.innerHeight;
        const x = Math.min(event.clientX - originX, appWidth - 184);
        const y = Math.min(event.clientY - originY, appHeight - 150);
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

    const prependMomentPosts = async (newPosts: SocialPost[]) => {
        const scopedPosts = newPosts.map(post => withSocialPostScope(post, 'moments'));
        await Promise.all(scopedPosts.map(post => DB.saveSocialPost(post)));
        setPosts(current => [...scopedPosts, ...current.filter(item => !scopedPosts.some(post => post.id === item.id))]
            .sort((a, b) => b.timestamp - a.timestamp));
    };

    const callMomentWriter = async (selected: CharacterProfile[], count: number): Promise<any[]> => {
        const roster = selected.map(char => `ID: ${char.id}\n姓名: ${char.name}\n${ContextBuilder.buildCoreContext(char, userProfile, false)}`).join('\n\n---\n\n');
        const prompt = `你正在为一个拟真的朋友圈生成角色动态。只能使用下面角色，不得代替用户发言。\n\n${roster}\n\n请生成 ${count} 条动态，返回严格 JSON 数组。每项必须包含 charId、text、imagePrompt、location。text 是角色自愿公开发布的自然朋友圈文案；imagePrompt 是与正文一致、适合生图 API 的英文画面提示词，如果这条动态不适合配图则填空字符串；location 可为空。不要 Markdown，不要解释。`;
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.92,
                max_tokens: 5000,
            }),
            __sullyMeta: { appId: 'messaging', appName: '消息', purpose: '生成角色朋友圈' },
        } as RequestInit);
        if (!response.ok) throw new Error(`文字 API HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 180)}`);
        const data = await safeResponseJson(response);
        return parseJsonArray(data?.choices?.[0]?.message?.content || '');
    };

    const generateCharacterMoments = async () => {
        if (momentGenerating) return;
        if (!apiConfig.apiKey || !apiConfig.baseUrl || !apiConfig.model) return addToast('请先配置文字 API', 'error');
        const candidates = momentGenerateMode === 'select'
            ? characters.filter(char => momentSelectedIds.includes(char.id))
            : [...characters].sort(() => Math.random() - .5);
        if (!candidates.length) return addToast(momentGenerateMode === 'select' ? '请至少选择一个角色' : '还没有可生成动态的角色', 'error');
        setMomentGenerating(true);
        setMomentProgress('角色正在想发什么…');
        try {
            const requestedCount = Math.max(1, Math.min(6, momentGenerateCount));
            const raw = await callMomentWriter(candidates, requestedCount);
            if (!raw.length) throw new Error('文字 API 没有返回有效的动态数组');
            const imageConfig = getImageGenConfig();
            const canDraw = isImageGenReady(imageConfig);
            let imageFailures = 0;
            const nextPosts: SocialPost[] = [];
            for (let index = 0; index < raw.length && nextPosts.length < requestedCount; index += 1) {
                const item = raw[index];
                const char = candidates.find(candidate => String(candidate.id) === String(item?.charId)) || candidates[index % candidates.length];
                const content = String(item?.text || item?.content || '').trim();
                if (!char || !content) continue;
                const imagePrompt = String(item?.imagePrompt || item?.scene || '').trim();
                const images: string[] = [];
                let imageGenerationError = '';
                if (imagePrompt && canDraw) {
                    setMomentProgress(`正在为 ${char.name} 生成图片（${nextPosts.length + 1}/${requestedCount}）…`);
                    try {
                        images.push(await generateImageDataUrl(buildSelfiePrompt(char.id, imagePrompt, imageConfig), imageConfig));
                    } catch (error: any) {
                        imageFailures += 1;
                        imageGenerationError = error?.message || String(error);
                    }
                }
                nextPosts.push({
                    id: `moment-char-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    authorName: char.name,
                    authorAvatar: char.avatar,
                    title: '',
                    content,
                    images,
                    likes: 0,
                    isCollected: false,
                    isLiked: false,
                    comments: [],
                    timestamp: Date.now() - nextPosts.length * 1000,
                    tags: [],
                    authorType: 'character',
                    authorCharId: char.id,
                    socialScope: 'moments',
                    imagePrompt,
                    location: String(item?.location || '').trim(),
                    ...(imageGenerationError ? { imageGenerationError } : {}),
                });
            }
            if (!nextPosts.length) throw new Error('没有得到可保存的角色动态');
            await prependMomentPosts(nextPosts);
            setMomentProgress(`完成，已生成 ${nextPosts.length} 条动态`);
            addToast(imageFailures ? `动态已生成；${imageFailures} 张图失败，可检查生图 API 后重试` : `已生成 ${nextPosts.length} 条角色动态`, imageFailures ? 'info' : 'success');
            window.setTimeout(() => { setMomentGenerateOpen(false); setMomentProgress(''); }, 700);
        } catch (error: any) {
            setMomentProgress('');
            addToast(`生成失败：${error?.message || error}`, 'error');
        } finally {
            setMomentGenerating(false);
        }
    };

    const handleMomentImages = async (files: FileList | null) => {
        if (!files?.length) return;
        try {
            const remaining = Math.max(0, 9 - newMomentImages.length);
            const converted = await Promise.all(Array.from(files).slice(0, remaining).map(file => processImage(file, { maxWidth: 1600, quality: .9 })));
            setNewMomentImages(current => [...current, ...converted].slice(0, 9));
        } catch (error: any) {
            addToast(error?.message || '图片处理失败', 'error');
        }
    };

    const drawNewMomentImage = async () => {
        const prompt = newMomentImagePrompt.trim();
        if (!prompt) return addToast('先写一段配图描述', 'error');
        const config = getImageGenConfig();
        if (!isImageGenReady(config)) return addToast('生图 API 还没配置完整', 'error');
        setNewMomentImageBusy(true);
        try {
            const image = await generateImageDataUrl(prompt, config);
            setNewMomentImages(current => [...current, image].slice(0, 9));
            addToast('配图已生成', 'success');
        } catch (error: any) {
            addToast(error?.message || '生图失败', 'error');
        } finally {
            setNewMomentImageBusy(false);
        }
    };

    const publishUserMoment = async () => {
        const content = newMomentText.trim();
        if (!content) return addToast('先写点内容', 'error');
        const post: SocialPost = {
            id: `moment-user-${Date.now()}`,
            authorName: profile.name || userProfile.name || '我',
            authorAvatar: profile.avatar || userProfile.avatar,
            title: '', content, images: newMomentImages,
            likes: 0, isCollected: false, isLiked: false, comments: [], timestamp: Date.now(), tags: [],
            authorType: 'user', imagePrompt: newMomentImagePrompt.trim(), location: newMomentLocation.trim(),
            socialScope: 'moments',
        };
        await prependMomentPosts([post]);
        setNewMomentText(''); setNewMomentLocation(''); setNewMomentImagePrompt(''); setNewMomentImages([]);
        setMomentPostOpen(false);
        addToast('朋友圈已发布', 'success');
    };

    const clearMomentFeed = async () => {
        if (!window.confirm('确定清空全部朋友圈动态吗？')) return;
        await Promise.all(posts.map(post => DB.deleteSocialPost(post.id)));
        setPosts([]);
        addToast('朋友圈已清空；Spark 推荐流未受影响', 'success');
    };

    const openMomentReroll = (post: SocialPost, sourceImageIndex = -1) => {
        setMomentReroll({ postId: post.id, sourceImageIndex });
        setMomentRerollPrompt(post.imagePrompt || post.content || post.title || '');
    };

    const rerollMomentImage = async () => {
        if (!momentReroll || momentRerollBusy) return;
        const prompt = momentRerollPrompt.trim();
        if (!prompt) return addToast('请先填写生图描述', 'error');
        const config = getImageGenConfig();
        if (!isImageGenReady(config)) return addToast('生图 API 还没配置完整', 'error');
        const post = posts.find(item => item.id === momentReroll.postId);
        if (!post) return setMomentReroll(null);
        setMomentRerollBusy(true);
        try {
            const resolvedPrompt = post.authorType === 'character' && post.authorCharId
                ? buildSelfiePrompt(post.authorCharId, prompt, config)
                : prompt;
            const image = await generateImageDataUrl(resolvedPrompt, config);
            const images = [...(post.images || [])];
            if (momentReroll.sourceImageIndex >= 0 && momentReroll.sourceImageIndex < images.length) {
                images[momentReroll.sourceImageIndex] = image;
            } else {
                images.push(image);
            }
            const updated: SocialPost = {
                ...post,
                images,
                imagePrompt: prompt,
                imageGenerationError: undefined,
                socialScope: 'moments',
            };
            await DB.saveSocialPost(updated);
            setPosts(current => current.map(item => item.id === updated.id ? updated : item));
            setMomentReroll(null);
            addToast('朋友圈图片已重新生成', 'success');
        } catch (error: any) {
            const updated: SocialPost = { ...post, imagePrompt: prompt, imageGenerationError: error?.message || String(error), socialScope: 'moments' };
            await DB.saveSocialPost(updated).catch(() => undefined);
            setPosts(current => current.map(item => item.id === updated.id ? updated : item));
            addToast(`重新生成失败：${updated.imageGenerationError}`, 'error');
        } finally {
            setMomentRerollBusy(false);
        }
    };

    const openProfileEditor = () => {
        setProfileDraft(profile);
        setProfileEditOpen(true);
    };

    const handleProfileImage = async (files: FileList | null, field: 'avatar' | 'cover') => {
        const file = files?.[0];
        if (!file) return;
        try {
            const image = await processImage(file, field === 'cover' ? { maxWidth: 1800, quality: .9 } : { maxWidth: 800, quality: .9 });
            setProfileDraft(current => ({ ...current, [field]: image }));
        } catch (error: any) {
            addToast(error?.message || '图片处理失败', 'error');
        }
    };

    const persistProfile = async () => {
        const next: MessagingProfile = {
            ...profileDraft,
            version: 2,
            name: profileDraft.name.trim() || '我',
            handle: profileDraft.handle.trim().replace(/^@/, ''),
            hobbies: profileDraft.hobbies.map(item => item.trim()).filter(Boolean).slice(0, 24),
        };
        await saveMessagingProfile(next);
        updateUserProfile({ name: next.name, avatar: next.avatar || userProfile.avatar, bio: next.about });
        const sparkRaw = await DB.getAsset('spark_social_profile').catch(() => null);
        let spark: Record<string, any> = {};
        if (typeof sparkRaw === 'string') try { spark = JSON.parse(sparkRaw); } catch { /* replace malformed legacy value */ }
        await DB.saveAsset('spark_social_profile', JSON.stringify({ ...spark, name: next.name, avatar: next.avatar || userProfile.avatar, bio: next.signature || next.about }));
        setProfile(next);
        setProfileEditOpen(false);
        addToast('个人资料已保存', 'success');
    };

    if (view === 'detail') return <Chat onBack={() => setView('list')} />;

    const attrs = contextAttrs(tab, unreadTotal, !!search.trim());

    const chatHeader = () => (
        <div className="ig-header glass-header nj-chat-tab-header">
            <div className="nj-chat-tab-header-back" role="button" tabIndex={0} aria-label="返回桌面" onClick={closeApp} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') closeApp(); }}><CaretLeft weight="bold" /></div>
            <div className="nj-chat-tab-header-title-wrap"><button className="ios-fix nj-chat-tab-header-title-btn" type="button">{/* 糯叽机有账号时显示 @id + 小箭头，没有才显示「消息」。 主题（仿 ins）把标题绝对定位到 left:33px，是按 @id 这种窄内容排的； 一直显示两个汉字就会压到返回箭头上。 */}{profile.handle ? <><span className="header-id-text">@{profile.handle}</span><CaretDown /></> : <span>消息</span>}</button></div>
            <div className="nj-chat-tab-header-edit" role="button" tabIndex={0} aria-label="编辑角色" onClick={() => openApp(AppID.Character)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openApp(AppID.Character); }}><NotePencil /></div>
        </div>
    );

    const renderChatTab = () => (
        <section id="messaging-chat-tab" className="chat-view nj-chat-tab" data-empty={String(orderedSummaries.length === 0)} data-unread-total={String(unreadTotal)} data-searching={String(!!search.trim())}>
            {chatHeader()}
            <div className="nj-chat-tab-search-wrap">
                <label className="glass-search nj-chat-tab-search">
                    <MagnifyingGlass size={16} />
                    <input className="nj-chat-tab-search-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索" aria-label="搜索好友和消息" />
                </label>
            </div>
            <div className="nj-chat-tab-decor-top" aria-hidden="true" />
            {!!characters.length && !search && (
                <div className="details-scroll nj-chat-tab-note-row nj-chat-tab-notes">
                    {/* 标签名必须和糯叽机一致：原生这一整块内部全是 <div>。
                        主题会写 `.nj-chat-tab-note-item span { display:none }`
                        这类按标签的选择器，用 <span> 会被整块隐藏。 */}
                    <div className="nj-chat-tab-note-item nj-chat-tab-note-mine" role="button" tabIndex={0} onClick={openProfileEditor} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openProfileEditor(); }}>
                        <div className="glass-bubble nj-chat-tab-note-bubble">
                            <div className="nj-chat-tab-note-bubble-text">{profile.signature || 'Mind?'}</div>
                            <div className="nj-chat-tab-note-bubble-tail1" aria-hidden="true" />
                            <div className="nj-chat-tab-note-bubble-tail2" aria-hidden="true" />
                        </div>
                        {/* 「我」这格原生是 <img> 直接子元素，没有内包裹层；
                            主题的 `.nj-chat-tab-note-avatar > *:not(img)` 靠这一点保住图片。 */}
                        <div className="nj-chat-tab-note-avatar">
                            <img src={profile.avatar || userProfile.avatar} alt="" />
                            {!profile.signature && <div className="nj-chat-tab-note-plus" aria-hidden="true">+</div>}
                        </div>
                        <div className="nj-chat-tab-note-name">You</div>
                    </div>
                    {orderedSummaries.slice(0, 6).map(({ char, last }) => (
                        <div key={char.id} className="nj-chat-tab-note-item nj-chat-tab-note-friend" role="button" tabIndex={0} onClick={() => openChat(char.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openChat(char.id); }}>
                            <div className="glass-bubble nj-chat-tab-note-bubble">
                                <div className="nj-chat-tab-note-bubble-text">{cleanPreview(last, !!proactiveComposingChars[char.id]).slice(0, 14)}</div>
                                <div className="nj-chat-tab-note-bubble-tail1" aria-hidden="true" />
                                <div className="nj-chat-tab-note-bubble-tail2" aria-hidden="true" />
                            </div>
                            <div className="nj-chat-tab-note-avatar"><div className="nj-chat-tab-note-avatar-img"><img src={char.avatar} alt="" /></div></div>
                            <div className="nj-chat-tab-note-name">{char.name}</div>
                        </div>
                    ))}
                </div>
            )}
            <div className="nj-chat-tab-section-title" data-grouping={prefs.groupingEnabled ? 'on' : 'off'}>
                <span>消息</span>
                {!prefs.groupButtonHidden && <span className="nj-chat-tab-group-toggle-wrap"><button className={`nj-chat-tab-group-toggle ${groupMenuOpen ? 'active' : ''}`} data-on={String(prefs.groupingEnabled)} aria-label="好友分组设置" onClick={() => setGroupMenuOpen(value => !value)}><Rows className="nj-chat-tab-group-toggle-icon" /></button></span>}
                {groupMenuOpen && <>
                    <button className="nj-group-menu-mask" aria-label="关闭分组菜单" onClick={() => setGroupMenuOpen(false)} />
                    <span className="nj-group-menu nj-chat-group-toggle-menu">
                        <button className="nj-group-menu-item nj-chat-group-toggle-menu-item" data-action="manage" onClick={() => { void persistPrefs({ ...prefs, groupingEnabled: !prefs.groupingEnabled }); setGroupMenuOpen(false); }}><Check opacity={prefs.groupingEnabled ? 1 : 0} />按角色分组显示</button>
                        <button className="nj-group-menu-item nj-chat-group-toggle-menu-item" data-action="expand" onClick={() => { void persistPrefs({ ...prefs, collapsedGroupIds: [] }); setGroupMenuOpen(false); }}><Rows />展开全部分组</button>
                        <button className="nj-group-menu-item nj-chat-group-toggle-menu-item" data-action="collapse" onClick={() => { void persistPrefs({ ...prefs, collapsedGroupIds: groupedSummaries.map(group => group.id) }); setGroupMenuOpen(false); }}><CaretDown />收起全部分组</button>
                    </span>
                </>}
            </div>
            <div className="nj-chat-tab-decor-mid" aria-hidden="true" />
            <div className="message-list nj-chat-tab-list">
                {groupedSummaries.map((group, groupIndex) => {
                    const collapsed = prefs.collapsedGroupIds.includes(group.id);
                    return (
                        <React.Fragment key={group.id}>
                            {/* 无名分组（平铺）时必须连节点一起不渲染：
                                只清空文字的话，按钮仍在 DOM 里，依旧能点击折叠，
                                也依旧会打断主题的 `+` 兄弟选择器和 :nth-child() 计数。 */}
                            {prefs.groupingEnabled && !!group.name && <button className={`nj-chat-group-header ${collapsed ? 'is-collapsed' : ''}`} data-group-key={group.name} data-collapsed={String(collapsed)} data-count={String(group.items.length)} data-first={String(groupIndex === 0)} style={{ '--nj-group-index': String(groupIndex) } as CSSProperties} onClick={() => void persistPrefs({ ...prefs, collapsedGroupIds: collapsed ? prefs.collapsedGroupIds.filter(id => id !== group.id) : [...prefs.collapsedGroupIds, group.id] })}><span className="nj-chat-group-caret" aria-hidden="true">▾</span><span className="nj-chat-group-label">{group.name}</span><span className="nj-chat-group-unread">{group.items.reduce((sum, item) => sum + (unreadMessages[item.char.id] || 0), 0) || ''}</span><span className="nj-chat-group-count">{group.items.length}</span></button>}
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
                                        className={`nj-chat-item nj-chat-item-char ${pinned ? 'nj-chat-item-pinned' : ''} ${unread ? 'nj-chat-item-unread' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        style={style}
                                        data-kind="char"
                                        data-index={String(index)}
                                        data-unread={messagingUnreadBucket(unread)}
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
                                        <div className="nj-chat-item-avatar nj-chat-item-avatar-char">
                                            {/* 糯叽机 4.71 把圆角和 overflow 放在这层内包裹上，外层只负责定位与角标。
                                                主题会对外层写 overflow: visible（置顶缺口），少了这层头像会变成方图。 */}
                                            <div className="nj-chat-item-avatar-img"><img src={char.avatar} alt="" /></div>
                                            {unread > 0 && <span className="nj-chat-item-unread-badge">{unread > 99 ? '99+' : unread}</span>}
                                        </div>
                                        <div className="nj-chat-item-body">
                                            <div className="nj-chat-item-row1">
                                                <div className="nj-chat-item-name">{char.name}</div>
                                                <div className="nj-chat-item-time">{formatListTime(last?.timestamp)}{pinned && <span className="nj-chat-item-pin-mark"><PushPin size={10} weight="fill" /></span>}</div>
                                            </div>
                                            <div className="nj-chat-item-preview">{preview}<BellSlash className="sully-messaging-hidden" /></div>
                                        </div>
                                        <div className="nj-item-deco nj-item-deco-1 heavy-anim" aria-hidden="true" />
                                        <div className="nj-item-deco nj-item-deco-2 heavy-anim" aria-hidden="true" />
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    );
                })}
                {!orderedSummaries.length && <div className="nj-empty-state"><div className="nj-empty-state-symbol">☁︎</div>{search ? '没有找到匹配的好友或消息' : '还没有好友，先去神经链接创建角色吧'}</div>}
            </div>
            <div className="nj-chat-tab-decor-bottom" aria-hidden="true" />
        </section>
    );

    const renderMomentsTab = () => (
        <section id="messaging-moments-tab" className="moments-view nj-moments-tab" data-post-count={String(posts.length)} data-empty={String(posts.length === 0)}>
            <div className="nj-moments-header"><div className="nj-moments-header-btns">
                <div className="nj-moments-header-btn nj-moments-header-btn-clear" role="button" tabIndex={0} aria-label="清空动态" onClick={() => void clearMomentFeed()}><Trash /></div>
                <div className="nj-moments-header-btn nj-moments-header-btn-gen" role="button" tabIndex={0} aria-label="生成角色动态" onClick={() => setMomentGenerateOpen(true)}><Sparkle /></div>
                <div className="nj-moments-header-btn nj-moments-header-btn-post" role="button" tabIndex={0} aria-label="发布朋友圈" onClick={() => setMomentPostOpen(true)}><Camera /></div>
            </div></div>
            <div className="nj-moments-header-sticky" data-scrolled="false"><div className="nj-moments-header-title">朋友圈</div></div>
            <div className="nj-moments-decor-top" aria-hidden="true" />
            <div className="nj-moments-cover-wrap"><div className="nj-moments-cover" style={profile.cover ? { backgroundImage: `url(${JSON.stringify(profile.cover)})` } : undefined}><div className="nj-moments-cover-gradient" /></div><div className="nj-moments-cover-userinfo"><div className="nj-moments-cover-username">{profile.name || '我'}</div><div className="nj-moments-cover-avatar"><img src={profile.avatar || userProfile.avatar} alt="" /></div></div></div>
            <div className="nj-moments-notif-entry" aria-hidden="true" />
            <div className="nj-moments-decor-mid" aria-hidden="true" />
            <div className="nj-moments-feed">
                {posts.slice(0, 30).map((post, index) => {
                    const images = (post.images || []).map((url, sourceImageIndex) => ({ url, sourceImageIndex })).filter(item => isImageSource(item.url)).slice(0, 9);
                    const stickers = (post.images || []).filter(value => !isImageSource(value) && !value.startsWith('txt:'));
                    const hour = new Date(post.timestamp).getHours();
                    const style = { '--nj-item-index': String(index), '--nj-post-img-count': String(images.length), '--nj-post-like-count': String(post.likes || 0), '--nj-post-comment-count': String(post.comments?.length || 0), '--nj-item-avatar-url': `url(${JSON.stringify(post.authorAvatar)})` } as CSSProperties;
                    return <article className={`nj-moments-post ${post.authorType === 'character' ? 'nj-moments-post-char' : 'nj-moments-post-user'}`} key={post.id} style={style} data-post-kind={post.authorType === 'character' ? 'char' : 'user'} data-index={String(index)} data-img-count={String(images.length)} data-has-img={String(images.length > 0)} data-liked={String(post.isLiked)} data-like-count={String(post.likes || 0)} data-comment-count={String(post.comments?.length || 0)} data-has-comment={String(!!post.comments?.length)} data-length={messagingLengthBucket(post.content || post.title || '')} data-time-slot={messagingTimeSlot(hour)} data-hour={String(hour)} data-has-location={post.location ? 'true' : undefined}>
                        <div className="nj-moments-post-avatar"><img src={post.authorAvatar} alt="" /></div>
                        <div className="nj-moments-post-body">
                            <div className="nj-moments-post-name">{post.authorName}</div>
                            <div className="nj-moments-post-text">{post.content || post.title}</div>
                            {!!stickers.length && <div className="nj-moments-post-sticker" aria-label="心情贴纸">{stickers[0]}</div>}
                            {!!images.length && <div className={`nj-moments-post-imgs nj-moments-post-imgs-${images.length}`}>{images.map(({ url, sourceImageIndex }, imageIndex) => <div className="nj-moments-post-img-cell" key={`${post.id}-${imageIndex}`}><img src={url} alt="" /><button type="button" className="sully-msg-moment-reroll" aria-label="重新生成这张图片" onClick={event => { event.stopPropagation(); openMomentReroll(post, sourceImageIndex); }}><ArrowsClockwise /></button></div>)}</div>}
                            {!images.length && (!!post.imagePrompt || !!post.imageGenerationError) && <button type="button" className="sully-msg-moment-retry" onClick={() => openMomentReroll(post)}><ArrowsClockwise />{post.imageGenerationError ? '图片生成失败，重新生成' : '生成朋友圈图片'}</button>}
                            <div className="nj-moments-post-meta"><span className="nj-moments-post-time">{formatListTime(post.timestamp)}</span>{post.location && <span className="nj-moments-post-location">{post.location}</span>}<div className="nj-moments-post-actions-wrap"><button className="nj-moments-post-actions-trigger" aria-label="动态操作" onClick={() => openMomentReroll(post, images[0]?.sourceImageIndex ?? -1)}>••</button></div></div>
                            {(post.likes > 0 || !!post.comments?.length) && <div className="nj-moments-engagement">{post.likes > 0 && <div className="nj-moments-likes"><span>♡</span><span className="nj-moments-like-name">{post.likes}</span></div>}{post.comments?.map(comment => <div className="nj-moments-comment" key={comment.id}><span className="nj-moments-comment-author">{comment.authorName}：</span><span className="nj-moments-comment-content">{comment.content}</span></div>)}</div>}
                        </div>
                        <div className="nj-item-deco nj-item-deco-1 heavy-anim" aria-hidden="true" /><div className="nj-item-deco nj-item-deco-2 heavy-anim" aria-hidden="true" />
                    </article>;
                })}
                {!posts.length && <div className="nj-empty-state"><div className="nj-empty-state-symbol">◌</div>暂时还没有动态</div>}
            </div>
            <div className="nj-moments-decor-bottom" aria-hidden="true" />
        </section>
    );

    const renderFavoritesTab = () => (
        <section id="messaging-favorites-tab" className="journal-background nj-favorites-tab" data-empty={String(!(textFavorites.length || voiceFavorites.length))}>
            <div className="ig-header glass-header nj-favorites-tab-header">
                <div className="nj-favorites-tab-title">收藏</div>
                <div className="nj-fav-decor-top" aria-hidden="true" />
                <div className="nj-favorites-tabs details-scroll">
                    <button className={`nj-favorites-tab-button ${favoriteKind === 'text' ? 'active' : ''}`} onClick={() => setFavoriteKind('text')}>文字 {textFavorites.length}</button>
                    <button className={`nj-favorites-tab-button ${favoriteKind === 'voice' ? 'active' : ''}`} onClick={() => setFavoriteKind('voice')}>语音 {voiceFavorites.length}</button>
                </div>
            </div>
            <div className="nj-favorites-list nj-fav-list">
                {favoriteKind === 'text' ? textFavorites.map(item => <article className="nj-favorites-item nj-fav-card" key={item.id} data-kind="text" onClick={() => openChat(item.charId)}><div className="nj-favorites-item-author">{item.charName} · {formatListTime(item.sourceTimestamp)}</div><div className="nj-favorites-item-content">{item.content}</div></article>) : voiceFavorites.map(item => <article className="nj-favorites-item nj-fav-card" key={item.id} data-kind="voice"><div className="nj-favorites-item-author">{item.charName} · {formatListTime(item.sourceTimestamp)}</div><div className="nj-favorites-item-voice"><button className="nj-favorites-item-play" onClick={() => void playVoiceFavorite(item)}>▶</button><div className="nj-favorites-item-content">{item.spokenText || item.originalText || '语音收藏'}</div></div></article>)}
                {favoriteKind === 'text' && !textFavorites.length && <div className="nj-empty-state">聊天里收藏的文字会出现在这里</div>}
                {favoriteKind === 'voice' && !voiceFavorites.length && <div className="nj-empty-state">收藏的语音会出现在这里</div>}
            </div>
            <div className="nj-fav-decor-bottom" />
        </section>
    );

    const renderProfileTab = () => {
        const about = profile.about || '还没有填写个人介绍。';
        const aboutIsLong = about.length > 150;
        const infoItems: Array<{ key: string; className: string; icon: React.ReactNode; label: string; value: string }> = [];
        if (profile.birthday) infoItems.push({ key: 'birthday', className: 'nj-profile-info-born', icon: <CalendarBlank />, label: '生日', value: profile.birthday });
        if (profile.gender) infoItems.push({ key: 'gender', className: 'nj-profile-info-gender', icon: <span>○</span>, label: '性别', value: profile.gender });
        if (profile.location) infoItems.push({ key: 'location', className: 'nj-profile-info-location', icon: <MapPin />, label: '所在地', value: profile.location });
        return (
            <section id="messaging-profile-tab" className="profile-view nj-profile-tab">
                <div className="glass-header nj-profile-tab-header">
                    <div />
                    <div><button className="ios-fix nj-profile-tab-title" type="button">我的</button></div>
                    <div><div className="nj-profile-edit-btn" role="button" tabIndex={0} aria-label="编辑资料" onClick={openProfileEditor} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openProfileEditor(); }}><PencilSimple /></div></div>
                </div>
                <div className="nj-profile-decor-top" aria-hidden="true" />
                <div className="nj-profile-content"><div className="nj-profile-view">
                    <div className="nj-profile-top">
                        <div className="nj-profile-top-row"><div className="nj-profile-avatar-wrap"><div className="nj-profile-avatar"><img src={profile.avatar || userProfile.avatar} alt="" /></div></div><div className="nj-profile-stats"><div className="nj-profile-stat-item"><span className="nj-profile-stat-count">{posts.filter(post => post.authorType === 'user').length}</span><span className="nj-profile-stat-label">动态</span></div><div className="nj-profile-stat-item"><span className="nj-profile-stat-count">{characters.length}</span><span className="nj-profile-stat-label">好友</span></div><div className="nj-profile-stat-item"><span className="nj-profile-stat-count">{textFavorites.length + voiceFavorites.length}</span><span className="nj-profile-stat-label">收藏</span></div></div></div>
                        <div className="nj-profile-identity"><div className="nj-profile-name-row"><p className="nj-profile-name">{profile.name || '我'}</p>{profile.handle && <p className="nj-profile-handle">@{profile.handle}</p>}</div><p className="nj-profile-signature">{profile.signature || '在 Sully 的小世界里，认真生活。'}</p>{!!profile.hobbies.length && <div className="nj-profile-hobbies">{profile.hobbies.map(hobby => <span className="nj-profile-hobby-chip" key={hobby}>{hobby}</span>)}</div>}</div>
                    </div>
                    {!!infoItems.length && <div className="nj-profile-info-bar">{infoItems.map((item, index) => <React.Fragment key={item.key}>{index > 0 && <div className="nj-profile-info-divider" />}<div className={`nj-profile-info-item ${item.className}`}><div className="nj-profile-info-icon">{item.icon}</div><div className="nj-profile-info-text"><p className="nj-profile-info-label">{item.label}</p><p className="nj-profile-info-value">{item.value}</p></div></div></React.Fragment>)}</div>}
                    <div className="nj-profile-decor-mid" aria-hidden="true" />
                    <div className="nj-profile-about">
                        <h4 className="nj-profile-section-title nj-profile-about-title">关于我 <span /></h4>
                        <div className="nj-profile-about-body"><p className="nj-profile-about-text" style={profileAboutExpanded || !aboutIsLong ? undefined : { maxHeight: '151.2px', overflow: 'hidden' }}>{about}</p>{aboutIsLong && !profileAboutExpanded && <div className="nj-profile-about-fade" />}</div>
                        {aboutIsLong && <button className="nj-profile-about-toggle" type="button" onClick={() => setProfileAboutExpanded(value => !value)}>{profileAboutExpanded ? '收起' : '展开更多'}<CaretDown style={{ transform: profileAboutExpanded ? 'rotate(180deg)' : 'none' }} /></button>}
                    </div>
                    <div className="nj-profile-gallery"><div className="nj-profile-gallery-head"><h4 className="nj-profile-section-title nj-profile-gallery-title">相册 <span className="nj-profile-gallery-count">{galleryUrls.length}</span></h4></div>{galleryUrls.length ? <div className="nj-profile-gallery-grid">{galleryUrls.map((url, index) => <div className="nj-profile-gallery-cell" key={`${url}-${index}`}><img src={url} alt="" /></div>)}</div> : <div className="nj-empty-state">相册里还没有照片</div>}</div>
                </div></div>
                <div className="nj-profile-decor-bottom" aria-hidden="true" />
            </section>
        );
    };

    return (
        <div ref={appRef} className="sully-messaging-app" onClick={() => contextMenu && setContextMenu(null)}>
            {!!scopedCss && <style data-sully-messaging-theme>{scopedCss}</style>}
            <div id="chat-list-screen" className="screen active sully-messaging-screen" {...attrs} data-prev-tab={previousTab} data-tab-anim={tabAnim}>
                <div className="content-area sully-messaging-content">
                    {tab === 'chat' && renderChatTab()}
                    {tab === 'moments' && renderMomentsTab()}
                    {tab === 'favorites' && renderFavoritesTab()}
                    {tab === 'profile' && renderProfileTab()}
                </div>
                <div id="messaging-bottom-bar" className="glass-tab-bar nj-tab-bottom-bar" role="navigation" aria-label="消息应用标签栏">
                    <div className={`tab-item nj-tab-bottom-item nj-tab-bottom-item-chat ${tab === 'chat' ? 'active nj-tab-bottom-item-active' : ''}`} role="button" tabIndex={0} aria-label="消息" onClick={() => selectTab('chat')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectTab('chat'); }} onPointerDown={startThemeLongPress} onPointerUp={cancelThemeLongPress} onPointerCancel={cancelThemeLongPress} onPointerLeave={cancelThemeLongPress} onContextMenu={event => { event.preventDefault(); openThemeSettings(); }}><div className="glass-icon nj-tab-bottom-icon"><ChatCircleDots weight={tab === 'chat' ? 'fill' : 'regular'} />{unreadTotal > 0 && <span className="nj-tab-bottom-total-unread">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}</div></div>
                    <div className={`tab-item nj-tab-bottom-item nj-tab-bottom-item-moments ${tab === 'moments' ? 'active nj-tab-bottom-item-active' : ''}`} role="button" tabIndex={0} aria-label="朋友圈" onClick={() => selectTab('moments')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectTab('moments'); }}><div className="glass-icon nj-tab-bottom-icon"><Planet weight={tab === 'moments' ? 'fill' : 'regular'} />{!!posts.length && <i className="nj-tab-bottom-moments-dot" />}</div></div>
                    <div className={`tab-item nj-tab-bottom-item nj-tab-bottom-item-favorites ${tab === 'favorites' ? 'active nj-tab-bottom-item-active' : ''}`} role="button" tabIndex={0} aria-label="收藏" onClick={() => selectTab('favorites')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectTab('favorites'); }}><div className="glass-icon nj-tab-bottom-icon"><Star weight={tab === 'favorites' ? 'fill' : 'regular'} /></div></div>
                    <div className={`tab-item nj-tab-bottom-item nj-tab-bottom-item-profile ${tab === 'profile' ? 'active nj-tab-bottom-item-active' : ''}`} role="button" tabIndex={0} aria-label="我的" onClick={() => selectTab('profile')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectTab('profile'); }}><div className="glass-icon nj-tab-bottom-icon"><UserCircle weight={tab === 'profile' ? 'fill' : 'regular'} /></div></div>
                </div>
            </div>
            {momentGenerateOpen && <div className="sully-msg-modal-layer" onClick={() => !momentGenerating && setMomentGenerateOpen(false)}><div className="sully-msg-modal-card" onClick={event => event.stopPropagation()}>
                <div className="sully-msg-modal-title">生成角色动态</div>
                <label className="sully-msg-field-label">角色选择</label>
                <div className="sully-msg-segmented"><button className={momentGenerateMode === 'random' ? 'active' : ''} onClick={() => setMomentGenerateMode('random')} disabled={momentGenerating}>随机角色</button><button className={momentGenerateMode === 'select' ? 'active' : ''} onClick={() => setMomentGenerateMode('select')} disabled={momentGenerating}>指定角色</button></div>
                {momentGenerateMode === 'select' && <div className="sully-msg-character-picker">{characters.map(char => <button key={char.id} className={momentSelectedIds.includes(char.id) ? 'selected' : ''} onClick={() => setMomentSelectedIds(current => current.includes(char.id) ? current.filter(id => id !== char.id) : [...current, char.id])} disabled={momentGenerating}><img src={char.avatar} alt="" /><span>{char.name}</span><i>{momentSelectedIds.includes(char.id) ? '✓' : ''}</i></button>)}</div>}
                <label className="sully-msg-field-label">生成数量 <b>{momentGenerateCount}</b></label>
                <input className="sully-msg-range" type="range" min="1" max="6" value={momentGenerateCount} onChange={event => setMomentGenerateCount(Number(event.target.value))} disabled={momentGenerating} />
                {momentProgress && <div className="sully-msg-progress">{momentProgress}</div>}
                <div className="sully-msg-modal-actions"><button onClick={() => setMomentGenerateOpen(false)} disabled={momentGenerating}>取消</button><button className="primary" onClick={() => void generateCharacterMoments()} disabled={momentGenerating || (momentGenerateMode === 'select' && !momentSelectedIds.length)}>{momentGenerating ? '生成中…' : '开始生成'}</button></div>
            </div></div>}
            {momentPostOpen && <div className="sully-msg-modal-layer" onClick={() => setMomentPostOpen(false)}><div className="sully-msg-modal-card sully-msg-modal-card-tall" onClick={event => event.stopPropagation()}>
                <div className="sully-msg-modal-head"><button onClick={() => setMomentPostOpen(false)}><X /></button><div className="sully-msg-modal-title">发布朋友圈</div><button className="sully-msg-save" onClick={() => void publishUserMoment()}>发布</button></div>
                <textarea className="sully-msg-post-text" value={newMomentText} onChange={event => setNewMomentText(event.target.value)} placeholder="这一刻的想法…" />
                {!!newMomentImages.length && <div className="sully-msg-image-grid">{newMomentImages.map((image, index) => <div key={index}><img src={image} alt="" /><button onClick={() => setNewMomentImages(current => current.filter((_, itemIndex) => itemIndex !== index))}><X /></button></div>)}</div>}
                <input ref={momentImageInputRef} type="file" accept="image/*" multiple hidden onChange={event => { void handleMomentImages(event.target.files); event.target.value = ''; }} />
                <button className="sully-msg-upload-btn" onClick={() => momentImageInputRef.current?.click()}><Camera />从相册添加图片</button>
                <label className="sully-msg-field-label">生图描述（可选）</label><textarea className="sully-msg-small-textarea" value={newMomentImagePrompt} onChange={event => setNewMomentImagePrompt(event.target.value)} placeholder="例如：a rainy Tokyo street at night, cinematic photo" />
                <button className="sully-msg-upload-btn" onClick={() => void drawNewMomentImage()} disabled={newMomentImageBusy || newMomentImages.length >= 9}><Sparkle />{newMomentImageBusy ? '正在生成图片…' : '使用生图 API 配图'}</button>
                <label className="sully-msg-field-label">位置（可选）</label><input className="sully-msg-input" value={newMomentLocation} onChange={event => setNewMomentLocation(event.target.value)} placeholder="所在位置" />
            </div></div>}
            {momentReroll && <div className="sully-msg-modal-layer" onClick={() => !momentRerollBusy && setMomentReroll(null)}><div className="sully-msg-modal-card" onClick={event => event.stopPropagation()}>
                <div className="sully-msg-modal-title">重新生成朋友圈图片</div>
                <p className="sully-msg-reroll-author">{posts.find(post => post.id === momentReroll.postId)?.authorName || '这条动态'}</p>
                <label className="sully-msg-field-label">生图描述</label>
                <textarea className="sully-msg-small-textarea" value={momentRerollPrompt} onChange={event => setMomentRerollPrompt(event.target.value)} placeholder="描述要重新生成的画面…" disabled={momentRerollBusy} />
                {!!posts.find(post => post.id === momentReroll.postId)?.imageGenerationError && <div className="sully-msg-reroll-error">上次失败：{posts.find(post => post.id === momentReroll.postId)?.imageGenerationError}</div>}
                <div className="sully-msg-modal-actions"><button onClick={() => setMomentReroll(null)} disabled={momentRerollBusy}>取消</button><button className="primary" onClick={() => void rerollMomentImage()} disabled={momentRerollBusy || !momentRerollPrompt.trim()}>{momentRerollBusy ? '重新生成中…' : '重新生成'}</button></div>
            </div></div>}
            {profileEditOpen && <div className="sully-msg-modal-layer sully-msg-profile-editor" onClick={() => setProfileEditOpen(false)}><div className="sully-msg-modal-card sully-msg-modal-card-tall" onClick={event => event.stopPropagation()}>
                <div className="sully-msg-modal-head"><button onClick={() => setProfileEditOpen(false)}><X /></button><div className="sully-msg-modal-title">编辑资料</div><button className="sully-msg-save" onClick={() => void persistProfile()}>保存</button></div>
                <div className="sully-msg-profile-images"><button onClick={() => profileAvatarInputRef.current?.click()}><img src={profileDraft.avatar || userProfile.avatar} alt="" /><span>更换头像</span></button><button onClick={() => profileCoverInputRef.current?.click()}>{profileDraft.cover ? <img src={profileDraft.cover} alt="" /> : <span className="sully-msg-cover-placeholder">添加封面</span>}<span>更换封面</span></button></div>
                <input ref={profileAvatarInputRef} type="file" accept="image/*" hidden onChange={event => { void handleProfileImage(event.target.files, 'avatar'); event.target.value = ''; }} /><input ref={profileCoverInputRef} type="file" accept="image/*" hidden onChange={event => { void handleProfileImage(event.target.files, 'cover'); event.target.value = ''; }} />
                <label className="sully-msg-field-label">昵称</label><input className="sully-msg-input" value={profileDraft.name} onChange={event => setProfileDraft(current => ({ ...current, name: event.target.value }))} />
                <label className="sully-msg-field-label">账号 ID</label><input className="sully-msg-input" value={profileDraft.handle} onChange={event => setProfileDraft(current => ({ ...current, handle: event.target.value }))} placeholder="不需要输入 @" />
                <label className="sully-msg-field-label">个性签名</label><textarea className="sully-msg-small-textarea" value={profileDraft.signature} onChange={event => setProfileDraft(current => ({ ...current, signature: event.target.value }))} placeholder="写点什么…" />
                <div className="sully-msg-two-columns"><label><span className="sully-msg-field-label">生日</span><input className="sully-msg-input" value={profileDraft.birthday} onChange={event => setProfileDraft(current => ({ ...current, birthday: event.target.value }))} placeholder="2001年6月28日" /></label><label><span className="sully-msg-field-label">性别</span><input className="sully-msg-input" value={profileDraft.gender} onChange={event => setProfileDraft(current => ({ ...current, gender: event.target.value }))} placeholder="自定义" /></label></div>
                <label className="sully-msg-field-label">地点</label><input className="sully-msg-input" value={profileDraft.location} onChange={event => setProfileDraft(current => ({ ...current, location: event.target.value }))} placeholder="例如：Tokyo" />
                <label className="sully-msg-field-label">兴趣爱好（逗号或换行分隔）</label><textarea className="sully-msg-small-textarea" value={profileDraft.hobbies.join('，')} onChange={event => setProfileDraft(current => ({ ...current, hobbies: event.target.value.split(/[,，\n]+/) }))} />
                <label className="sully-msg-field-label">关于我（支持换行）</label><textarea className="sully-msg-about-textarea" value={profileDraft.about} onChange={event => setProfileDraft(current => ({ ...current, about: event.target.value }))} placeholder={'角色档案：\n基本信息：\n…'} />
            </div></div>}
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
