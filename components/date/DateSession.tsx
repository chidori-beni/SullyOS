import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { CharacterProfile, Message, DateState, DialogueItem, UserProfile, DateObservation } from '../../types';
import Modal from '../../components/os/Modal';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import DateSettings from './DateSettings';
import ObserveHUD from './ObserveHUD';
import { DatePrompts, extractObservation, hasObservation } from '../../utils/datePrompts';
import { isBlobRef } from '../../utils/blobRef';
import { clearDateResumeAttempt } from '../../utils/dateSessionRecovery';
import {
    cleanTextForTts,
    cleanVoiceMarkupForDisplay,
    resolveMiniMaxModel,
    supportsMiniMaxInterjections,
} from '../../utils/minimaxTts';
import { synthesizeSpeech, characterHasVoice } from '../../utils/ttsRouter';
import { resolveTtsProvider } from '../../utils/ttsProvider';
import { cleanTextForTtsFish, stripFishMarkupForDisplay } from '../../utils/fishAudioTts';
import {
    cleanDateTextForDisplay as cleanTextForDisplay,
    extractDateDialogueText as extractDialogueText,
    extractDateDialogueSpeechText as extractDialogueSpeechText,
    isDateDialogueLine as isDialogueLine,
    parseDateDialogue as parseDialogue,
    addFallbackDateInterjectionToReply,
    protectMiniMaxInterjectionsForTranslation,
} from '../../utils/dateVoiceMarkup';
import { planNovelLoadMore } from '../../utils/dateSessionHistory';
import { getPendingReplyText } from '../../utils/pendingReply';
import { fetchBlobForShare } from '../../utils/shareExport';
import VoiceFavoriteActionSheet from '../voice/VoiceFavoriteActionSheet';
import { getVoiceFavorite, makeVoiceFavoriteId, removeVoiceFavorite, saveVoiceFavorite } from '../../utils/voiceFavorites';
import { getDatePhoneSpeaker, isDatePhoneBridge, formatDatePhoneMarkdown } from '../../utils/datePhoneBridge';
import { stripMessageReactionTags } from '../../utils/messageReactions';
import { stripFaceToFacePhoneSourceTags } from '../../utils/sanitize';
import { ArrowLeft, CornersIn, CornersOut } from '@phosphor-icons/react';

interface DateSessionProps {
    char: CharacterProfile;
    userProfile: UserProfile;
    messages: Message[]; // The DB messages for history/novel mode
    peekStatus: string;  // Initial text from the Peek phase
    initialState?: DateState; // Resume state
    /** 完结见面回顾：直接浏览既有内容，不生成新回复、不创建恢复存档。 */
    historyReplay?: boolean;
    /** 当前见面的剧情时钟快照；回顾页缺省时从消息检查点推导。 */
    encounterId?: string;
    encounterStartedAt?: number;
    sceneClockAt?: number;
    sceneClockAdvancedMs?: number;
    sceneClockRevision?: number;
    sceneClockUpdatedAt?: number;
    sceneClockTimeZone?: string;
    dateTimeAwarenessEnabled?: boolean;
    onSendMessage: (text: string) => Promise<string>; // Returns AI content
    onReroll: () => Promise<string>;
    onInterlude?: (description: string, targetAt?: number) => Promise<string>;
    onSetSceneClock?: (timestamp: number) => Promise<void>;
    onExit: (currentState: DateState) => void;
    onEnd: (currentState: DateState) => Promise<void>;
    endSuggestedReason?: string;
    onEditMessage: (msg: Message) => void;
    onDeleteMessage: (msg: Message) => void;
    onDeleteMessages: (ids: number[]) => Promise<void>;
    onSettings: () => void;
    /** 阅读模式「加载更早」铺满已加载部分后，回库里取下一批（limit 递增式重取）。 */
    onLoadMoreHistory?: (nextLimit: number) => Promise<void>;
    /** 当前查询用的 limit（配合 onLoadMoreHistory 递增）。 */
    historyLoadLimit?: number;
    /** 库里的见面记录是否已经取完。 */
    historyReachedEnd?: boolean;
}

// Long replies can expand into many DOM lines. Keeping a smaller reading window
// materially reduces iOS WebKit content-process crashes while older entries
// remain available through the existing "加载更早" button.
const NOVEL_MESSAGE_WINDOW_SIZE = 40;
/** 铺满已加载部分后，每次回库多取多少条见面消息。 */
const NOVEL_HISTORY_FETCH_STEP = 220;
const NOVEL_MESSAGE_LOAD_STEP = 40;
const REQUIRED_EMOTIONS_SET = ['normal', 'happy', 'angry', 'sad', 'shy'];

type DateSpeechResult = { url: string; spokenText: string };
type DateVoiceFavoriteTarget = {
    sourceKey: string;
    originalText: string;
    /** 朗读原文，保留 MiniMax inline 语气词；旧记录缺省时回退到 originalText。 */
    speechText?: string;
    sourceTimestamp: number;
    voiceEmotion?: string;
};

const ReadingAvatar: React.FC<{ src?: string; name: string; light: boolean; className?: string; imageClassName?: string }> = ({ src, name, light, className = '', imageClassName = '' }) => {
    const [imageFailed, setImageFailed] = useState(false);
    useEffect(() => setImageFailed(false), [src]);

    const canShowImage = !!src && !isBlobRef(src) && !imageFailed;
    return (
        <div
            className={`tm-avatar mt-1 h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 shadow-sm ${
                light ? 'bg-stone-200 text-stone-500 ring-stone-300/70' : 'bg-white/10 text-white/70 ring-white/15'
            } ${className}`}
            aria-hidden="true"
        >
            {canShowImage ? (
                <img
                    src={src}
                    alt=""
                    className={`h-full w-full object-cover ${imageClassName}`}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-bold">
                    {(name || '·').trim().slice(0, 1) || '·'}
                </span>
            )}
        </div>
    );
};

const DateSession: React.FC<DateSessionProps> = ({
    onLoadMoreHistory,
    historyLoadLimit = 0,
    historyReachedEnd = true,
    char, 
    userProfile,
    messages,
    peekStatus,
    initialState,
    historyReplay = false,
    encounterId,
    encounterStartedAt,
    sceneClockAt,
    sceneClockAdvancedMs,
    sceneClockRevision,
    sceneClockUpdatedAt,
    sceneClockTimeZone,
    dateTimeAwarenessEnabled = true,
    onSendMessage,
    onReroll,
    onInterlude,
    onSetSceneClock,
    onExit,
    onEnd,
    endSuggestedReason,
    onEditMessage,
    onDeleteMessage,
    onDeleteMessages,
    onSettings
}) => {
    const { addToast, registerBackHandler, apiConfig, updateCharacter } = useOS();
    
    // Core VN State
    const [isNovelMode, setIsNovelMode] = useState(historyReplay);
    const [bgImage, setBgImage] = useState<string>(char.dateBackground || '');
    const [currentSprite, setCurrentSprite] = useState<string>('');
    const [currentSpriteKey, setCurrentSpriteKey] = useState<string>('');
    const [spriteConfig, setSpriteConfig] = useState(char.spriteConfig || { scale: 1, x: 0, y: 0 });
    
    // Dialogue Engine State
    const [dialogueQueue, setDialogueQueue] = useState<DialogueItem[]>([]);
    const [dialogueBatch, setDialogueBatch] = useState<DialogueItem[]>([]); // Current visual-novel batch; never auto-replayed
    const [currentDialogueIndex, setCurrentDialogueIndex] = useState(-1);
    const currentDialogueIndexRef = useRef(-1);
    currentDialogueIndexRef.current = currentDialogueIndex;
    const [currentText, setCurrentText] = useState('');
    const [displayedText, setDisplayedText] = useState('');
    const [isTextAnimating, setIsTextAnimating] = useState(false);

    // 观测协议 OBSERVE：当前批次解析出的结构化观测，驱动全息 HUD
    const observeEnabled = !!char.dateObserve?.enabled;
    // 阅读与立绘共用一个正文大小设置。旧角色没有该字段时回到糯叽机兼容的 14px。
    const dateFontSize = Math.min(28, Math.max(10, Number(char.dateFontSize) || 14));
    const [observation, setObservation] = useState<DateObservation | null>(initialState?.observation ?? null);
    
    // Interaction State
    const [input, setInput] = useState('');
    const [showInputBox, setShowInputBox] = useState(false);
    const [isTyping, setIsTyping] = useState(false); // Waiting for API
    const [isShowingOpening, setIsShowingOpening] = useState(!historyReplay && !initialState); // True until first user interaction
    const [showExitModal, setShowExitModal] = useState(false);
    const [endingEncounter, setEndingEncounter] = useState(false);
    const [showInterludeEditor, setShowInterludeEditor] = useState(false);
    const [interludeDescription, setInterludeDescription] = useState('');
    const [showClockEditor, setShowClockEditor] = useState(false);
    const [clockInput, setClockInput] = useState('');
    const [clockBusy, setClockBusy] = useState(false);
    const [isFullscreenEditor, setIsFullscreenEditor] = useState(false);
    const [isInputOverflowing, setIsInputOverflowing] = useState(false);
    const [realNow, setRealNow] = useState(() => Date.now());
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fullscreenTextareaRef = useRef<HTMLTextAreaElement>(null);
    const MAX_DATE_INPUT_HEIGHT = 144;
    const handledEndSuggestionRef = useRef('');
    useEffect(() => {
        if (!endSuggestedReason || isTyping || isTextAnimating || dialogueQueue.length > 0) return;
        if (handledEndSuggestionRef.current === endSuggestedReason) return;
        handledEndSuggestionRef.current = endSuggestedReason;
        setShowExitModal(true);
    }, [endSuggestedReason, isTyping, isTextAnimating, dialogueQueue.length]);
    // API 失败时本地记住本轮输入，不依赖父组件的 DB 刷新是否已经完成；用户可直接点重试。
    const [pendingRetryText, setPendingRetryText] = useState('');

    useEffect(() => {
        if (!getPendingReplyText(messages)) setPendingRetryText('');
    }, [messages]);
    
    // Settings Overlay State (Internal)
    const [showSettings, setShowSettings] = useState(false);

    // 顶栏折叠菜单：常驻只留「输入」+「菜单」两钮，低频操作全收进来
    const [showMenu, setShowMenu] = useState(false);

    // Edit Msg Logic
    const [modalType, setModalType] = useState<'none' | 'options'>('none');
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [isBatchSelectMode, setIsBatchSelectMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartRef = useRef<{x: number, y: number} | null>(null);
    const novelScrollRef = useRef<HTMLDivElement>(null);

    // Voice TTS — single shared cache keyed by dialogue text, used by both GAL & novel mode
    const [dateVoicePlaying, setDateVoicePlaying] = useState(false);
    const [galVoiceLoading, setGalVoiceLoading] = useState(false);
    const [showVoiceLangPicker, setShowVoiceLangPicker] = useState(false);
    const voiceCacheRef = useRef<Record<string, DateSpeechResult>>({});
    const [novelVoiceLoading, setNovelVoiceLoading] = useState<Set<string>>(new Set());
    const [novelPlayingId, setNovelPlayingId] = useState<string | null>(null);
    const [novelVisibleCount, setNovelVisibleCount] = useState(NOVEL_MESSAGE_WINDOW_SIZE);
    const [novelHistoryLoading, setNovelHistoryLoading] = useState(false);
    const dateAudioRef = useRef<HTMLAudioElement | null>(null);
    const scrollToNovelHistoryTopRef = useRef(false);
    const voiceEnabled = !!char.dateVoiceEnabled;
    const voiceLang = char.dateVoiceLang || '';
    const dateTtsProvider = resolveTtsProvider(apiConfig);
    const dateMiniMaxModel = resolveMiniMaxModel(char.voiceProfile?.model);
    const canUseDateMiniMaxInterjections = dateTtsProvider === 'minimax'
        && supportsMiniMaxInterjections(dateMiniMaxModel);
    const unsupportedDateModelWarnedRef = useRef('');
    const parseDateDialogueForPlayback = React.useCallback((fullText: string): DialogueItem[] => {
        return addFallbackDateInterjectionToReply(
            parseDialogue(fullText, 'normal'),
            canUseDateMiniMaxInterjections,
        );
    }, [voiceEnabled, canUseDateMiniMaxInterjections]);

    useEffect(() => {
        if (!voiceEnabled || dateTtsProvider !== 'minimax' || canUseDateMiniMaxInterjections) {
            unsupportedDateModelWarnedRef.current = '';
            return;
        }
        if (unsupportedDateModelWarnedRef.current === dateMiniMaxModel) return;
        unsupportedDateModelWarnedRef.current = dateMiniMaxModel;
        addToast(
            `当前 MiniMax 模型「${dateMiniMaxModel}」不支持语气词；当前仍可朗读，但已自动去除标签。请在角色语音设置改为 speech-2.8-turbo 或 speech-2.8-hd。`,
            'info',
        );
    }, [voiceEnabled, dateTtsProvider, canUseDateMiniMaxInterjections, dateMiniMaxModel, addToast]);

    // Bridges the current line's VOICE emotion ([v:xxx], 跟立绘情绪分开) to the GAL
    // voice effect (which keys off currentText only). undefined = 不传情绪，自然朗读。
    // A ref so it doesn't churn the effect's deps.
    const currentLineEmotionRef = useRef<string | undefined>(undefined);
    // currentText is intentionally display-safe; keep its TTS counterpart beside it
    // so GAL mode does not have to reconstruct (chuckle)/(breath) from rendered text.
    const currentLineSpeechTextRef = useRef<string | undefined>(undefined);
    const [voiceFavoriteTarget, setVoiceFavoriteTarget] = useState<DateVoiceFavoriteTarget | null>(null);
    const [voiceFavoriteSaved, setVoiceFavoriteSaved] = useState(false);
    const [voiceFavoriteBusy, setVoiceFavoriteBusy] = useState(false);
    const voiceFavoriteLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const voiceFavoriteLongPressTriggered = useRef(false);

    const VOICE_LANG_LABELS: Record<string, string> = { en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español' };
    const VOICE_LANG_OPTIONS = [{v:'',l:'默认'},{v:'en',l:'EN'},{v:'ja',l:'JP'},{v:'ko',l:'KR'},{v:'fr',l:'FR'},{v:'es',l:'ES'}];

    const latestSceneClockMessage = React.useMemo(() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (message.metadata?.source === 'date' && typeof message.metadata?.sceneClockAt === 'number' && Number.isFinite(message.metadata.sceneClockAt)) {
                return message;
            }
        }
        return undefined;
    }, [messages]);
    const effectiveSceneClockAt = typeof sceneClockAt === 'number' && Number.isFinite(sceneClockAt)
        ? sceneClockAt
        : typeof initialState?.sceneClockAt === 'number' && Number.isFinite(initialState.sceneClockAt)
            ? initialState.sceneClockAt
            : latestSceneClockMessage?.metadata?.sceneClockAt ?? messages.find(message => message.metadata?.source === 'date')?.timestamp;
    const effectiveSceneClockAdvancedMs = typeof sceneClockAdvancedMs === 'number' && Number.isFinite(sceneClockAdvancedMs)
        ? sceneClockAdvancedMs
        : initialState?.sceneClockAdvancedMs ?? latestSceneClockMessage?.metadata?.sceneClockAdvancedMs ?? 0;
    const effectiveSceneClockRevision = typeof sceneClockRevision === 'number' && Number.isFinite(sceneClockRevision)
        ? sceneClockRevision
        : initialState?.sceneClockRevision ?? latestSceneClockMessage?.metadata?.sceneClockRevision ?? 0;
    const effectiveSceneClockTimeZone = sceneClockTimeZone
        || initialState?.sceneClockTimeZone
        || latestSceneClockMessage?.metadata?.sceneClockTimeZone;
    const formatHeaderClock = (timestamp?: number) => {
        if (!Number.isFinite(timestamp)) return '';
        const formatted = DatePrompts.formatSceneClock(timestamp as number, effectiveSceneClockTimeZone);
        const match = formatted.match(/^\S+\s+(\d{2}:\d{2})\s+(\S+)$/);
        return match ? `${match[2]} ${match[1]}` : formatted;
    };

    useEffect(() => {
        const timer = window.setInterval(() => setRealNow(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, []);

    // 面对面输入框沿用聊天栏的防抖测高策略：最多六行，超过后在框内滚动，
    // 并提供全屏编辑兜底，不让长段动作描写把场景顶出屏幕。
    const syncDateTextareaHeight = React.useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea || !textarea.isConnected || textarea.offsetParent === null || textarea.clientWidth === 0) return;
        const computed = window.getComputedStyle(textarea);
        const fontSize = parseFloat(computed.fontSize) || 15;
        const lineHeight = parseFloat(computed.lineHeight) || Math.round(fontSize * 1.5);
        const paddingY = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0);
        const singleRowHeight = Math.ceil(lineHeight + paddingY);
        const previousHeight = textarea.style.height;
        textarea.style.height = 'auto';
        const measured = textarea.scrollHeight;
        if (!measured) {
            textarea.style.height = previousHeight;
            return;
        }
        const contentHeight = Math.max(measured, singleRowHeight);
        const overflowing = contentHeight > MAX_DATE_INPUT_HEIGHT;
        textarea.style.height = `${Math.min(contentHeight, MAX_DATE_INPUT_HEIGHT)}px`;
        textarea.style.overflowY = overflowing ? 'auto' : 'hidden';
        textarea.style.touchAction = overflowing ? 'pan-y' : '';
        setIsInputOverflowing(previous => previous === overflowing ? previous : overflowing);
    }, []);

    useEffect(() => {
        syncDateTextareaHeight();
    }, [syncDateTextareaHeight, input, isInputOverflowing, showInputBox]);

    useEffect(() => {
        const handleResize = () => syncDateTextareaHeight();
        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);
        window.visualViewport?.addEventListener('resize', handleResize);
        const raf = window.requestAnimationFrame(handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);
            window.visualViewport?.removeEventListener('resize', handleResize);
            window.cancelAnimationFrame(raf);
        };
    }, [syncDateTextareaHeight]);

    useEffect(() => {
        if (!isFullscreenEditor) return;
        const textarea = fullscreenTextareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isFullscreenEditor]);

    const translateAndSpeak = async (text: string, emotion?: string): Promise<DateSpeechResult | null> => {
        if (!characterHasVoice(char, apiConfig)) return null;
        try {
            // 鱼声保留 inline cue，用 Fish 专属清洗；MiniMax 走原来的清洗。
            const provider = resolveTtsProvider(apiConfig);
            const sourceTtsText = provider === 'fishaudio' ? cleanTextForTtsFish(text) : cleanTextForTts(text);
            let ttsText = sourceTtsText;
            if (!ttsText || ttsText.length < 2) return null;
            if (voiceLang) {
                const langLabel = VOICE_LANG_LABELS[voiceLang] || voiceLang;
                try {
                    // 翻译模型不认识 MiniMax 的 inline 标签。先用不可翻译的占位符
                    // 保护它们，翻译后逐一校验并还原；失败就回退原文，宁可不翻也不
                    // 让一次翻译静默吃掉 chuckle/breath。
                    const protectedInterjections = provider === 'minimax'
                        ? protectMiniMaxInterjectionsForTranslation(ttsText)
                        : null;
                    const translationInput = protectedInterjections?.text || ttsText;
                    const transRes = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                        body: JSON.stringify({
                            model: apiConfig.model,
                            messages: [{ role: 'system', content: `Translate the following text to ${langLabel}. Output ONLY the translation, nothing else. Preserve every SULLYMMVOICECUE...END placeholder exactly once.` }, { role: 'user', content: translationInput }],
                            temperature: 0.3,
                        }),
                    });
                    const transData = await transRes.json();
                    const translated = transData?.choices?.[0]?.message?.content?.trim();
                    if (translated) {
                        const restored = protectedInterjections
                            ? protectedInterjections.restore(translated)
                            : translated;
                        if (restored !== null) {
                            ttsText = restored;
                        } else {
                            console.warn('Date TTS translation changed MiniMax interjection placeholders; using source text.');
                            ttsText = sourceTtsText;
                        }
                    }
                } catch { /* use original */ }
            }
            const url = await synthesizeSpeech(ttsText, char, apiConfig, {
                languageBoost: voiceLang || undefined,
                groupId: apiConfig.minimaxGroupId || undefined,
                emotion,
            });
            return {
                url,
                spokenText: provider === 'fishaudio'
                    ? stripFishMarkupForDisplay(ttsText)
                    : cleanVoiceMarkupForDisplay(ttsText),
            };
        } catch (err: any) {
            console.warn('Date TTS failed:', err?.message);
            return null;
        }
    };

    // GAL mode: auto-play voice only for dialogue lines (quoted text), stop previous on advance
    // Uses cache so replaying the same line doesn't re-fetch
    useEffect(() => {
        if (!voiceEnabled || isNovelMode || !currentText || isTyping) return;
        // Stop any currently playing audio when text changes (advancing to next line)
        if (dateAudioRef.current) {
            dateAudioRef.current.pause();
            dateAudioRef.current.currentTime = 0;
            setDateVoicePlaying(false);
        }
        setGalVoiceLoading(false);
        // Skip voice during opening phase and for non-dialogue lines
        if (isShowingOpening) return;
        if (!isDialogueLine(currentText)) return;
        let cancelled = false;
        const speechText = currentLineSpeechTextRef.current || extractDialogueText(currentText);
        const cacheKey = speechText;
        const play = async () => {
            // Check cache first
            let speech: DateSpeechResult | undefined = voiceCacheRef.current[cacheKey];
            if (!speech) {
                setGalVoiceLoading(true);
                speech = await translateAndSpeak(speechText, currentLineEmotionRef.current) || undefined;
                if (cancelled) return;
                setGalVoiceLoading(false);
                if (!speech) return;
                voiceCacheRef.current[cacheKey] = speech;
            }
            if (cancelled) return;
            if (!dateAudioRef.current) dateAudioRef.current = new Audio();
            dateAudioRef.current.src = speech.url;
            dateAudioRef.current.onended = () => setDateVoicePlaying(false);
            dateAudioRef.current.play().catch(() => {});
            setDateVoicePlaying(true);
        };
        play();
        return () => { cancelled = true; setGalVoiceLoading(false); if (dateAudioRef.current) { dateAudioRef.current.pause(); } };
    }, [currentText, voiceEnabled, isNovelMode]);

    // GAL mode: manual play/pause for the current dialogue line
    const handleGalVoiceToggle = async () => {
        if (!currentText || !isDialogueLine(currentText)) return;
        // If playing, pause
        if (dateVoicePlaying && dateAudioRef.current) {
            dateAudioRef.current.pause();
            setDateVoicePlaying(false);
            return;
        }
        const speechText = currentLineSpeechTextRef.current || extractDialogueText(currentText);
        const cacheKey = speechText;
        let speech: DateSpeechResult | undefined = voiceCacheRef.current[cacheKey];
        if (!speech) {
            setGalVoiceLoading(true);
            speech = await translateAndSpeak(speechText, currentLineEmotionRef.current) || undefined;
            setGalVoiceLoading(false);
            if (!speech) { addToast('语音合成失败，请稍后重试', 'error'); return; }
            voiceCacheRef.current[cacheKey] = speech;
        }
        if (!dateAudioRef.current) dateAudioRef.current = new Audio();
        dateAudioRef.current.src = speech.url;
        dateAudioRef.current.onended = () => setDateVoicePlaying(false);
        dateAudioRef.current.play().catch(() => {});
        setDateVoicePlaying(true);
    };

    // Novel/Reading mode: play a specific dialogue line (shares voiceCacheRef with GAL mode)
    // voiceEmotion（[v:xxx]）跟立绘模式保持一致地传给 TTS：这样两种模式合成的音频完全相同，
    // 且命中同一条持久缓存（ttsCache/IndexedDB）——退出见面再进来点旧台词也能从本地缓存秒取，
    // 不必按不同的 key 重新联网合成。
    const handleNovelLinePlay = async (lineKey: string, displayText: string, speechText: string, voiceEmotion?: string) => {
        const sourceText = speechText || displayText;
        const cached = voiceCacheRef.current[sourceText];
        if (cached) {
            // Already have URL (from GAL or previous novel play), just play/pause
            if (!dateAudioRef.current) dateAudioRef.current = new Audio();
            if (novelPlayingId === lineKey) {
                dateAudioRef.current.pause();
                setNovelPlayingId(null);
                return;
            }
            dateAudioRef.current.src = cached.url;
            dateAudioRef.current.onended = () => setNovelPlayingId(null);
            dateAudioRef.current.play().catch(() => {});
            setNovelPlayingId(lineKey);
            return;
        }
        setNovelVoiceLoading(prev => new Set(prev).add(lineKey));
        const speech = await translateAndSpeak(sourceText, voiceEmotion);
        setNovelVoiceLoading(prev => { const n = new Set(prev); n.delete(lineKey); return n; });
        if (!speech) { addToast('语音合成失败，请稍后重试', 'error'); return; }
        voiceCacheRef.current[sourceText] = speech;
        if (!dateAudioRef.current) dateAudioRef.current = new Audio();
        dateAudioRef.current.src = speech.url;
        dateAudioRef.current.onended = () => setNovelPlayingId(null);
        dateAudioRef.current.play().catch(() => {});
        setNovelPlayingId(lineKey);
    };

    const resolveCurrentDateVoiceTarget = (): DateVoiceFavoriteTarget | null => {
        if (!currentText || !isDialogueLine(currentText)) return null;
        const originalText = extractDialogueText(currentText);
        const currentSpeechText = currentLineSpeechTextRef.current || originalText;
        for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
            const message = messages[messageIndex];
            if (message.role !== 'assistant' || isDatePhoneBridge(message)) continue;
            const { rest: body } = extractObservation(message.content || '', { lenient: observeEnabled, custom: char.dateObserve?.custom });
            const lines = body.split('\n');
            for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
                const parsed = parseDialogue(lines[lineIndex], 'normal')[0];
                if (parsed && isDialogueLine(parsed.text) && extractDialogueText(parsed.text) === originalText) {
                    return {
                        sourceKey: `${char.id}:${message.id}-${lineIndex}`,
                        originalText,
                        sourceTimestamp: message.timestamp,
                        speechText: parsed.speechText || currentSpeechText,
                        voiceEmotion: parsed.voiceEmotion || currentLineEmotionRef.current,
                    };
                }
            }
        }
        return {
            sourceKey: `${char.id}:live:${makeVoiceFavoriteId('date', originalText)}`,
            originalText,
            speechText: currentSpeechText,
            sourceTimestamp: Date.now(),
            voiceEmotion: currentLineEmotionRef.current,
        };
    };

    const openDateVoiceFavorite = async (target: DateVoiceFavoriteTarget | null) => {
        if (!target) return;
        setVoiceFavoriteTarget(target);
        setVoiceFavoriteBusy(false);
        setVoiceFavoriteSaved(!!await getVoiceFavorite('date', target.sourceKey).catch(() => null));
    };

    const startDateVoiceLongPress = (event: React.TouchEvent, target: DateVoiceFavoriteTarget | null) => {
        event.stopPropagation();
        if (!target) return;
        voiceFavoriteLongPressTriggered.current = false;
        if (voiceFavoriteLongPressTimer.current) clearTimeout(voiceFavoriteLongPressTimer.current);
        voiceFavoriteLongPressTimer.current = setTimeout(() => {
            voiceFavoriteLongPressTriggered.current = true;
            void openDateVoiceFavorite(target);
        }, 450);
    };

    const endDateVoiceLongPress = (event: React.SyntheticEvent) => {
        event.stopPropagation();
        if (voiceFavoriteLongPressTimer.current) clearTimeout(voiceFavoriteLongPressTimer.current);
        voiceFavoriteLongPressTimer.current = null;
    };

    const toggleDateVoiceFavorite = async () => {
        const target = voiceFavoriteTarget;
        if (!target || voiceFavoriteBusy) return;
        setVoiceFavoriteBusy(true);
        try {
            if (voiceFavoriteSaved) {
                await removeVoiceFavorite('date', target.sourceKey);
                setVoiceFavoriteSaved(false);
                addToast('已取消收藏语音', 'info');
                return;
            }
            const sourceText = target.speechText || target.originalText;
            let speech: DateSpeechResult | undefined = voiceCacheRef.current[sourceText];
            if (!speech) {
                speech = await translateAndSpeak(sourceText, target.voiceEmotion) || undefined;
                if (speech) voiceCacheRef.current[sourceText] = speech;
            }
            if (!speech) throw new Error('语音合成失败，请稍后重试');
            const blob = await fetchBlobForShare(speech.url, 'audio/mpeg');
            await saveVoiceFavorite({
                source: 'date',
                sourceKey: target.sourceKey,
                charId: char.id,
                charName: char.name,
                sourceTimestamp: target.sourceTimestamp,
                originalText: target.originalText,
                spokenText: speech.spokenText !== target.originalText ? speech.spokenText : undefined,
                language: voiceLang || undefined,
                blob,
            });
            setVoiceFavoriteSaved(true);
            addToast('已收藏见面语音', 'success');
        } catch (error: any) {
            addToast(error?.message || '收藏失败，请检查浏览器存储空间', 'error');
        } finally {
            setVoiceFavoriteBusy(false);
        }
    };

    // Back Handler
    useEffect(() => {
        const unregister = registerBackHandler(() => {
            if (voiceFavoriteTarget) {
                if (!voiceFavoriteBusy) setVoiceFavoriteTarget(null);
                return true;
            }
            if (isFullscreenEditor) {
                setIsFullscreenEditor(false);
                return true;
            }
            if (showSettings) {
                setShowSettings(false);
                return true;
            }
            if (showInterludeEditor) {
                if (!isTyping) setShowInterludeEditor(false);
                return true;
            }
            if (showClockEditor) {
                if (!clockBusy) setShowClockEditor(false);
                return true;
            }
            if (showMenu) {
                setShowMenu(false);
                setShowVoiceLangPicker(false);
                return true;
            }
            if (showExitModal) {
                setShowExitModal(false);
                return true;
            }
            setShowExitModal(true);
            return true;
        });
        return unregister;
    }, [voiceFavoriteTarget, voiceFavoriteBusy, isFullscreenEditor, showSettings, showInterludeEditor, showClockEditor, clockBusy, isTyping, showMenu, showExitModal, registerBackHandler]);

    const dateEmotionKeys = [...REQUIRED_EMOTIONS_SET, ...(char.customDateSprites || [])];

    const getSpritesForSkin = (skinId?: string): Record<string, string> => {
        const explicitSkin = skinId && char.dateSkinSets?.find(s => s.id === skinId);
        if (explicitSkin && Object.keys(explicitSkin.sprites || {}).length > 0) return explicitSkin.sprites;
        if (char.activeSkinSetId && char.dateSkinSets) {
            const activeSkin = char.dateSkinSets.find(s => s.id === char.activeSkinSetId);
            if (activeSkin && Object.keys(activeSkin.sprites || {}).length > 0) return activeSkin.sprites;
        }
        return char.sprites || {};
    };

    const activeSprites = React.useMemo(() => getSpritesForSkin(), [char.activeSkinSetId, char.dateSkinSets, char.sprites]);

    // 完结见面回顾在立绘模式中按时间顺序把所有角色回复重新铺成一条播放队列。
    // 用户消息仍由阅读模式保留显示；立绘模式与当时的体验一样只推进角色的台词/叙述。
    const replayDialogueItems = React.useMemo(() => {
        if (!historyReplay) return [];
        return messages
            .filter(message => message.role === 'assistant'
                && message.metadata?.isDateEnding !== true
                && !isDatePhoneBridge(message))
            .flatMap(message => {
                const { rest } = extractObservation(message.content || '', {
                    lenient: observeEnabled,
                    custom: char.dateObserve?.custom,
                });
                return parseDateDialogueForPlayback(rest);
            });
    }, [historyReplay, messages, observeEnabled, char.dateObserve?.custom, parseDateDialogueForPlayback]);

    const pickFallbackSprite = (sprites: Record<string, string>) => {
        const key = ['normal', 'default', ...dateEmotionKeys].find(k => sprites[k] && !isBlobRef(sprites[k]));
        const stray = Object.entries(sprites).find(([k, v]) => k !== 'chibi' && v && !isBlobRef(v));
        return { key: key || stray?.[0] || '', src: (key && sprites[key]) || stray?.[1] || char.avatar || '' };
    };

    const inferSpriteKey = (src?: string, skinId?: string): string => {
        if (!src) return '';
        const sprites = getSpritesForSkin(skinId);
        return Object.entries(sprites).find(([, value]) => value === src)?.[0] || '';
    };

    const resolveSpriteByKey = (key?: string, skinId?: string) => {
        const sprites = getSpritesForSkin(skinId);
        if (key && sprites[key] && !isBlobRef(sprites[key])) return { key, src: sprites[key] };
        return pickFallbackSprite(sprites);
    };

    const resolveSpriteFromState = (state: DateState) => {
        const bySavedKey = resolveSpriteByKey(state.currentSpriteKey, state.activeSkinSetId);
        if (state.currentSpriteKey && bySavedKey.src) return bySavedKey;
        const legacyKey = inferSpriteKey(state.currentSprite, state.activeSkinSetId) || inferSpriteKey(state.currentSprite);
        if (legacyKey) return resolveSpriteByKey(legacyKey, state.activeSkinSetId);
        const fallback = resolveSpriteByKey(undefined, state.activeSkinSetId);
        const legacySprite = state.currentSprite && !isBlobRef(state.currentSprite)
            ? state.currentSprite
            : fallback.src;
        return { key: fallback.key, src: legacySprite };
    };

    // Filter messages for Novel Mode: Show only current session
    // Logic: Find the LAST message with `isOpening: true`. Show all messages from there onwards.
    const sessionMessages = React.useMemo(() => {
        // 回顾页的 messages 已经是用户点开的整次/整日分页，不应再按“最后一个
        // 开场锚点”裁成最后一场；否则按日期回顾会悄悄丢掉当天前面的见面。
        if (historyReplay) return messages;
        const openingIndex = messages.map(m => m.metadata?.isOpening).lastIndexOf(true);
        if (openingIndex !== -1) {
            return messages.slice(openingIndex);
        }
        // Fallback: If no opening found (legacy data), show all
        return messages;
    }, [historyReplay, messages]);

    const visibleSessionMessages = React.useMemo(() => {
        return sessionMessages.slice(-novelVisibleCount);
    }, [sessionMessages, novelVisibleCount]);
    const hiddenNovelMessageCount = Math.max(0, sessionMessages.length - visibleSessionMessages.length);

    useEffect(() => {
        setNovelVisibleCount(NOVEL_MESSAGE_WINDOW_SIZE);
    }, [char.id]);

    // Initialization
    useEffect(() => {
        if (historyReplay) {
            const initialSprite = pickFallbackSprite(activeSprites);
            setBgImage(char.dateBackground || '');
            setCurrentSprite(initialSprite.src);
            setCurrentSpriteKey(initialSprite.key);
            setIsShowingOpening(false);
            setDialogueBatch(replayDialogueItems);
            setDialogueQueue(replayDialogueItems.slice(1));
            if (replayDialogueItems.length > 0) {
                const first = replayDialogueItems[0];
                setCurrentText(first.text);
                setDisplayedText(first.text);
                currentLineEmotionRef.current = first.voiceEmotion;
                currentLineSpeechTextRef.current = first.speechText;
                setCurrentDialogueIndex(0);
            } else {
                setCurrentText('');
                setDisplayedText('');
                currentLineEmotionRef.current = undefined;
                currentLineSpeechTextRef.current = undefined;
                setCurrentDialogueIndex(-1);
            }
        } else if (initialState) {
            // Resume: 新快照只保存 sprite key，不再复制 base64；旧快照的 bg/currentSprite 仍兼容读取一次。
            const restoredSprite = resolveSpriteFromState(initialState);
            setBgImage(char.dateBackground || initialState.bgImage || '');
            setCurrentSprite(isBlobRef(restoredSprite.src) ? (char.avatar || '') : restoredSprite.src);
            setCurrentSpriteKey(restoredSprite.key);
            const restoredCurrentText = cleanTextForDisplay(initialState.currentText || '');
            setCurrentText(restoredCurrentText);
            setDisplayedText(restoredCurrentText);
            const restoredQueue = Array.isArray(initialState.dialogueQueue) ? initialState.dialogueQueue : [];
            const restoredBatch = Array.isArray(initialState.dialogueBatch) ? initialState.dialogueBatch : [];
            const restoredIndex = typeof initialState.dialogueIndex === 'number'
                ? initialState.dialogueIndex
                : Math.max(-1, restoredBatch.length - restoredQueue.length - 1);
            setDialogueQueue(restoredQueue);
            setDialogueBatch(restoredBatch);
            setCurrentDialogueIndex(restoredIndex);
            currentLineEmotionRef.current = restoredIndex >= 0 ? restoredBatch[restoredIndex]?.voiceEmotion : undefined;
            currentLineSpeechTextRef.current = restoredIndex >= 0
                ? (restoredBatch[restoredIndex]?.speechText || extractDialogueSpeechText(initialState.currentText || '') || undefined)
                : undefined;
            setIsNovelMode(!!initialState.isNovelMode);
        } else {
            // New Session - pick initial sprite from active skin set or default sprites
            const initialSprite = pickFallbackSprite(activeSprites);
            setCurrentSprite(initialSprite.src);
            setCurrentSpriteKey(initialSprite.key);
            
            // Parse Peek Status as opening — 先剥出观测块（开了 OBSERVE 才有）
            const startText = peekStatus || "Waiting for connection...";
            const { observation: peekObs, rest: peekRest } = extractObservation(startText, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(peekObs)) setObservation(peekObs);
            const items = parseDateDialogueForPlayback(peekRest);
            setDialogueBatch(items);
            setDialogueQueue(items.slice(1));

            if (items.length > 0) {
                // Manually trigger first item processing
                const first = items[0];
                setCurrentText(first.text);
                currentLineEmotionRef.current = first.voiceEmotion;
                currentLineSpeechTextRef.current = first.speechText;
                setCurrentDialogueIndex(0);
                // Note: Not setting sprite here because useEffect below will handle emotion->sprite mapping if needed,
                // or we rely on default.
            }
        }
    }, []); // Run once on mount

    // Sprite & Config Sync (If user goes to settings and comes back, this helps)
    useEffect(() => {
        if (char.spriteConfig) setSpriteConfig(char.spriteConfig);
        if (char.dateBackground || !initialState?.bgImage) setBgImage(char.dateBackground || '');
        if (currentSpriteKey) {
            const resolved = resolveSpriteByKey(currentSpriteKey);
            if (resolved.src) setCurrentSprite(resolved.src);
        }
    }, [char, currentSpriteKey]);

    // Novel Mode Scroll
    useEffect(() => {
        if (isNovelMode && novelScrollRef.current) {
            const el = novelScrollRef.current;
            if (scrollToNovelHistoryTopRef.current) {
                // 新内容是插在当前窗口之前；回到顶部让用户立刻看到刚加载的
                // 最早一批，并可连续点击按钮继续向前翻，不会被送回文末。
                scrollToNovelHistoryTopRef.current = false;
                el.scrollTop = 0;
            } else {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [visibleSessionMessages.length, isNovelMode, showInputBox]);

    // Typewriter effect
    useEffect(() => {
        if (!currentText || isNovelMode) {
            if (isNovelMode) setDisplayedText(currentText);
            return;
        }
        setIsTextAnimating(true);
        setDisplayedText('');
        let i = 0;
        const timer = setInterval(() => {
            setDisplayedText(currentText.substring(0, i + 1));
            i++;
            if (i >= currentText.length) {
                clearInterval(timer);
                setIsTextAnimating(false);
            }
        }, 20);
        return () => clearInterval(timer);
    }, [currentText, isNovelMode]);

    // --- Logic ---

    const processNextDialogue = (item: DialogueItem, remaining: DialogueItem[], index: number) => {
        setCurrentText(item.text);
        currentLineEmotionRef.current = item.voiceEmotion;
        currentLineSpeechTextRef.current = item.speechText;
        setCurrentDialogueIndex(index);
        if (item.emotion && activeSprites) {
            const emotionKey = item.emotion.toLowerCase();
            if (dateEmotionKeys.includes(emotionKey)) {
                const nextSprite = activeSprites[emotionKey];
                if (nextSprite) {
                    setCurrentSprite(nextSprite);
                    setCurrentSpriteKey(emotionKey);
                }
            } else {
                const found = dateEmotionKeys.find(k => emotionKey.includes(k));
                if (found && activeSprites[found]) {
                    setCurrentSprite(activeSprites[found]);
                    setCurrentSpriteKey(found);
                }
            }
        }
        setDialogueQueue(remaining);
    };

    // 立绘引擎（dialogueQueue / currentText / dialogueBatch）默认只在进会话或收到新回复时解析一次。
    // 若用户在阅读模式里编辑 / 重新生成了「最后一条 AI 回复」，messages 会更新、阅读模式即时反映，
    // 但立绘引擎不会自动重解析 —— 于是立绘停在旧文字、旧语音，感觉「没同步」。这里监听最后一条
    // assistant 消息的内容，变了就把当前批次重解析同步过来。首帧跳过（含 initialState 恢复的播放
    // 位置），isTyping 时也跳过（新回复交给 handleSend / handleRerollClick 处理，避免重复解析）。
    const lastAssistantContent = React.useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]?.role === 'assistant' && !isDatePhoneBridge(messages[i])) return messages[i].content || '';
        }
        return '';
    }, [messages]);
    const dialogueSyncMountRef = useRef(false);
    useEffect(() => {
        if (!dialogueSyncMountRef.current) { dialogueSyncMountRef.current = true; return; }
        if (historyReplay) return;
        if (isTyping || !lastAssistantContent) return;
        const { rest } = extractObservation(lastAssistantContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
        const items = parseDateDialogueForPlayback(rest);
        if (items.length === 0) return;
        setDialogueBatch(items);
        processNextDialogue(items[0], items.slice(1), 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastAssistantContent]);

    // 回顾中允许编辑原消息。消息内容变化后，阅读模式会由 props 立即更新，
    // 立绘播放队列也同步重建，并尽量保留当前所在的条目位置。
    const replaySyncMountRef = useRef(false);
    useEffect(() => {
        if (!historyReplay) return;
        if (!replaySyncMountRef.current) { replaySyncMountRef.current = true; return; }
        const items = replayDialogueItems;
        const previousIndex = currentDialogueIndexRef.current;
        const nextIndex = items.length > 0 ? Math.min(Math.max(previousIndex, 0), items.length - 1) : -1;
        setDialogueBatch(items);
        setDialogueQueue(nextIndex >= 0 ? items.slice(nextIndex + 1) : []);
        setCurrentDialogueIndex(nextIndex);
        setCurrentText(nextIndex >= 0 ? items[nextIndex].text : '');
        setDisplayedText(nextIndex >= 0 ? items[nextIndex].text : '');
        currentLineEmotionRef.current = nextIndex >= 0 ? items[nextIndex].voiceEmotion : undefined;
        currentLineSpeechTextRef.current = nextIndex >= 0 ? items[nextIndex].speechText : undefined;
    }, [historyReplay, replayDialogueItems]);

    const handleScreenClick = (e: React.MouseEvent) => {
        if (voiceFavoriteLongPressTriggered.current) {
            voiceFavoriteLongPressTriggered.current = false;
            return;
        }
        if ((e.target as HTMLElement).closest('button, input, textarea, .control-panel')) return;
        // 菜单展开时，点击场景任意处先收起菜单，不推进对话
        if (showMenu) {
            setShowMenu(false);
            setShowVoiceLangPicker(false);
            return;
        }
        if (isNovelMode) return;

        // Skip animation
        if (isTextAnimating) {
            setDisplayedText(currentText);
            setIsTextAnimating(false);
            return;
        }

        // Next item
        if (dialogueQueue.length > 0) {
            processNextDialogue(dialogueQueue[0], dialogueQueue.slice(1), Math.max(0, currentDialogueIndex + 1));
            return;
        }
    };

    const handlePreviousDialogue = () => {
        if (isTextAnimating || currentDialogueIndex <= 0 || !dialogueBatch[currentDialogueIndex - 1]) return;
        const previousIndex = currentDialogueIndex - 1;
        processNextDialogue(
            dialogueBatch[previousIndex],
            dialogueBatch.slice(previousIndex + 1),
            previousIndex,
        );
    };

    /**
     * 阅读/回顾页统一从顶部加载更早内容。
     *
     * 回顾页的整次/整日记录已经完整读入，但为了避免 iOS WebKit 一次挂载过多
     * DOM，仍按窗口展示。点击顶部按钮时只扩大本地窗口；活动会话窗口用尽后，
     * 再让父层回库取下一批。加载后回到正文顶部，方便继续向前翻，不会突然弹回文末。
     */
    const loadEarlierNovelMessages = async () => {
        if (novelHistoryLoading) return;
        const plan = planNovelLoadMore({
            loadedCount: sessionMessages.length,
            visibleCount: novelVisibleCount,
            windowStep: NOVEL_MESSAGE_LOAD_STEP,
            loadLimit: historyLoadLimit,
            loadStep: NOVEL_HISTORY_FETCH_STEP,
            reachedDbEnd: historyReachedEnd,
        });
        if (plan.nextVisibleCount === novelVisibleCount && plan.nextLoadLimit === null) return;

        scrollToNovelHistoryTopRef.current = true;
        setNovelVisibleCount(plan.nextVisibleCount);

        if (plan.nextLoadLimit === null || !onLoadMoreHistory) return;
        setNovelHistoryLoading(true);
        try {
            await onLoadMoreHistory(plan.nextLoadLimit);
        } finally {
            setNovelHistoryLoading(false);
        }
    };

    const handleSend = async () => {
        if (historyReplay || isTyping) return;
        const inputText = input.trim();
        // 本地失败输入优先，DB 时间线兜底。这样即使父组件刷新尚未落到这一帧，重试键也不会失效。
        const retryText = pendingRetryText || getPendingReplyText(messages);
        if (!inputText && !retryText) return;
        const text = inputText || retryText;
        if (inputText) {
            setInput('');
            setShowInputBox(false);
        }
        setIsTyping(true);
        setIsShowingOpening(false); // First user interaction - opening phase is over

        try {
            const aiContent = await onSendMessage(text);
            // 先剥出观测块更新 HUD，再解析剩余正文
            const { observation: obs, rest } = extractObservation(aiContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(obs)) setObservation(obs);
            const items = parseDateDialogueForPlayback(rest);
            setDialogueBatch(items);
            setDialogueQueue(items.slice(1));
            if (items.length > 0) {
                processNextDialogue(items[0], items.slice(1), 0);
            }
            setPendingRetryText('');
        } catch (e: any) {
            // onSendMessage 内部含 API 调用 + 回复后处理, 抛错不一定是网络。用中性文案, 不误导成"连接中断"。
            setPendingRetryText(text);
            setCurrentText(`(出错了: ${e?.message || '未知错误'})`);
            setShowInputBox(true);
        } finally {
            setIsTyping(false);
        }
    };

    const handleRerollClick = async () => {
        if (historyReplay || isTyping) return;
        setIsTyping(true);
        try {
            const aiContent = await onReroll();
            const { observation: obs, rest } = extractObservation(aiContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(obs)) setObservation(obs);
            const items = parseDateDialogueForPlayback(rest);
            setDialogueBatch(items);
            setDialogueQueue(items.slice(1));
            if (items.length > 0) processNextDialogue(items[0], items.slice(1), 0);
        } catch(e: any) {
            // 父级 handleReroll 只抛不提示；这里不给反馈的话，点了「重新生成」
            // 没动静用户会以为没点上（旧版更糟：消息已被删还毫无提示）
            addToast(`重新生成失败: ${e?.message || '未知错误'}`, 'error');
        } finally {
            setIsTyping(false);
        }
    };

    const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
        }
    };

    const handleInterludeSubmit = async (catchUpToNow = false) => {
        if (historyReplay || isTyping || !onInterlude) return;
        const targetAt = catchUpToNow ? realNow : undefined;
        setShowInterludeEditor(false);
        setIsTyping(true);
        setIsShowingOpening(false);
        try {
            const aiContent = await onInterlude(interludeDescription.trim(), targetAt);
            const { observation: obs, rest } = extractObservation(aiContent, { lenient: observeEnabled, custom: char.dateObserve?.custom });
            if (hasObservation(obs)) setObservation(obs);
            const items = parseDateDialogueForPlayback(rest);
            setDialogueBatch(items);
            setDialogueQueue(items.slice(1));
            if (items.length > 0) processNextDialogue(items[0], items.slice(1), 0);
            setInterludeDescription('');
        } catch (error: any) {
            addToast(`过场生成失败: ${error?.message || '未知错误'}`, 'error');
        } finally {
            setIsTyping(false);
        }
    };

    const openClockEditor = () => {
        if (!Number.isFinite(effectiveSceneClockAt)) return;
        setClockInput(DatePrompts.formatSceneClockInputValue(effectiveSceneClockAt as number, effectiveSceneClockTimeZone));
        setShowClockEditor(true);
        setShowMenu(false);
    };

    const handleClockSave = async () => {
        if (!onSetSceneClock || !clockInput.trim()) return;
        const timestamp = DatePrompts.parseSceneClockInput(clockInput, effectiveSceneClockTimeZone);
        if (timestamp === null) {
            addToast('时间格式或日期无效，请检查后再保存', 'error');
            return;
        }
        setClockBusy(true);
        try {
            await onSetSceneClock(timestamp);
            setShowClockEditor(false);
        } catch (error: any) {
            addToast(error?.message || '剧情时间保存失败', 'error');
        } finally {
            setClockBusy(false);
        }
    };

    const buildCurrentState = (): DateState => ({
        encounterId: encounterId ?? initialState?.encounterId,
        encounterStartedAt: encounterStartedAt ?? initialState?.encounterStartedAt,
        sceneClockAt: effectiveSceneClockAt,
        sceneClockAdvancedMs: effectiveSceneClockAdvancedMs,
        sceneClockRevision: effectiveSceneClockRevision,
        sceneClockUpdatedAt: sceneClockUpdatedAt ?? initialState?.sceneClockUpdatedAt,
        sceneClockTimeZone: effectiveSceneClockTimeZone,
        dialogueQueue,
        dialogueBatch,
        dialogueIndex: currentDialogueIndex,
        currentText,
        // Keep recovery snapshots light: don't duplicate base64 background/sprite data here.
        // TODO(date-assets): migrate CharacterProfile dateBackground/sprites/dateSkinSets themselves
        // into the IndexedDB assets store and keep stable asset refs on the character.
        currentSpriteKey: currentSpriteKey || inferSpriteKey(currentSprite) || undefined,
        activeSkinSetId: char.activeSkinSetId,
        isNovelMode,
        timestamp: Date.now(),
        peekStatus,
        observation: observation || undefined,
    });

    const handleExitClick = () => {
        onExit(buildCurrentState());
    };

    const handleEndClick = async () => {
        if (endingEncounter) return;
        setEndingEncounter(true);
        try {
            await onEnd(buildCurrentState());
        } finally {
            setEndingEncounter(false);
        }
    };

    // Auto-save: persist date state so refresh/close doesn't lose progress
    const stateRef = useRef<() => DateState>(buildCurrentState);
    stateRef.current = buildCurrentState;
    const charRef = useRef(char);
    charRef.current = char;

    useEffect(() => {
        if (historyReplay) {
            // 回顾不会创建或覆盖未结束见面的恢复快照。
            return () => { clearDateResumeAttempt(); };
        }
        // Direct DB save — works during beforeunload when React state updates are useless
        const saveStateToDB = () => {
            try {
                const state = stateRef.current();
                DB.saveCharacter({ ...charRef.current, savedDateState: state });
            } catch (e) { /* best-effort */ }
        };

        // beforeunload: catch page refresh / tab close
        const handleBeforeUnload = () => { saveStateToDB(); };
        // visibilitychange: catch tab switch / app background (more reliable on mobile)
        const handleVisibilityChange = () => { if (document.visibilityState === 'hidden') saveStateToDB(); };
        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Periodic auto-save every 30s
        const interval = setInterval(saveStateToDB, 30000);

        // 见面「继续上次」崩溃自愈：只要会话稳定挂载并渲染了一小段时间没崩，
        // 就撤销 DateApp 在恢复前武装的哨兵——证明这份快照能安全加载。若 iOS WebKit
        // 在此之前把内容进程撑崩（进程级崩溃，不会跑下面的卸载 cleanup），哨兵留存，
        // 下次进见面即被检出并丢弃这份有毒快照。新会话（无 initialState）无哨兵，clear 为空操作。
        const settleTimer = setTimeout(() => clearDateResumeAttempt(), 2500);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(interval);
            clearTimeout(settleTimer);
            // 干净卸载（SPA 内导航离开会话）= 非崩溃，撤销哨兵。
            clearDateResumeAttempt();
            // 卸载时只把进度直接落库，绝不调用 onExit。onExit 会执行「用户主动退出」的
            // 导航（setMode('select') + 弹「进度已保存」），而卸载在很多非用户意图的场景
            // 都会发生 —— 尤其 React.StrictMode (dev) 的「挂载→卸载→重挂载」探测：
            // 一进正式见面就被自己的卸载副作用导航回选择页，并弹两次「进度已保存」。
            // 直接 DB 持久化与其它自动保存路径（beforeunload / visibilitychange / 定时）一致。
            saveStateToDB();
        };
    }, []);

    // Message Touch Logic (Robust version for scrollable lists)
    const handleMsgTouchStart = (e: React.TouchEvent | React.MouseEvent, msg: Message) => {
        if (!isNovelMode) return;
        // If already in batch select mode, don't start a new long press timer
        if (isBatchSelectMode) return;
        if ('touches' in e) {
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
            touchStartRef.current = { x: e.clientX, y: e.clientY };
        }

        longPressTimer.current = setTimeout(() => {
                setSelectedMessage(msg);
            setModalType('options');
        }, 600);
    };

    const handleMsgTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!longPressTimer.current || !touchStartRef.current) return;
        
        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const dx = Math.abs(clientX - touchStartRef.current.x);
        const dy = Math.abs(clientY - touchStartRef.current.y);

        // If moved more than 10px, assume scrolling and cancel long press
        if (dx > 10 || dy > 10) {
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleMsgTouchEnd = () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
    };

    const toggleSelectedMsg = (id: number) => {
        setSelectedMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const exitBatchMode = () => {
        setIsBatchSelectMode(false);
        setSelectedMsgIds(new Set());
    };

    /** 从任意模式进入可见的记录管理界面，避免用户只能猜长按手势。 */
    const startBatchDelete = () => {
        if (historyReplay) return;
        setIsNovelMode(true);
        setIsBatchSelectMode(true);
        setShowInputBox(false);
        setShowMenu(false);
        setShowVoiceLangPicker(false);
    };

    const handleBatchDelete = async () => {
        if (selectedMsgIds.size === 0) return;
        await onDeleteMessages(Array.from(selectedMsgIds));
        exitBatchMode();
    };

    // Determine if we can reroll (last message is assistant)
    const lastTimelineMessage = messages[messages.length - 1];
    const canReroll = !historyReplay
        && !!lastTimelineMessage
        && !isDatePhoneBridge(lastTimelineMessage)
        && lastTimelineMessage.role === 'assistant';
    const hasReadingTheme = Boolean(char.dateReadingCustomCss?.trim());

    return (
        <div className="h-full w-full relative bg-black overflow-hidden font-sans select-none" onClick={handleScreenClick}>
            
            {/* Background Layer */}
            <div 
                className={`absolute inset-0 bg-cover bg-center transition-all duration-1000 ${isNovelMode ? 'blur-xl opacity-30' : 'opacity-80'}`} 
                style={{ backgroundImage: bgImage ? `url(${bgImage})` : 'none' }}
            ></div>

            {/* Menu Layer — 常驻只留「输入」+「菜单」两钮，其余操作收进带文字标签的下拉菜单 */}
            <div className={`absolute top-0 right-0 p-4 pt-12 z-[100] flex flex-col items-end gap-2 pointer-events-auto ${isNovelMode ? 'hidden' : ''}`}>
                <div className="flex gap-3">
                    {!historyReplay && <button onClick={(e) => { e.stopPropagation(); setShowInputBox(!showInputBox); setShowMenu(false); setShowVoiceLangPicker(false); }} className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-lg active:scale-95 ${showInputBox ? 'bg-primary border-primary text-white' : 'bg-black/30 backdrop-blur-md border-white/20 text-white hover:bg-white/20'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                    </button>}
                    <button onClick={(e) => { e.stopPropagation(); setShowMenu(prev => !prev); setShowVoiceLangPicker(false); }} className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-lg active:scale-95 ${showMenu ? 'bg-white text-black border-white' : 'bg-black/30 backdrop-blur-md border-white/20 text-white hover:bg-white/20'}`}>
                        {showMenu ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
                        )}
                    </button>
                </div>

                {showMenu && (
                    <div className="flex flex-col items-end gap-1.5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                        {!isTyping && canReroll && (
                            <button onClick={() => { setShowMenu(false); setShowVoiceLangPicker(false); handleRerollClick(); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                重新生成
                            </button>
                        )}

                        {!historyReplay && onInterlude && <button onClick={() => { setShowInterludeEditor(true); setShowMenu(false); setShowVoiceLangPicker(false); }} disabled={isTyping} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-indigo-500/70 backdrop-blur-md border-indigo-200/30 text-white hover:bg-indigo-500 disabled:opacity-40">
                            <span aria-hidden="true">⏭</span>
                            过场
                        </button>}

                        {!historyReplay && onSetSceneClock && <button onClick={openClockEditor} disabled={isTyping} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20 disabled:opacity-40">
                            <span aria-hidden="true">◷</span>
                            编辑剧情时间
                        </button>}

                        {/* 语音：未开启时点击直接开启并展开语种；开启时点击展开/收起语种选择（含关闭项） */}
                        <button onClick={() => {
                                if (voiceEnabled) {
                                    setShowVoiceLangPicker(prev => !prev);
                                } else {
                                    updateCharacter(char.id, { dateVoiceEnabled: true });
                                    addToast('语音已开启', 'info');
                                    setShowVoiceLangPicker(true);
                                }
                            }}
                            className={`h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all backdrop-blur-md ${voiceEnabled ? 'bg-white/20 border-white/30 text-white' : 'bg-black/40 border-white/15 text-white/60 hover:bg-white/20'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                {voiceEnabled
                                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                                    : <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />}
                            </svg>
                            语音{voiceEnabled ? ((voiceLang && (VOICE_LANG_OPTIONS.find(o => o.v === voiceLang)?.l)) ? ` · ${VOICE_LANG_OPTIONS.find(o => o.v === voiceLang)?.l}` : ' · 开') : ' · 关'}
                        </button>
                        {voiceEnabled && showVoiceLangPicker && (
                            <div className="flex flex-wrap justify-end gap-1 max-w-[200px] animate-fade-in">
                                {VOICE_LANG_OPTIONS.map(opt => (
                                    <button key={opt.v} onClick={() => { updateCharacter(char.id, { dateVoiceLang: opt.v }); setShowVoiceLangPicker(false); }}
                                        className={`h-7 px-2.5 rounded-full text-[10px] font-bold transition-all active:scale-95 whitespace-nowrap ${voiceLang === opt.v ? 'bg-white/30 text-white shadow-md' : 'bg-black/30 backdrop-blur-md text-white/60 border border-white/10'}`}>
                                        {opt.l}
                                    </button>
                                ))}
                                <button onClick={() => { updateCharacter(char.id, { dateVoiceEnabled: false }); setShowVoiceLangPicker(false); addToast('语音已关闭', 'info'); }}
                                    className="h-7 px-2.5 rounded-full text-[10px] font-bold transition-all active:scale-95 whitespace-nowrap bg-red-500/50 text-white border border-red-300/40 shadow-md">
                                    关闭语音
                                </button>
                            </div>
                        )}

                        <button onClick={() => { setIsNovelMode(!isNovelMode); exitBatchMode(); setShowMenu(false); setShowVoiceLangPicker(false); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20">
                            {isNovelMode ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                            )}
                            {isNovelMode ? '立绘模式' : '阅读模式'}
                        </button>

                        {messages.length > 0 && !isBatchSelectMode && !historyReplay && (
                            <button onClick={startBatchDelete} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-red-500/70 backdrop-blur-md border-white/20 text-white hover:bg-red-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                                删除记录
                            </button>
                        )}

                        {/* 观测协议 OBSERVE 开关：开启后回复带「时间/地点/状态/细节」全息 HUD */}
                        {!historyReplay && <button onClick={() => {
                                const next = !observeEnabled;
                                updateCharacter(char.id, { dateObserve: { ...char.dateObserve, enabled: next } });
                                addToast(next ? '观测已开启 · 下条回复生效' : '观测已关闭', 'info');
                                setShowMenu(false); setShowVoiceLangPicker(false);
                            }}
                            className={`h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all backdrop-blur-md ${observeEnabled ? 'bg-cyan-400/20 border-cyan-300/40 text-cyan-50' : 'bg-black/40 border-white/15 text-white/60 hover:bg-white/20'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            观测{observeEnabled ? ' · 开' : ' · 关'}
                        </button>}

                        {!historyReplay && <button onClick={() => { setShowSettings(true); setShowMenu(false); setShowVoiceLangPicker(false); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-black/40 backdrop-blur-md border-white/15 text-white hover:bg-white/20">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 2.555c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.212 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-2.555c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            布置场景
                        </button>}

                        <button onClick={() => { setShowMenu(false); setShowVoiceLangPicker(false); setShowExitModal(true); }} className="h-9 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold border shadow-lg active:scale-95 transition-all bg-red-500/70 backdrop-blur-md border-white/20 text-white hover:bg-red-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" /></svg>
                            {historyReplay ? '退出回顾' : '离开'}
                        </button>
                    </div>
                )}
            </div>

            {/* 观测协议 OBSERVE — 立绘模式悬浮 HUD（左上角，独立查看可放大） */}
            {observeEnabled && !isNovelMode && hasObservation(observation) && (
                <div className="absolute top-0 left-0 p-4 pt-12 z-[90] pointer-events-none">
                    <div className="pointer-events-auto">
                        <ObserveHUD observation={observation!} variant="hud" charName={char.name} config={char.dateObserve} />
                    </div>
                </div>
            )}

            {/* Novel Mode View */}
            {isNovelMode && (
                <div id="this-moment-screen" className={`tm-screen absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden no-scrollbar mask-image-gradient overscroll-contain ${hasReadingTheme ? '' : 'text-white'}`} style={{ ['--sully-date-font-size' as string]: `${dateFontSize}px` }} onClick={(e) => { e.stopPropagation(); if (showMenu) { setShowMenu(false); setShowVoiceLangPicker(false); return; } if (historyReplay) return; if (!(e.target as HTMLElement).closest('button, input, textarea, .tm-header, .tm-compose')) setShowInputBox(true); }}>
                    {char.dateReadingCustomCss && <style>{char.dateReadingCustomCss.replace(/<\/style/gi, '<\\/style')}</style>}
                    {/*
                     * 用户主题 CSS 只负责视觉表现。阅读页的滚动和触控层必须由宿主保底，
                     * 否则一个 `min-height: 100%` 或伪元素就会把正文撑出视口、盖住顶栏。
                     */}
                    <style>{`
                        #this-moment-screen {
                            display: flex !important;
                            flex-direction: column !important;
                            min-height: 0 !important;
                            isolation: isolate;
                        }
                        #this-moment-screen > .tm-bg-image,
                        #this-moment-screen > .tm-bg-overlay {
                            z-index: 0 !important;
                            pointer-events: none !important;
                        }
                        #this-moment-screen > .tm-header {
                            position: relative !important;
                            z-index: 120 !important;
                            flex: 0 0 auto !important;
                            pointer-events: auto !important;
                        }
                        #this-moment-screen .tm-header-actions,
                        #this-moment-screen .tm-header-actions button,
                        #this-moment-screen .tm-reading-menu,
                        #this-moment-screen .tm-reading-menu button {
                            pointer-events: auto !important;
                            touch-action: manipulation;
                        }
                        #this-moment-screen > .tm-story {
                            position: relative !important;
                            z-index: 10 !important;
                            flex: 1 1 auto !important;
                            min-height: 0 !important;
                            height: auto !important;
                            scroll-padding-bottom: max(8rem, calc(env(safe-area-inset-bottom, 0px) + 8rem));
                        }
                        #this-moment-screen > .tm-compose-layer {
                            z-index: 130 !important;
                            pointer-events: none !important;
                        }
                        #this-moment-screen > .tm-compose-layer .tm-compose,
                        #this-moment-screen > .tm-compose-layer button,
                        #this-moment-screen > .tm-compose-layer textarea {
                            pointer-events: auto !important;
                            touch-action: manipulation;
                        }
                        /* 阅读主题的稳定字号接口。颜色、阴影、背景和台词装饰全部交给用户 CSS；
                           有主题时宿主不再用白色覆盖主题自己的文字颜色。 */
                        #this-moment-screen .tm-para-block {
                            font-size: var(--sully-date-font-size) !important;
                        }
                        /* 面对面时的手机消息是 Markdown 语义投影：不写死颜色，
                           让糯叽机兼容主题决定文字/背景；只清掉浏览器 blockquote 默认外距。 */
                        #this-moment-screen .tm-phone-bridge,
                        #this-moment-screen .tm-para-phone,
                        #this-moment-screen .tm-phone-meta,
                        #this-moment-screen .tm-phone-body {
                            color: inherit;
                        }
                        /* 手机消息是阅读页里的轻量 Markdown 投影，不复用角色段落的
                           立绘/照片伪元素；正文与主题已有的 tm-body / tm-quote-block
                           合同保持一致，主题仍可完全接管布局、字体和颜色。 */
                        #this-moment-screen .tm-para-phone {
                            width: 100%;
                            max-width: 100%;
                            padding: 0.35rem 0;
                        }
                        #this-moment-screen .tm-phone-meta {
                            margin: 0 0 0.35rem;
                            font-size: 0.82em;
                            line-height: 1.4;
                        }
                        #this-moment-screen .tm-phone-quote {
                            margin: 0;
                            color: inherit;
                        }
                        #this-moment-screen .tm-batch-selected {
                            outline: 2px solid rgba(244, 63, 94, 0.95) !important;
                            outline-offset: -2px;
                            background: rgba(244, 63, 94, 0.16) !important;
                        }
                        #this-moment-screen .tm-batch-unselected {
                            outline: 1px solid rgba(148, 163, 184, 0.42) !important;
                            outline-offset: -1px;
                            opacity: 0.82;
                        }
                    `}</style>
                    <div className="tm-bg-image absolute inset-0 bg-cover bg-center" style={{ backgroundImage: bgImage ? `url(${bgImage})` : 'none' }} aria-hidden="true" />
                    <div className="tm-bg-overlay absolute inset-0 pointer-events-none" aria-hidden="true" />

                    <header className="tm-header relative z-30 flex min-h-14 shrink-0 flex-col px-4 py-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                        <div className="tm-header-main flex min-h-10 items-center gap-3">
                            <ReadingAvatar
                                src={char.avatar}
                                name={char.name}
                                light={!!char.dateLightReading}
                                className="tm-header-avatar"
                                imageClassName="tm-header-avatar-img"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="tm-header-name truncate text-sm font-semibold">{char.name}</div>
                                <div className="tm-top-vs text-[10px] opacity-70">
                                    {historyReplay
                                        ? `见面回顾 · ${formatHeaderClock(effectiveSceneClockAt) || '剧情时间'}`
                                        : `此时此刻 · ${formatHeaderClock(effectiveSceneClockAt) || '剧情时间'}${dateTimeAwarenessEnabled ? ` · 现实 ${formatHeaderClock(realNow)}` : ''}`}
                                </div>
                            </div>
                            <div className="tm-header-actions flex items-center gap-1">
                                {!historyReplay && <button type="button" className="tm-btn-icon h-9 w-9 rounded-full" aria-label="打开输入框" onClick={() => setShowInputBox(value => !value)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mx-auto h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                                </button>}
                                <button type="button" className="tm-btn-icon h-9 w-9 rounded-full" aria-label="切换立绘模式" onClick={() => { setIsNovelMode(false); exitBatchMode(); setShowMenu(false); setShowVoiceLangPicker(false); }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="mx-auto h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 1 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                                </button>
                                <button type="button" className="tm-btn-icon h-9 w-9 rounded-full" aria-label="打开见面菜单" onClick={() => { setShowMenu(value => !value); setShowVoiceLangPicker(false); }}>
                                    {showMenu ? '×' : '⋯'}
                                </button>
                            </div>
                        </div>
                        {showMenu && (
                            <div className="tm-reading-menu mt-2 flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                {!historyReplay && !isTyping && canReroll && <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" onClick={() => { setShowMenu(false); void handleRerollClick(); }}>重新生成</button>}
                                {!historyReplay && onInterlude && <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" disabled={isTyping} onClick={() => { setShowInterludeEditor(true); setShowMenu(false); }}>⏭ 过场</button>}
                                {!historyReplay && onSetSceneClock && <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" disabled={isTyping} onClick={openClockEditor}>◷ 编辑剧情时间</button>}
                                {!historyReplay && <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" onClick={() => { setShowSettings(true); setShowMenu(false); }}>布置场景</button>}
                                <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" onClick={() => { setShowExitModal(true); setShowMenu(false); }}>{historyReplay ? '退出回顾' : '离开 / 结束'}</button>
                                {!historyReplay && <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" onClick={() => { const next = !observeEnabled; updateCharacter(char.id, { dateObserve: { ...char.dateObserve, enabled: next } }); setShowMenu(false); addToast(next ? '观测已开启 · 下条回复生效' : '观测已关闭', 'info'); }}>观测{observeEnabled ? ' · 开' : ' · 关'}</button>}
                                <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" onClick={() => { updateCharacter(char.id, { dateVoiceEnabled: !voiceEnabled }); setShowMenu(false); setShowVoiceLangPicker(false); addToast(voiceEnabled ? '语音已关闭' : '语音已开启', 'info'); }}>语音{voiceEnabled ? ' · 开' : ' · 关'}</button>
                                {messages.length > 0 && !isBatchSelectMode && !historyReplay && <button type="button" className="tm-btn-icon rounded-full px-3 py-1.5 text-xs" onClick={startBatchDelete}>删除记录</button>}
                            </div>
                        )}
                    </header>

                    <div ref={novelScrollRef} className="tm-story min-h-0 flex-1 overflow-y-auto overflow-x-clip" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8rem)' }}>
                        <div className="tm-story-inner mx-auto w-full min-h-full animate-fade-in">
                            {isBatchSelectMode && (
                                <div className="tm-batch-toolbar sticky top-0 z-20 flex items-center justify-between rounded-xl px-3 py-2 text-xs">
                                    <span>已选 {selectedMsgIds.size} 条 · 点击记录选择</span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); exitBatchMode(); }}
                                            className="px-3 py-1 rounded-full bg-stone-200 text-stone-600"
                                        >完成</button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleBatchDelete(); }}
                                            disabled={selectedMsgIds.size === 0}
                                            className="px-3 py-1 rounded-full bg-red-500 text-white disabled:opacity-40"
                                        >删除</button>
                                    </div>
                                </div>
                            )}
                            {sessionMessages.length === 0 && peekStatus && (() => {
                                const { observation: peekObs, rest: peekBody } = extractObservation(peekStatus, { lenient: observeEnabled, custom: char.dateObserve?.custom });
                                return (
                                    <article className="tm-para tm-para-char">
                                        <div className="tc-header">
                                            <div className="tc-header-deco-top" aria-hidden="true" />
                                            <div className="tc-header-main">
                                                <div className="tc-meta-area"><div className="tc-meta-title">{char.name}</div></div>
                                                <div className="tc-avatar-area"><ReadingAvatar src={char.avatar} name={char.name} light={!!char.dateLightReading} className="tc-avatar-frame" imageClassName="tc-avatar-img" /></div>
                                            </div>
                                            <div className="tc-header-deco-bottom" aria-hidden="true" />
                                        </div>
                                        <div className="tm-body tm-body-char">
                                            {observeEnabled && hasObservation(peekObs) && <ObserveHUD observation={peekObs} variant="card" charName={char.name} config={char.dateObserve} />}
                            {(cleanTextForDisplay(peekBody) || '（见面已经开始）').split('\n').map((line, idx) => line.trim() && <p key={idx} style={{ fontSize: `${dateFontSize}px` }} className={`tm-para-block whitespace-pre-wrap ${isDialogueLine(line) ? 'tm-dialogue tm-quote-block' : 'tm-narration'}`}>{line}</p>)}
                                        </div>
                                    </article>
                                );
                            })()}
                            {(hiddenNovelMessageCount > 0 || !historyReachedEnd) && (
                                <div className="tm-history-load-more sticky top-0 z-20 flex justify-center px-3 py-2 pointer-events-none">
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); void loadEarlierNovelMessages(); }}
                                        disabled={novelHistoryLoading}
                                        aria-label="加载更早的见面记录"
                                        className={`pointer-events-auto px-4 py-2 rounded-full text-xs font-bold border shadow-sm active:scale-95 transition-transform disabled:opacity-60 ${
                                            char.dateLightReading
                                                ? 'bg-stone-100 text-stone-500 border-stone-200'
                                                : 'bg-black/30 text-white/80 border-white/20 backdrop-blur-md'
                                        }`}
                                    >
                                        {novelHistoryLoading ? '正在加载…' : `加载更早见面记录${hiddenNovelMessageCount > 0 ? ` (${hiddenNovelMessageCount})` : ''}`}
                                    </button>
                                </div>
                            )}
                            {visibleSessionMessages.map((msg) => (
                                <article
                                    key={msg.id}
                                    className={`tm-para ${isDatePhoneBridge(msg) ? 'tm-para-phone' : (msg.role === 'user' ? 'tm-para-user' : 'tm-para-char')} group relative ${isBatchSelectMode ? (selectedMsgIds.has(msg.id) ? 'tm-batch-selected pl-10' : 'tm-batch-unselected pl-10') : ''}`}
                                    aria-pressed={isBatchSelectMode ? selectedMsgIds.has(msg.id) : undefined}
                                    onClick={(e) => {
                                        if (!isBatchSelectMode) return;
                                        e.stopPropagation();
                                        toggleSelectedMsg(msg.id);
                                    }}
                                    onTouchStart={(e) => handleMsgTouchStart(e, msg)}
                                    onTouchEnd={handleMsgTouchEnd}
                                    onTouchMove={handleMsgTouchMove}
                                    onMouseDown={(e) => handleMsgTouchStart(e, msg)}
                                    onMouseUp={handleMsgTouchEnd}
                                    onMouseMove={handleMsgTouchMove}
                                    onMouseLeave={handleMsgTouchEnd}
                                    onContextMenu={(e) => { e.preventDefault(); if (!isBatchSelectMode) { setSelectedMessage(msg); setModalType('options'); } }}
                                >
                                    {isBatchSelectMode && (
                                        <div
                                            role="checkbox"
                                            aria-checked={selectedMsgIds.has(msg.id)}
                                            aria-label={selectedMsgIds.has(msg.id) ? '取消选择这条记录' : '选择这条记录'}
                                            className={`absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-sm transition-all ${selectedMsgIds.has(msg.id) ? 'bg-rose-500 border-rose-500 text-white scale-105' : 'bg-white/90 border-slate-400 text-transparent'}`}
                                        >
                                            {selectedMsgIds.has(msg.id) && <span className="text-white text-[10px]">✓</span>}
                                        </div>
                                    )}
                                    {isDatePhoneBridge(msg) ? (() => {
                                        const speaker = getDatePhoneSpeaker(msg, char, userProfile.name);
                                        const markdown = typeof msg.metadata?.datePhoneMarkdown === 'string'
                                            ? msg.metadata.datePhoneMarkdown
                                            : formatDatePhoneMarkdown(msg, speaker);
                                        return (
                                            <>
                                                <div className={`tm-body tm-phone-body ${msg.role === 'user' ? 'tm-body-user' : 'tm-body-char'}`} data-markdown={markdown}>
                                                    <div className="tm-phone-meta tm-para-block" aria-label={`${speaker} 手机消息`}>
                                                        <strong className="tm-phone-speaker">{speaker}</strong>
                                                        <span className="tm-phone-channel"> · 手机消息</span>
                                                    </div>
                                                    {String(msg.content || '').split('\n').map((line, index) => {
                                                        const displayLine = stripFaceToFacePhoneSourceTags(stripMessageReactionTags(line)).trim();
                                                        return (
                                                            <blockquote
                                                                key={`${msg.id}-phone-${index}`}
                                                                style={{ fontSize: `${dateFontSize}px` }}
                                                                className="tm-para-block tm-quote-block tm-phone-quote whitespace-pre-wrap"
                                                            >{displayLine || '\u00a0'}</blockquote>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        );
                                    })() : msg.role === 'user' ? (
                                        <>
                                            <div className="tc-header-user">
                                                <ReadingAvatar
                                                    src={userProfile.perCharAvatars?.[char.id] || userProfile.avatar}
                                                    name={userProfile.name}
                                                    light={!!char.dateLightReading}
                                                    className="tc-avatar-frame-user"
                                                    imageClassName="tc-avatar-img"
                                                />
                                                <span className="tc-avatar-badge-user">{userProfile.name}</span>
                                            </div>
                                            <div className="tm-body tm-body-user">
                                                <p style={{ fontSize: `${dateFontSize}px` }} className="tm-para-block tm-narration whitespace-pre-wrap">{cleanTextForDisplay(msg.content)}</p>
                                            </div>
                                        </>
                                    ) : (() => {
                                        // 观测协议：从这条回复里剥出观测块，正文上方渲染独立卡片，正文本身不显示块文本
                                        const { observation: msgObs, rest: msgBody } = extractObservation(msg.content || '', { lenient: observeEnabled, custom: char.dateObserve?.custom });
                                        const messageSceneClockAt = typeof msg.metadata?.sceneClockAt === 'number' && Number.isFinite(msg.metadata.sceneClockAt)
                                            ? msg.metadata.sceneClockAt
                                            : effectiveSceneClockAt;
                                         const parsedMessageItems = addFallbackDateInterjectionToReply(
                                             parseDialogue(msgBody || '', 'normal'),
                                             canUseDateMiniMaxInterjections,
                                         );
                                        let parsedMessageItemIndex = 0;
                                        return (
                                        <>
                                            <div className="tc-header">
                                                <div className="tc-header-deco-top" aria-hidden="true" />
                                                <div className="tc-header-main">
                                                    <div className="tc-meta-area">
                                                        <div className="tc-meta-title">{char.name}</div>
                                                        <div className="tc-meta-stats">{formatHeaderClock(messageSceneClockAt) || new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                                        <div className="tc-meta-subtitle">线下见面</div>
                                                        <div className="tc-meta-extra-1">此时此刻</div>
                                                        <div className="tc-meta-extra-2">{char.name}</div>
                                                        <div className="tc-divider" />
                                                    </div>
                                                    <div className="tc-avatar-area">
                                                        <ReadingAvatar src={char.avatar} name={char.name} light={!!char.dateLightReading} className="tc-avatar-frame" imageClassName="tc-avatar-img" />
                                                        <span className="tc-avatar-badge">现场</span>
                                                    </div>
                                                </div>
                                                <div className="tc-header-deco-bottom" aria-hidden="true" />
                                            </div>
                                            {typeof msg.metadata?.thinkingChain === 'string' && msg.metadata.thinkingChain.trim() && (
                                                <details className="tm-thinking-toggle">
                                                    <summary>思考过程</summary>
                                                    <div className="whitespace-pre-wrap">{msg.metadata.thinkingChain.trim()}</div>
                                                </details>
                                            )}
                                            <div className="tm-body tm-body-char">
                                                {observeEnabled && hasObservation(msgObs) && (
                                                    <ObserveHUD observation={msgObs} variant="card" charName={char.name} config={char.dateObserve} />
                                                )}
                                                {(msgBody || '').split('\n').map((line, idx) => {
                                                // 与立绘模式共用同一个解析器：正文显示用 text，
                                                // 播放/收藏用 speechText（其中保留 MiniMax 语气词）。
                                                const rawLineItem = parseDialogue(line, 'normal')[0];
                                                const lineItem = rawLineItem
                                                    ? (parsedMessageItems[parsedMessageItemIndex++] || rawLineItem)
                                                    : null;
                                                const cleanLine = lineItem?.text || '';
                                                if (!cleanLine) return null;
                                                const lineIsDialogue = !!lineItem?.speechText && isDialogueLine(cleanLine);
                                                const lineKey = `${msg.id}-${idx}`;
                                                const isOpeningMsg = msg.metadata?.isOpening === true;
                                                const dialogueText = extractDialogueText(lineItem.text);
                                                const speechText = lineItem.speechText || dialogueText;
                                                const voiceTarget: DateVoiceFavoriteTarget = {
                                                    sourceKey: `${char.id}:${lineKey}`,
                                                    originalText: dialogueText,
                                                    speechText,
                                                    sourceTimestamp: msg.timestamp,
                                                    voiceEmotion: lineItem.voiceEmotion,
                                                };
                                                return (
                                                    <div
                                                        key={idx}
                                                        className={`tm-line-wrap flex items-start gap-1 mb-4 last:mb-0 ${lineIsDialogue ? 'tm-dialogue-line' : 'tm-narration-line'}`}
                                                        onClick={(e) => {
                                                            if (!voiceFavoriteLongPressTriggered.current) return;
                                                            e.stopPropagation();
                                                            voiceFavoriteLongPressTriggered.current = false;
                                                        }}
                                                        onTouchStart={voiceEnabled && lineIsDialogue && !isOpeningMsg ? (e) => startDateVoiceLongPress(e, voiceTarget) : undefined}
                                                        onTouchMove={voiceEnabled && lineIsDialogue && !isOpeningMsg ? endDateVoiceLongPress : undefined}
                                                        onTouchEnd={voiceEnabled && lineIsDialogue && !isOpeningMsg ? endDateVoiceLongPress : undefined}
                                                        onMouseDown={voiceEnabled && lineIsDialogue && !isOpeningMsg ? (e) => e.stopPropagation() : undefined}
                                                        onContextMenu={voiceEnabled && lineIsDialogue && !isOpeningMsg ? (e) => { e.preventDefault(); e.stopPropagation(); void openDateVoiceFavorite(voiceTarget); } : undefined}
                                                    >
                                                        <p style={{ fontSize: `${dateFontSize}px` }} className={`tm-para-block flex-1 whitespace-pre-wrap ${lineIsDialogue ? 'tm-dialogue tm-quote-block' : 'tm-narration'}`}>{cleanLine}</p>
                                                        {/* Voice button: only for dialogue lines, not opening */}
                                                        {voiceEnabled && lineIsDialogue && !isOpeningMsg && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (voiceFavoriteLongPressTriggered.current) { voiceFavoriteLongPressTriggered.current = false; return; }
                                                                    handleNovelLinePlay(lineKey, dialogueText, speechText, lineItem.voiceEmotion);
                                                                }}
                                                                onTouchStart={(e) => startDateVoiceLongPress(e, voiceTarget)}
                                                                onTouchMove={endDateVoiceLongPress}
                                                                onTouchEnd={endDateVoiceLongPress}
                                                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); void openDateVoiceFavorite(voiceTarget); }}
                                                                title="播放；长按可收藏"
                                                                className={`shrink-0 mt-2 w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 select-none ${
                                                                    novelPlayingId === lineKey
                                                                        ? (char.dateLightReading ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-500/20 text-emerald-300')
                                                                        : (char.dateLightReading ? 'bg-stone-100 text-stone-400 hover:bg-stone-200' : 'bg-white/5 text-white/40 hover:bg-white/10')
                                                                }`}
                                                            >
                                                                {novelVoiceLoading.has(lineKey) ? (
                                                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                                                                ) : novelPlayingId === lineKey ? (
                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z" /></svg>
                                                                ) : (
                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" /></svg>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                                })}
                                            </div>
                                        </>
                                        ); })()}
                                </article>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Visual Mode View */}
            {!isNovelMode && (
                <>
                    <div className="absolute inset-x-0 bottom-0 h-[90%] flex items-end justify-center pointer-events-none z-10 overflow-hidden">
                        {currentSprite && <img src={currentSprite} className="max-h-full max-w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all duration-300 origin-bottom" style={{ filter: showInputBox ? 'brightness(1)' : (isTextAnimating ? 'brightness(1.05)' : 'brightness(1)'), transform: `translate(${spriteConfig.x}%, ${spriteConfig.y}%) scale(${isTextAnimating ? spriteConfig.scale * 1.02 : spriteConfig.scale})` }} />}
                    </div>
                    {!isTyping && (
                        <div className="absolute inset-x-0 bottom-8 z-30 flex justify-center">
                            <div
                                className="w-[90%] max-w-lg bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6 min-h-[140px] shadow-2xl animate-slide-up hover:bg-black/70 cursor-pointer"
                                onTouchStart={voiceEnabled && !isTextAnimating && !isShowingOpening && isDialogueLine(currentText) ? (e) => startDateVoiceLongPress(e, resolveCurrentDateVoiceTarget()) : undefined}
                                onTouchMove={voiceEnabled && !isTextAnimating && !isShowingOpening && isDialogueLine(currentText) ? endDateVoiceLongPress : undefined}
                                onTouchEnd={voiceEnabled && !isTextAnimating && !isShowingOpening && isDialogueLine(currentText) ? endDateVoiceLongPress : undefined}
                                onContextMenu={voiceEnabled && !isTextAnimating && !isShowingOpening && isDialogueLine(currentText) ? (e) => { e.preventDefault(); e.stopPropagation(); void openDateVoiceFavorite(resolveCurrentDateVoiceTarget()); } : undefined}
                            >
                                <div className="absolute -top-3 left-6 flex items-center gap-2">
                                    <div className="bg-white/90 text-black px-4 py-1 rounded-sm text-xs font-bold tracking-widest uppercase shadow-[0_4px_10px_rgba(0,0,0,0.3)] transform -skew-x-12">{char.name}</div>
                                    {/* Voice play button next to name */}
                                    {voiceEnabled && !isTextAnimating && !isShowingOpening && isDialogueLine(currentText) && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (voiceFavoriteLongPressTriggered.current) { voiceFavoriteLongPressTriggered.current = false; return; }
                                                handleGalVoiceToggle();
                                            }}
                                            onTouchStart={(e) => startDateVoiceLongPress(e, resolveCurrentDateVoiceTarget())}
                                            onTouchMove={endDateVoiceLongPress}
                                            onTouchEnd={endDateVoiceLongPress}
                                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); void openDateVoiceFavorite(resolveCurrentDateVoiceTarget()); }}
                                            title="播放；长按可收藏"
                                            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all active:scale-90 ${dateVoicePlaying ? 'bg-white/30 text-white/90' : 'bg-white/10 text-white/40 hover:bg-white/20'}`}
                                        >
                                            {galVoiceLoading ? (
                                                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                                            ) : dateVoicePlaying ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z" /></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" /></svg>
                                            )}
                                        </button>
                                    )}
                                </div>
                                <p style={{ fontSize: `${dateFontSize}px` }} className="text-white/90 leading-relaxed font-light drop-shadow-md mt-2">{displayedText}{isTextAnimating && <span className="inline-block w-2 h-4 bg-white/70 ml-1 animate-pulse align-middle"></span>}</p>
                                {!isTextAnimating && dialogueQueue.length > 0 && <div className="absolute bottom-3 right-4 animate-bounce opacity-70"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white"><path fillRule="evenodd" d="M12.53 16.28a.75.75 0 0 1-1.06 0l-7.5-7.5a.75.75 0 0 1 1.06-1.06L12 14.69l6.97-6.97a.75.75 0 1 1 1.06 1.06l-7.5 7.5Z" clipRule="evenodd" /></svg></div>}
                                {!isTextAnimating && currentDialogueIndex > 0 && <button type="button" onClick={(e) => { e.stopPropagation(); handlePreviousDialogue(); }} className="absolute bottom-2 left-3 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/60 transition-all active:scale-90" aria-label="上一条" title="上一条"><ArrowLeft size={14} weight="regular" /></button>}
                                {!isTextAnimating && dialogueQueue.length === 0 && dialogueBatch.length > 0 && <span className="absolute bottom-3 right-4 text-[10px] text-white/55">本轮已读完</span>}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Input Layer */}
            <div className={`tm-compose-layer absolute inset-x-0 bottom-0 z-40 flex justify-center pointer-events-none transition-all duration-300 ${isTyping || showInputBox ? 'opacity-100' : 'opacity-0'}`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                {isTyping && (
                    <div className="absolute bottom-1/2 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-auto">
                        <div className="bg-black/80 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 shadow-2xl animate-pulse flex items-center gap-3">
                             <div className="flex gap-1.5"><div className="w-2 h-2 bg-white rounded-full animate-bounce"></div><div className="w-2 h-2 bg-white rounded-full animate-bounce delay-75"></div><div className="w-2 h-2 bg-white rounded-full animate-bounce delay-150"></div></div>
                             <span className="text-xs text-white font-bold tracking-widest uppercase">Typing...</span>
                        </div>
                    </div>
                )}
                {showInputBox && !historyReplay && (
                    <div className={`tm-compose w-[90%] min-w-0 max-w-lg backdrop-blur-xl rounded-2xl p-2 shadow-2xl animate-fade-in mb-8 pointer-events-auto ${char.dateLightReading ? 'bg-stone-100 border border-stone-300' : 'bg-white/10 border border-white/20'}`} onClick={(e) => e.stopPropagation()}>
                        <div className="tm-compose-toolbar flex items-center justify-between gap-2">
                            <span className="tm-compose-status text-[10px] opacity-60">{isTyping ? '正在延续此刻…' : '此时此刻'}</span>
                            <button type="button" onClick={() => { setShowInputBox(false); void handleRerollClick(); }} disabled={!canReroll || isTyping} className="tm-regen-btn rounded-full px-2 py-1 text-[10px] disabled:opacity-30">重新生成</button>
                        </div>
                        <div className="tm-compose-row flex items-end gap-2">
                            <textarea
                                ref={textareaRef}
                                rows={1}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleComposerKeyDown}
                                placeholder={isTyping ? "等待回应..." : "输入对话..."}
                                disabled={isTyping}
                                className={`min-w-0 flex-1 tm-input bg-transparent px-3 sm:px-4 py-3 outline-none font-light resize-none max-h-36 no-scrollbar leading-tight ${char.dateLightReading ? 'text-stone-800 placeholder:text-stone-400' : 'text-white placeholder:text-white/30'}`}
                                style={{ minHeight: '3.5rem' }}
                                autoFocus
                            />
                            {isInputOverflowing && (
                                <button type="button" onClick={() => setIsFullscreenEditor(true)} className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${char.dateLightReading ? 'text-stone-500 hover:bg-stone-200' : 'text-white/70 hover:bg-white/10'}`} title="放大编辑" aria-label="放大编辑">
                                    <CornersOut className="w-5 h-5" weight="bold" />
                                </button>
                            )}
                            {(() => {
                                const retryText = pendingRetryText || getPendingReplyText(messages);
                                const canRetry = !input.trim() && !isTyping && !!retryText;
                                return (
                                    <button
                                        type="button"
                                        onClick={handleSend}
                                        disabled={(!input.trim() && !canRetry) || isTyping}
                                        className="shrink-0 px-4 sm:px-6 tm-send-btn tm-send bg-white text-black rounded-xl font-bold text-sm hover:bg-slate-200 disabled:opacity-50 transition-colors h-14 flex items-center justify-center"
                                    >
                                        {canRetry ? '重试' : '发送'}
                                    </button>
                                );
                            })()}
                        </div>
                    </div>
                )}
            </div>

            {isFullscreenEditor && !historyReplay && (
                <div
                    className={`fixed inset-0 z-[180] flex min-h-0 flex-col overflow-hidden ${char.dateLightReading ? 'bg-stone-50 text-stone-800' : 'bg-slate-950 text-white'}`}
                    style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="全屏编辑见面输入"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className={`flex shrink-0 items-center gap-3 border-b px-4 py-3 ${char.dateLightReading ? 'border-stone-200' : 'border-white/10'}`}>
                        <button type="button" onClick={() => setIsFullscreenEditor(false)} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${char.dateLightReading ? 'text-stone-500 hover:bg-stone-100' : 'text-white/70 hover:bg-white/10'}`} title="退出全屏编辑" aria-label="退出全屏编辑">
                            <CornersIn className="h-5 w-5" weight="bold" />
                        </button>
                        <div className="flex-1 text-center text-sm font-semibold">编辑此刻</div>
                        <button type="button" onClick={() => { setIsFullscreenEditor(false); void handleSend(); }} disabled={!input.trim() || isTyping} className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">发送</button>
                    </div>
                    <div className="min-h-0 flex-1 p-4">
                        <textarea
                            ref={fullscreenTextareaRef}
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            onKeyDown={handleComposerKeyDown}
                            autoFocus
                            spellCheck
                            className={`h-full w-full resize-none overflow-y-auto overscroll-contain rounded-2xl border p-4 text-[16px] leading-7 outline-none focus:ring-2 ${char.dateLightReading ? 'border-stone-200 bg-white text-stone-800 focus:ring-primary/20' : 'border-white/10 bg-white/[0.06] text-white focus:ring-primary/40'}`}
                            aria-label="全屏见面输入框"
                        />
                    </div>
                </div>
            )}

            <Modal
                isOpen={showInterludeEditor}
                title="插入一段过场"
                onClose={() => { if (!isTyping) setShowInterludeEditor(false); }}
                footer={
                    <div className="flex w-full gap-2">
                        {dateTimeAwarenessEnabled && (
                            <button type="button" onClick={() => void handleInterludeSubmit(true)} disabled={isTyping || !onInterlude || !Number.isFinite(effectiveSceneClockAt) || (Number.isFinite(effectiveSceneClockAt) && realNow <= (effectiveSceneClockAt as number))} className="flex-1 rounded-2xl bg-slate-100 py-3 text-xs font-bold text-slate-600 disabled:opacity-40">一次补到现在</button>
                        )}
                        <button type="button" onClick={() => void handleInterludeSubmit(false)} disabled={isTyping || !onInterlude} className="flex-1 rounded-2xl bg-indigo-500 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-200 disabled:opacity-40">{isTyping ? '生成中…' : '生成过场'}</button>
                    </div>
                }
            >
                <div className="space-y-3 py-1">
                    <p className="text-sm leading-relaxed text-slate-500">描述这段时间里发生了什么。它不会作为用户台词写入记录，生成后的过场正文会成为本次见面的现场记录。</p>
                    <textarea
                        value={interludeDescription}
                        onChange={(event) => setInterludeDescription(event.target.value)}
                        placeholder="例如：雨下大了，你们收拾东西换到街角的咖啡店，路上聊起了小时候的事。"
                        className="h-32 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 outline-none focus:ring-2 focus:ring-indigo-200"
                        autoFocus
                    />
                    <p className="text-[11px] leading-relaxed text-slate-400">可以不填，让角色根据上下文自然演出；一次见面可以插入任意多段过场。</p>
                </div>
            </Modal>

            <Modal
                isOpen={showClockEditor}
                title="编辑剧情时间"
                onClose={() => { if (!clockBusy) setShowClockEditor(false); }}
                footer={
                    <div className="flex w-full gap-3">
                        <button type="button" onClick={() => setShowClockEditor(false)} disabled={clockBusy} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-600 disabled:opacity-50">取消</button>
                        <button type="button" onClick={() => void handleClockSave()} disabled={clockBusy || !clockInput.trim()} className="flex-1 rounded-2xl bg-primary py-3 font-bold text-white shadow-lg shadow-indigo-200 disabled:opacity-50">{clockBusy ? '保存中…' : '保存时间'}</button>
                    </div>
                }
            >
                <div className="space-y-3 py-1">
                    <p className="text-sm leading-relaxed text-slate-500">这是剧情里的时间，不会因为现实中离开而自动流逝。允许手动往前或往回调整，调整会作为新的时钟检查点保存。</p>
                    <input
                        type="datetime-local"
                        step={60}
                        value={clockInput}
                        onChange={(event) => setClockInput(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <p className="text-[11px] text-slate-400">角色当地时间：{formatHeaderClock(effectiveSceneClockAt) || '未设置'}</p>
                </div>
            </Modal>

            {/* Settings Overlay */}
            {showSettings && (
                <div className="absolute inset-0 z-[200] animate-slide-up bg-white">
                    <DateSettings char={char} onBack={() => setShowSettings(false)} />
                </div>
            )}

            <VoiceFavoriteActionSheet
                open={!!voiceFavoriteTarget}
                favorited={voiceFavoriteSaved}
                busy={voiceFavoriteBusy}
                title="见面语音"
                preview={voiceFavoriteTarget?.originalText}
                onToggle={() => void toggleDateVoiceFavorite()}
                onClose={() => { if (!voiceFavoriteBusy) setVoiceFavoriteTarget(null); }}
            />

            {/* Exit Modal */}
            <Modal
                isOpen={showExitModal}
                title={historyReplay ? '退出见面回顾？' : '离开还是结束见面？'}
                onClose={() => setShowExitModal(false)}
                footer={historyReplay
                    ? <button onClick={handleExitClick} className="w-full py-3 bg-slate-800 text-white rounded-2xl font-bold">退出回顾</button>
                    : <div className="flex flex-col gap-2 w-full"><div className="flex gap-2"><button onClick={() => setShowExitModal(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">继续见面</button><button onClick={handleExitClick} className="flex-1 py-3 bg-slate-800 text-white rounded-2xl font-bold">暂存离开</button></div><button disabled={endingEncounter} onClick={handleEndClick} className="w-full py-3 bg-rose-500 disabled:opacity-50 text-white rounded-2xl font-bold">{endingEncounter ? '正在整理这次见面…' : '结束本次见面'}</button></div>}
            >
                <div className="text-center text-slate-500 text-sm py-2 leading-relaxed">
                    {historyReplay ? '这是已经完结的见面，只能浏览或编辑记录，不能继续回复。' : <>{endSuggestedReason && <><span className="mb-2 block text-rose-500">现场变化：{endSuggestedReason}</span></>}“暂存离开”会保留现场，下次继续同一段见面。<br/>“结束本次见面”会生成完结卡片，并回到线上聊天。</>}
                </div>
            </Modal>

            {/* Message Options Modal */}
            <Modal isOpen={modalType === 'options'} title="操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    {!historyReplay && <button onClick={() => {
                        if (selectedMessage) {
                            setIsBatchSelectMode(true);
                            setSelectedMsgIds(new Set([selectedMessage.id]));
                        }
                        setModalType('none');
                    }} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl">多选</button>}
                    <button onClick={() => {
                        if (selectedMessage) {
                            const clean = (selectedMessage.content || '').replace(/\[.*?\]/g, '').trim();
                            navigator.clipboard.writeText(clean).then(() => addToast('已复制', 'success')).catch(() => addToast('复制失败', 'error'));
                        }
                        setModalType('none');
                    }} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl">复制文本</button>
                    <button onClick={() => { onEditMessage(selectedMessage!); setModalType('none'); }} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl">编辑内容</button>
                    {!historyReplay && <button onClick={() => { onDeleteMessage(selectedMessage!); setModalType('none'); }} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl">删除记录</button>}
                </div>
            </Modal>
        </div>
    );
};

export default DateSession;
