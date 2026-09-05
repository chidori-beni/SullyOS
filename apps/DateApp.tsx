
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, Message, DateState, DateEncounterPresence, AppID } from '../types';
import { DatePrompts, ApiMessage, extractObservation } from '../utils/datePrompts';
import { processNewMessagesWithAutoArchive } from '../utils/memoryPalace/autoArchive';
import type { PipelineResult } from '../utils/memoryPalace/pipeline';
import { incrementDigestRound, runCognitiveDigestion } from '../utils/memoryPalace';
import { getRoomLabel } from '../utils/memoryPalace/types';
import { safeResponseJson, extractContent } from '../utils/safeApi';
import Modal from '../components/os/Modal';
import DateSession from '../components/date/DateSession';
import DateSettings from '../components/date/DateSettings';
import { armDateResumeAttempt, clearDateResumeAttempt, takeCrashedDateResume } from '../utils/dateSessionRecovery';
import { BookOpen, Sparkle, CaretLeft, GearSix, Trash } from '@phosphor-icons/react';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import { trimHistoryThrough } from '../utils/dateSessionHistory';
import { trackEvent } from '../utils/analytics';
import { markAmsgStateDirty } from '../utils/amsgStateSync';
import StoryTheater from '../components/date/story/StoryTheater';
import { dateLaunch, type DateLaunchIntent } from '../utils/dateLaunch';
import { chatDetailLaunch } from '../utils/chatDetailLaunch';
import { materializeVisionDescriptions } from '../utils/visionApi';
import { shareOrDownloadFile } from '../utils/shareExport';
import { clearActiveDatePresence, getActiveDatePresence, makeDateEncounterPresence, setActiveDatePresence } from '../utils/datePresence';
import { isDatePhoneBridge, mergeDatePhoneMessages } from '../utils/datePhoneBridge';
import { stripMessageReactionTags } from '../utils/messageReactions';
import { stripFaceToFacePhoneSourceTags } from '../utils/sanitize';
import { resolveCharTimeZone } from '../utils/timezone';
import { resolveDialogueSceneClock } from '../utils/dateObservationClock';
import {
    buildPendingDateBackgroundJob,
    cancelPendingDateBackgroundJobs,
    getPendingDateBackgroundJobForEncounter,
    removePendingDateBackgroundJob,
    savePendingDateBackgroundJob,
    schedulePendingDateBackgroundJob,
} from '../utils/dateBackgroundJobs';
import {
    buildDateHistoryGroups,
    formatDateHistoryDate,
    formatDateHistoryExport,
    formatDateHistoryTime,
    makeDateHistoryFileName,
    type DateHistoryGroup,
    type DateHistorySortOrder,
    type DateHistoryView,
} from '../utils/dateHistory';

const truncateHistoryPreview = (value: string, maxLength = 96): string => {
    const normalized = stripFaceToFacePhoneSourceTags(stripMessageReactionTags(value)
        .replace(/\[.*?\]/g, '')
        .replace(/\s+/g, ' ')
        .trim());
    if (!normalized) return '这次见面没有摘要。';
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}…` : normalized;
};

type DateEncounterRuntime = {
    id: string;
    startedAt: number;
    sceneClockAt: number;
    sceneClockAdvancedMs: number;
    sceneClockRevision: number;
    sceneClockUpdatedAt: number;
    sceneClockTimeZone?: string;
};

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const DateApp: React.FC = () => {
    const { closeApp, openApp, characters, activeCharacterId, setActiveCharacterId, apiConfig, addToast, updateCharacter, virtualTime, userProfile, memoryPalaceConfig, dateAutoStartCharId, consumeDateAutoStart, characterGroups, groups, realtimeConfig } = useOS();

    // 是否由聊天「见面」按钮进入：为真时，退出见面流程回到聊天而非见面选择页/桌面。
    // 用本地 state（而非 context）承载：DateApp 切走即卸载，标记随之消失，不会泄漏到
    // 之后从桌面直接打开的见面会话里。
    const [cameFromChat, setCameFromChat] = useState(false);
    const [meetSurface, setMeetSurface] = useState<'companion' | 'story'>(() => dateLaunch.peek()?.surface ?? 'companion');

    // 记忆宫殿（与聊天侧共用同一套上下文：同 charId、同高水位线）
    // 见面流也需要在 AI 回复后跑一次缓冲区检查 + 自动归档，否则只有"读"没有"写"。
    const [memoryPalaceStatus, setMemoryPalaceStatus] = useState<string>('');
    const [memoryPalaceResult, setMemoryPalaceResult] = useState<PipelineResult | null>(null);
    const memoryPalaceStatusRef = useRef(memoryPalaceStatus);
    memoryPalaceStatusRef.current = memoryPalaceStatus;

    // characters ref：见面 hook 跑完后用户可能已经在 MemoryPalaceApp 里关掉了宫殿，
    // 直接闭包里的 charForHook 是回复开始时捕获的，会读到 stale memoryPalaceEnabled=true。
    const charactersRef = useRef(characters);
    charactersRef.current = characters;
    
    // Modes: 'select' -> 'peek' -> 'session' | 'settings' | 'history'
    const [mode, setMode] = useState<'select' | 'peek' | 'session' | 'settings' | 'history'>('select');
    // Track previous mode for Settings back navigation
    const [previousMode, setPreviousMode] = useState<'select' | 'peek'>('select');

    // 全局更新弹窗等入口可直接落到「剧情」。peek 让首次渲染就显示目标页，
    // subscribe 则覆盖 DateApp 已经打开的情况；应用后立即消费，绝不污染下次普通打开。
    useEffect(() => {
        const applyLaunchIntent = (intent: DateLaunchIntent) => {
            setCameFromChat(intent.returnTo === 'chat');
            setMeetSurface(intent.surface);
            if (intent.autoStart && intent.charId) {
                setMode('select');
                setAcceptedInviteLaunch({ charId: intent.charId, meetingInviteMessageId: intent.meetingInviteMessageId });
            } else if (intent.openEncounter && intent.charId && intent.encounterId) {
                setPendingDateEncounterOpen({ charId: intent.charId, encounterId: intent.encounterId });
            } else if (intent.openHistory && intent.charId && intent.encounterId) {
                setPendingHistoryOpen({ charId: intent.charId, encounterId: intent.encounterId });
            } else {
                setMode('select');
            }
            dateLaunch.consume();
        };

        const initialIntent = dateLaunch.peek();
        if (initialIntent) applyLaunchIntent(initialIntent);
        return dateLaunch.subscribe(applyLaunchIntent);
    }, []);

    // 选择页分页（6 个角色一页，横向翻页）
    const SELECT_PAGE_SIZE = 6;
    const DATE_SESSION_MESSAGE_LIMIT = 220;
    const DATE_HISTORY_MESSAGE_LIMIT = 500;
    /**
     * 结束见面时那段模型总结的最长等待。到点就退回本地摘要，不再拖住整个收尾流程。
     * 20 秒足够任何正常渠道写完 80 字，又不至于让用户以为 App 卡死了。
     */
    const FINISH_SUMMARY_TIMEOUT_MS = 20_000;
    const pagerRef = useRef<HTMLDivElement>(null);
    const [selectPage, setSelectPage] = useState(0);
    const [discardBusy, setDiscardBusy] = useState(false);
    const [selectGroupId, setSelectGroupId] = useState(GROUP_FILTER_ALL); // 选择页的分组筛选
    const onPagerScroll = () => {
        const el = pagerRef.current;
        if (!el || el.clientWidth === 0) return;
        const p = Math.round(el.scrollLeft / el.clientWidth);
        setSelectPage(prev => (prev === p ? prev : p));
    };
    const goSelectPage = (pi: number) => {
        const el = pagerRef.current;
        if (!el) return;
        el.scrollTo({ left: pi * el.clientWidth, behavior: 'smooth' });
    };

    const [peekStatus, setPeekStatus] = useState<string>('');
    const [peekLoading, setPeekLoading] = useState(false);
    
    // History State
    const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
    const [historyView, setHistoryView] = useState<DateHistoryView>('encounter');
    const [historySortOrder, setHistorySortOrder] = useState<DateHistorySortOrder>('newest');
    const [historyLoadLimit, setHistoryLoadLimit] = useState(DATE_HISTORY_MESSAGE_LIMIT);
    const [historyReachedEnd, setHistoryReachedEnd] = useState(false);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [historyFocusEncounterId, setHistoryFocusEncounterId] = useState<string | null>(null);
    const [pendingHistoryOpen, setPendingHistoryOpen] = useState<{ charId: string; encounterId: string } | null>(null);
    // 从分页记录进入的完结见面回顾：复用 DateSession 的阅读/立绘页面，但禁止回复与新存档。
    const [historyReplayGroupId, setHistoryReplayGroupId] = useState<string | null>(null);
    const [historySelectedGroupId, setHistorySelectedGroupId] = useState<string | null>(null);
    const [historyQuery, setHistoryQuery] = useState('');
    const [historyDeleteTarget, setHistoryDeleteTarget] = useState<DateHistoryGroup | null>(null);
    const [historyDeleteBusy, setHistoryDeleteBusy] = useState(false);
    // History long-press context menu
    const [historyMenuMsg, setHistoryMenuMsg] = useState<Message | null>(null);
    const [historyMenuPos, setHistoryMenuPos] = useState<{x: number, y: number}>({x: 0, y: 0});
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // History edit modal
    const [historyEditMsg, setHistoryEditMsg] = useState<Message | null>(null);
    const [historyEditContent, setHistoryEditContent] = useState('');
    
    // Resume Logic State
    const [pendingSessionChar, setPendingSessionChar] = useState<CharacterProfile | null>(null);
    const [pendingMeetingInviteMessageId, setPendingMeetingInviteMessageId] = useState<number | undefined>(undefined);
    const [acceptedInviteLaunch, setAcceptedInviteLaunch] = useState<{ charId: string; meetingInviteMessageId?: number } | null>(null);
    const [pendingDateEncounterOpen, setPendingDateEncounterOpen] = useState<{ charId: string; encounterId: string } | null>(null);
    const [dateBackgroundPendingJobId, setDateBackgroundPendingJobId] = useState<string | null>(null);
    const [activeEncounterRuntime, setActiveEncounterRuntime] = useState<DateEncounterRuntime | null>(null);
    const activeEncounterRef = useRef<DateEncounterRuntime | null>(null);
    // 每个异步见面请求都有自己的序号；剧情时钟提交前会再次核对 encounter + revision，
    // 防止旧的过场响应在用户手动校时、切换会话或离开后回写新状态。
    const dateTurnRequestRef = useRef(0);

    const setEncounterRuntime = (runtime: DateEncounterRuntime | null) => {
        activeEncounterRef.current = runtime;
        setActiveEncounterRuntime(runtime);
    };

    const newEncounter = (target?: CharacterProfile): DateEncounterRuntime => {
        const startedAt = Date.now();
        return {
            id: `date_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
            startedAt,
            sceneClockAt: startedAt,
            sceneClockAdvancedMs: 0,
            sceneClockRevision: 0,
            sceneClockUpdatedAt: startedAt,
            sceneClockTimeZone: target ? resolveCharTimeZone(target) : undefined,
        };
    };

    type EncounterClockSource = Partial<DateState> & Partial<DateEncounterPresence>;
    const getClockSourceRevision = (source?: EncounterClockSource | null): number =>
        isFiniteNumber(source?.sceneClockRevision) ? source.sceneClockRevision : -1;
    const getClockSourceUpdatedAt = (source?: EncounterClockSource | null): number =>
        isFiniteNumber(source?.sceneClockUpdatedAt) ? source.sceneClockUpdatedAt : 0;

    const runtimeFromSource = (
        target: CharacterProfile | undefined,
        source?: EncounterClockSource | null,
        fallback?: DateEncounterRuntime | null,
    ): DateEncounterRuntime => {
        const fallbackStartedAt = fallback?.startedAt || Date.now();
        const startedAt = isFiniteNumber(source?.encounterStartedAt)
            ? source.encounterStartedAt
            : isFiniteNumber(source?.startedAt)
                ? source.startedAt
                : fallbackStartedAt;
        return {
            id: source?.encounterId || fallback?.id || `date_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
            startedAt,
            sceneClockAt: isFiniteNumber(source?.sceneClockAt) ? source.sceneClockAt : (fallback?.sceneClockAt || startedAt),
            sceneClockAdvancedMs: Math.max(0, isFiniteNumber(source?.sceneClockAdvancedMs) ? source.sceneClockAdvancedMs : (fallback?.sceneClockAdvancedMs || 0)),
            sceneClockRevision: Math.max(0, Math.floor(isFiniteNumber(source?.sceneClockRevision) ? source.sceneClockRevision : (fallback?.sceneClockRevision || 0))),
            sceneClockUpdatedAt: isFiniteNumber(source?.sceneClockUpdatedAt) ? source.sceneClockUpdatedAt : (fallback?.sceneClockUpdatedAt || startedAt),
            sceneClockTimeZone: source?.sceneClockTimeZone || fallback?.sceneClockTimeZone || (target ? resolveCharTimeZone(target) : undefined),
        };
    };

    const chooseEncounterSource = (
        saved?: EncounterClockSource,
        presence?: EncounterClockSource,
    ): EncounterClockSource | undefined => {
        if (!saved) return presence;
        if (!presence || (saved.encounterId && presence.encounterId && saved.encounterId !== presence.encounterId)) return saved;
        const savedRevision = getClockSourceRevision(saved);
        const presenceRevision = getClockSourceRevision(presence);
        if (presenceRevision !== savedRevision) return presenceRevision > savedRevision ? presence : saved;
        return getClockSourceUpdatedAt(presence) > getClockSourceUpdatedAt(saved) ? presence : saved;
    };

    const ensureEncounter = () => {
        const current = activeEncounterRef.current;
        if (current) return current;
        const saved = char?.savedDateState;
        const presence = char ? (getActiveDatePresence(char.id) || char.activeDateEncounter) : undefined;
        const source = chooseEncounterSource(saved, presence);
        const next = source ? runtimeFromSource(char, source) : newEncounter(char);
        setEncounterRuntime(next);
        return next;
    };

    // --- NEW: Editing State lifted to here for DB sync ---
    const [dateMessages, setDateMessages] = useState<Message[]>([]);
    const [endSuggestedReason, setEndSuggestedReason] = useState('');
    // 阅读模式「加载更早」用：当前查询 limit 与「库里已经没有更早的了」。
    const [dateLoadLimit, setDateLoadLimit] = useState(DATE_SESSION_MESSAGE_LIMIT);
    const [dateHistoryReachedEnd, setDateHistoryReachedEnd] = useState(false);
    const [hasSavedOpening, setHasSavedOpening] = useState(false);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editTargetMsg, setEditTargetMsg] = useState<Message | null>(null);
    const [editContent, setEditContent] = useState('');

    const char = characters.find(c => c.id === activeCharacterId);
    const activateDateEncounter = (charId: string, encounter: DateEncounterRuntime) => {
        setEncounterRuntime(encounter);
        const presence = makeDateEncounterPresence(encounter.id, encounter.startedAt, 'active', encounter);
        setActiveDatePresence(charId, presence);
        updateCharacter(charId, { activeDateEncounter: presence });
        return presence;
    };
    const clearDateEncounter = (charId: string, encounterId?: string) => {
        const current = getActiveDatePresence(charId) || charactersRef.current.find(item => item.id === charId)?.activeDateEncounter;
        if (encounterId && current?.encounterId && current.encounterId !== encounterId) return;
        clearActiveDatePresence(charId, encounterId);
        updateCharacter(charId, { activeDateEncounter: undefined });
        if (!encounterId || activeEncounterRef.current?.id === encounterId) setEncounterRuntime(null);
    };
    const markMeetingInviteAccepted = (messageId: number | undefined, encounterId: string) => {
        if (typeof messageId !== 'number') return;
        void DB.updateMessageMetadata(messageId, (previous: any) => ({
            ...(previous || {}),
            meetingInviteStatus: 'accepted',
            meetingInviteAcceptedAt: Date.now(),
            meetingInviteEncounterId: encounterId,
        })).catch(error => {
            // 见面已经成功进入；卡片状态同步失败不应把用户踢出线下会话。
            console.error('[DateApp] 更新见面邀约状态失败', error);
        });
    };
    const historyGroups = useMemo(
        () => buildDateHistoryGroups(historyMessages, historyView, historySortOrder),
        [historyMessages, historyView, historySortOrder],
    );
    const historyListGroups = useMemo(() => {
        const query = historyQuery.trim().toLocaleLowerCase();
        if (!query) return historyGroups;
        return historyGroups.filter(group => {
            const haystack = [
                group.dateKey,
                group.summary || '',
                ...group.messages.map(message => message.content || ''),
            ].join('\n').toLocaleLowerCase();
            return haystack.includes(query);
        });
    }, [historyGroups, historyQuery]);
    const selectedHistoryGroup = useMemo(
        () => historySelectedGroupId ? historyGroups.find(group => group.id === historySelectedGroupId) || null : null,
        [historyGroups, historySelectedGroupId],
    );

    // 见面消息和普通聊天共用同一份历史，也就是主动消息 2.0 云端快照（fire_pack）的素材。
    // 每次落库 / 删改后打一次脏：中途杀 App 时这一场见面就不会在云端整个丢掉，删改过的
    // 内容也不会被角色到点又提一遍。快照里的消息在上传时从 DB 重读，打脏本身很便宜。
    const markDateTurnDirty = (target = char) => {
        if (!target) return;
        // DateApp handlers retain their original render closure across awaits. Prefer
        // the latest context snapshot for ordinary calls so an activeDateEncounter
        // update cannot be overwritten by a stale post-save mark; explicit snapshots
        // (such as finishEncounter's cleared presence) remain authoritative.
        const liveTarget = target === char
            ? (charactersRef.current.find(item => item.id === target.id) || target)
            : target;
        markAmsgStateDirty({ char: liveTarget, userProfile, groups, realtimeConfig });
    };

    const sceneClockMetadata = (encounter: DateEncounterRuntime, extra: Record<string, any> = {}) => ({
        source: 'date',
        dateEncounterId: encounter.id,
        dateEncounterStartedAt: encounter.startedAt,
        sceneClockAt: encounter.sceneClockAt,
        sceneClockAdvancedMs: encounter.sceneClockAdvancedMs,
        sceneClockRevision: encounter.sceneClockRevision,
        sceneClockUpdatedAt: encounter.sceneClockUpdatedAt,
        ...(encounter.sceneClockTimeZone ? { sceneClockTimeZone: encounter.sceneClockTimeZone } : {}),
        ...extra,
    });

    const makeNextClockRuntime = (
        current: DateEncounterRuntime,
        sceneClockAt: number,
        sceneClockAdvancedMs = current.sceneClockAdvancedMs,
    ): DateEncounterRuntime => ({
        ...current,
        sceneClockAt,
        sceneClockAdvancedMs: Math.max(0, sceneClockAdvancedMs),
        sceneClockRevision: current.sceneClockRevision + 1,
        sceneClockUpdatedAt: Date.now(),
    });

    const commitSceneClock = (
        charId: string,
        next: DateEncounterRuntime,
        expected: { encounterId: string; sceneClockRevision: number },
    ): DateEncounterRuntime | null => {
        const current = activeEncounterRef.current;
        if (!current
            || current.id !== expected.encounterId
            || current.sceneClockRevision !== expected.sceneClockRevision
            || next.id !== current.id) return null;
        activateDateEncounter(charId, next);
        return next;
    };

    const updateLatestSceneClockCheckpoint = async (charId: string, encounter: DateEncounterRuntime) => {
        const recent = await DB.getRecentMessagesByCharIdAndSource(charId, 'date', 500);
        const latest = [...recent].reverse().find(message => (
            message.metadata?.source === 'date'
            && message.metadata?.dateEncounterId === encounter.id
        ));
        if (!latest) return;
        await DB.updateMessageMetadata(latest.id, (previous: any) => ({
            ...(previous || {}),
            ...sceneClockMetadata(encounter),
        }));
    };

    /** 普通回复的剧情钟只读取 OBSERVE.time / 隐藏 SCENE_CLOCK，不扫描正文。 */
    const resolveDialogueClock = (rawContent: string, encounter: DateEncounterRuntime) => {
        const { observation } = extractObservation(rawContent, {
            lenient: char?.dateObserve?.enabled === true,
            custom: char?.dateObserve?.custom,
        });
        return resolveDialogueSceneClock({
            rawContent,
            observation,
            currentAt: encounter.sceneClockAt,
            currentAdvancedMs: encounter.sceneClockAdvancedMs,
            timeZone: encounter.sceneClockTimeZone,
        });
    };

    const dialogueClockMetadata = (
        before: DateEncounterRuntime,
        after: DateEncounterRuntime,
        resolved: ReturnType<typeof resolveDialogueSceneClock>,
        extra: Record<string, any> = {},
    ) => sceneClockMetadata(after, {
        sceneClockBefore: before.sceneClockAt,
        sceneClockBeforeAdvancedMs: before.sceneClockAdvancedMs,
        sceneClockAfter: after.sceneClockAt,
        sceneClockAdvancedDeltaMs: resolved.sceneClockAdvancedDeltaMs,
        sceneClockResolution: resolved.resolution,
        ...(resolved.source ? { sceneClockSource: resolved.source } : {}),
        ...(resolved.requestedSceneClockAt !== undefined ? { requestedSceneClockAt: resolved.requestedSceneClockAt } : {}),
        ...(resolved.observedSceneClockText ? { observedSceneClockText: resolved.observedSceneClockText.slice(0, 240) } : {}),
        ...extra,
    });

    const getDateContextFetchLimit = (c: CharacterProfile) => Math.max(c.contextLimit || 500, DATE_SESSION_MESSAGE_LIMIT) + 32;
    const loadRecentDateMessages = async (charId: string, limit = DATE_SESSION_MESSAGE_LIMIT) => {
        return (await DB.getRecentMessagesByCharIdAndSource(charId, 'date', limit))
            .sort((a, b) => a.timestamp - b.timestamp);
    };

    // --- Data Loading ---
    const loadDateMessages = async (limit = dateLoadLimit, syncClockFromHistory = false) => {
        if (char) {
            // 见面记录只取最近窗口，不再把该角色全部聊天 getAll 进内存。
            // TODO(date-assets): 后续把角色立绘/背景本体迁到 assets store 后，这里还能再把 limit 放宽。
            const filtered = await loadRecentDateMessages(char.id, limit);
            const encounterId = activeEncounterRef.current?.id
                || char.activeDateEncounter?.encounterId
                || [...filtered].reverse().find(message => typeof message.metadata?.dateEncounterId === 'string')?.metadata?.dateEncounterId;
            // 手机消息仍从同一 messages store 读取，只在本地生成阅读投影；不把投影
            // 写回 DB，也不把它交给 prompt / memory pipeline。
            const recentAll = encounterId
                ? await DB.getRecentMessagesByCharId(char.id, Math.max(limit + 320, 500), true)
                : [];
            const timeline = mergeDatePhoneMessages(
                filtered,
                recentAll,
                encounterId,
                userProfile.name || '用户',
                char.name,
            );
            setDateMessages(timeline);

            // 旧版本已经把「观测时间」写进正文，但没有把它同步到剧情钟。
            // 进入会话时做一次保守自愈，既修复已有的 19:30 / 19:38 分裂，
            // 也让完全重启 PWA 后顶部时钟与最新阅读卡保持一致。普通刷新路径
            // 不执行这里的提交，避免异步请求准备期间改变它的 revision。
            if (syncClockFromHistory) {
                const current = activeEncounterRef.current;
                const hasPendingBackgroundTurn = !!current && !!getPendingDateBackgroundJobForEncounter(current.id);
                const latestAssistant = [...filtered].reverse().find(message => (
                    message.role === 'assistant'
                    && !isDatePhoneBridge(message)
                    && message.metadata?.source === 'date'
                    && message.metadata?.isDateEnding !== true
                    && (!current?.id || !message.metadata?.dateEncounterId || message.metadata.dateEncounterId === current.id)
                ));
                if (current && !hasPendingBackgroundTurn && latestAssistant) {
                    const resolved = resolveDialogueClock(latestAssistant.content || '', current);
                    if (resolved.advanced) {
                        const next = makeNextClockRuntime(current, resolved.sceneClockAt, resolved.sceneClockAdvancedMs);
                        const committed = commitSceneClock(char.id, next, {
                            encounterId: current.id,
                            sceneClockRevision: current.sceneClockRevision,
                        });
                        if (committed) {
                            const syncedMetadata = dialogueClockMetadata(current, next, resolved, {
                                dateTurnKind: latestAssistant.metadata?.dateTurnKind || 'dialogue',
                            });
                            try {
                                await DB.updateMessageMetadata(latestAssistant.id, (previous: any) => ({
                                    ...(previous || {}),
                                    ...syncedMetadata,
                                }));
                            } catch (error) {
                                // presence/runtime 已经完成 CAS 提交；历史元数据写失败时，
                                // 不要让用户卡在空白会话，下一次进入仍可再次自愈。
                                console.warn('[DateApp] 回填最新见面观测时间失败', error);
                            }
                            // 当前 timeline 是本次 DB 读取的快照。同步把同一份元数据
                            // 写入 React 投影，避免首次进入阅读模式仍短暂显示旧分钟。
                            setDateMessages(messages => messages.map(message => (
                                message.id === latestAssistant.id
                                    ? { ...message, metadata: { ...(message.metadata || {}), ...syncedMetadata } }
                                    : message
                            )));
                            markDateTurnDirty({ ...char, activeDateEncounter: getActiveDatePresence(char.id) || undefined });
                        }
                    }
                }
            }
            // 拿回来的比要的少 = 库里的见面记录已经取完，阅读模式不用再往前翻了。
            setDateHistoryReachedEnd(filtered.length < limit);
            
            // 检查数据库中是否已经包含当前的 peekStatus（通过内容比对），避免重复保存
            if (peekStatus && filtered.some(m => m.content === peekStatus && m.role === 'assistant')) {
                setHasSavedOpening(true);
            }
        }
    };

    useEffect(() => {
        if (char && mode === 'session' && !historyReplayGroupId) {
            // 进会话 / 换角色都从初始窗口重来。limit 必须显式传：setState 是异步的，
            // 靠 dateLoadLimit 闭包会读到上一个角色翻开的深度，和重置后的 state 对不上。
            setDateLoadLimit(DATE_SESSION_MESSAGE_LIMIT);
            setDateHistoryReachedEnd(false);
            setDateBackgroundPendingJobId(activeEncounterRef.current
                ? getPendingDateBackgroundJobForEncounter(activeEncounterRef.current.id)?.jobId || null
                : null);
            loadDateMessages(DATE_SESSION_MESSAGE_LIMIT, true);
        }
    }, [char, mode, historyReplayGroupId]);

    useEffect(() => {
        if (!char || mode !== 'session' || historyReplayGroupId || typeof window === 'undefined') return;
        const handleBackgroundDateProgress = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            if (!detail.dateBackground
                || detail.charId !== char.id
                || detail.dateEncounterId !== activeEncounterRef.current?.id) return;
            setDateBackgroundPendingJobId(null);
            if (typeof detail.endMeetingReason === 'string' && detail.endMeetingReason.trim()) {
                setEndSuggestedReason(detail.endMeetingReason.trim());
            }
            // Worker 已在落库前把剧情钟写回 presence；React 这边也要立即接上，
            // 否则后台回复虽已出现在阅读模式，顶部「此时此刻」仍停在旧分钟。
            const current = activeEncounterRef.current;
            const presence = getActiveDatePresence(char.id)
                || charactersRef.current.find(item => item.id === char.id)?.activeDateEncounter;
            if (current && presence?.encounterId === current.id) {
                const presenceRevision = typeof presence.sceneClockRevision === 'number'
                    ? presence.sceneClockRevision
                    : current.sceneClockRevision;
                if (presenceRevision >= current.sceneClockRevision) {
                    const nextRuntime = runtimeFromSource(char, presence, current);
                    if (nextRuntime.sceneClockRevision >= current.sceneClockRevision) {
                        setEncounterRuntime(nextRuntime);
                    }
                }
            }
            void loadDateMessages(DATE_SESSION_MESSAGE_LIMIT).then(() => {
                markDateTurnDirty(char);
            }).catch(error => {
                console.warn('[DateApp] 刷新后台见面回复失败', error);
            });
        };
        window.addEventListener('active-msg-progress', handleBackgroundDateProgress);
        return () => window.removeEventListener('active-msg-progress', handleBackgroundDateProgress);
        // 当前见面身份由 activeEncounterRef 保持；只在角色 / 会话页面切换时重绑监听。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [char?.id, mode, historyReplayGroupId]);

    // 页面被系统回收在「保存 user 消息」之后、schedule 之前时，重开见面要把 pending
    // 继续交给 Worker；如果这台 Worker 明确不支持，则保留 user 消息，让用户按重试回前台。
    useEffect(() => {
        if (!char || mode !== 'session' || historyReplayGroupId) return;
        const encounter = activeEncounterRef.current;
        if (!encounter) return;
        const pending = getPendingDateBackgroundJobForEncounter(encounter.id);
        if (!pending) {
            setDateBackgroundPendingJobId(null);
            return;
        }
        setDateBackgroundPendingJobId(pending.jobId);
        void schedulePendingDateBackgroundJob({ jobId: pending.jobId, char, api: apiConfig }).then(outcome => {
            if (outcome.status === 'fallback') {
                removePendingDateBackgroundJob(pending.jobId);
                setDateBackgroundPendingJobId(null);
                addToast('后台见面暂不可用，点击重试即可在前台生成', 'info');
            }
        }).catch(error => {
            console.warn('[DateApp] 恢复见面后台任务失败', error);
        });
        // 见面身份由 ref 固定；只在角色 / 会话切换时尝试恢复一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [char?.id, mode, historyReplayGroupId]);


    /** 阅读模式要更早的记录：limit 递增重取（反向游标，limit 越大够得越远）。 */
    const handleLoadMoreDateHistory = async (nextLimit: number) => {
        setDateLoadLimit(nextLimit);
        await loadDateMessages(nextLimit);
    };

    // 见面「继续上次」崩溃自愈：若上次恢复会话时把 iOS WebKit 内容进程撑崩了
    // (表现为反复灰屏/白屏「此网页反复出现问题」，非可捕获的 JS 异常)，那份重快照
    // 的哨兵会残留到本次进见面。这里检出后丢弃有毒的 savedDateState（仅清恢复快照，
    // 消息历史不动），避免用户永久卡在闪退死循环里。只在 DateApp 挂载时跑一次。
    useEffect(() => {
        const crashedCharId = takeCrashedDateResume();
        if (!crashedCharId) return;
        const crashed = characters.find(c => c.id === crashedCharId);
        trackEvent('检出见面存档崩溃并清理', { 处理结果: crashed?.savedDateState ? '已清理存档' : '无存档可清' });
        if (crashed?.savedDateState) {
            clearDateEncounter(crashedCharId, crashed.savedDateState.encounterId);
            updateCharacter(crashedCharId, { savedDateState: undefined });
            addToast('上次见面异常退出，已清理存档，可重新开始', 'info');
        }
    }, []); // 仅挂载时检查一次

    // --- Navigation Helpers ---
    const handleBack = () => {
        if (mode === 'peek') {
            if (char && activeEncounterRef.current) {
                clearDateEncounter(char.id, activeEncounterRef.current.id);
            }
            // 来自聊天：从感知页退出直接回聊天，不落在见面选择页
            if (cameFromChat) { returnToChat(); return; }
            setMode('select');
            setPeekStatus('');
        } else if (mode === 'history') {
            if (historySelectedGroupId) setHistorySelectedGroupId(null);
            // 从聊天的见面完结卡片进来的记录页，返回同样要回那段对话。
            else if (cameFromChat) returnToChat();
            else setMode('select');
        } else closeApp();
    };

    const formatTime = () => `${virtualTime.hours.toString().padStart(2, '0')}:${virtualTime.minutes.toString().padStart(2, '0')}`;

    // peek / send / reroll 共用的 LLM 调用（提示词构建统一在 utils/datePrompts.ts）
    const callLLM = async (messages: ApiMessage[], temperature: number): Promise<string> => {
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages,
                temperature,
                // max_tokens 是 Claude 原生 API 的必填字段；缺了它，糯米机/Csy 等
                // OpenAI→Claude 中转会被上游打回，再包成 502 / bad_response_status_code。
                // 与私聊 (useChatAI.ts) 对齐，统一带 8000。
                max_tokens: 8000,
                stream: apiConfig.stream ?? false,
            })
        });
        if (!response.ok) throw new Error(`API Error ${response.status}`);
        const data = await safeResponseJson(response);
        // 思考型渠道会把正文塞进 reasoning_content、content 留空——直接取 content
        // 会拿到空串且不报错：感知页黑屏卡死（无按钮可退），会话里则落库空消息。
        const content = extractContent(data);
        if (!content) throw new Error('模型返回了空回复，请重试或检查渠道/模型设置');
        // Source markers are prompt metadata, never part of the saved/readable date story.
        return stripFaceToFacePhoneSourceTags(stripMessageReactionTags(content));
    };

    // --- Resume / Start Logic ---
    const handleCharClick = (c: CharacterProfile, options: { autoStart?: boolean; meetingInviteMessageId?: number } = {}) => {
        if (c.savedDateState) {
            setPendingSessionChar(c);
            setPendingMeetingInviteMessageId(options.meetingInviteMessageId);
        } else if (c.activeDateEncounter?.status === 'active') {
            setPendingMeetingInviteMessageId(undefined);
            // DateApp can be unmounted when the user briefly switches to ChatApp.
            // The presence is enough to resume the same encounter identity even
            // when no explicit “退出并保存” snapshot was created yet.
            const encounter = runtimeFromSource(c, getActiveDatePresence(c.id) || c.activeDateEncounter);
            activateDateEncounter(c.id, encounter);
            markMeetingInviteAccepted(options.meetingInviteMessageId, encounter.id);
            setActiveCharacterId(c.id);
            setPeekStatus('');
            setHasSavedOpening(true);
            setMode('session');
            trackEvent('恢复进行中的见面');
        } else {
            setPendingMeetingInviteMessageId(undefined);
            void startPeek(c, options);
        }
    };

    // 从聊天「见面」按钮跳进来：等同于在选择页点击该角色（有存档则弹继续/新开，否则直接感知）
    // 并记住「来自聊天」，退出见面时回到聊天。
    useEffect(() => {
        if (!dateAutoStartCharId) return;
        const target = characters.find(c => c.id === dateAutoStartCharId);
        consumeDateAutoStart();
        setCameFromChat(true);
        setMeetSurface('companion');
        if (target) handleCharClick(target);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateAutoStartCharId]);

    // 退出见面流程：来自聊天则回聊天，否则回见面选择页/桌面（由调用方决定）
    const returnToChat = () => {
        setCameFromChat(false);
        // 只 openApp 会停在好友列表；用户是从某段对话里进来的，返回要回同一段对话。
        const backToCharId = char?.id || activeCharacterId;
        if (backToCharId) chatDetailLaunch.request({ charId: backToCharId });
        openApp(AppID.Chat);
    };

    const handleResumeSession = () => {
        if (!pendingSessionChar) return;
        const meetingInviteMessageId = pendingMeetingInviteMessageId;
        // 恢复尝试开始前先武装崩溃哨兵：若这份重快照在 iOS 上把内容进程撑崩，
        // 哨兵会残留到下次进见面被检出并清理（见挂载时的自愈 effect）。
        armDateResumeAttempt(pendingSessionChar.id);
        const saved = pendingSessionChar.savedDateState;
        const presence = getActiveDatePresence(pendingSessionChar.id) || pendingSessionChar.activeDateEncounter;
        const encounter = runtimeFromSource(
            pendingSessionChar,
            chooseEncounterSource(saved, presence),
            saved?.encounterId ? null : newEncounter(pendingSessionChar),
        );
        activateDateEncounter(pendingSessionChar.id, encounter);
        markMeetingInviteAccepted(meetingInviteMessageId, encounter.id);
        setActiveCharacterId(pendingSessionChar.id);
        setMode('session');
        setPendingSessionChar(null);
        setPendingMeetingInviteMessageId(undefined);
        addToast('已恢复上次进度', 'success');
        trackEvent('选择见面存档处理方式', { choice: 'resume' });
        trackEvent('恢复上次见面进度');
    };

    const handleStartNewSession = () => {
        if (!pendingSessionChar) return;
        const meetingInviteMessageId = pendingMeetingInviteMessageId;
        // 新会话没有恢复快照可重放，撤销任何残留哨兵。
        clearDateResumeAttempt();
        clearDateEncounter(pendingSessionChar.id, pendingSessionChar.savedDateState?.encounterId);
        setEncounterRuntime(null);
        updateCharacter(pendingSessionChar.id, { savedDateState: undefined });
        trackEvent('选择见面存档处理方式', { choice: 'new' });
        trackEvent('见面存档选重新开始');
        void startPeek(
            pendingSessionChar,
            meetingInviteMessageId === undefined
                ? {}
                : { autoStart: true, meetingInviteMessageId },
        );
        setPendingSessionChar(null);
        setPendingMeetingInviteMessageId(undefined);
    };

    /**
     * 丢弃这次没收尾的见面：只想测一下功能、测完就想删掉时走这里。
     *
     * 和「新的见面」的区别是它不接着开新一轮，而且会把这次见面留下的正文与结束卡一并
     * 删掉——否则用户只是把状态清了，历史里仍旧堆着一堆测试记录。删不掉也照样清状态：
     * activeDateEncounter 挂着不放才是真正会闷掉自然主动的那一半。
     */
    const handleDiscardSession = async () => {
        const target = pendingSessionChar;
        if (!target || discardBusy) return;
        setDiscardBusy(true);
        const encounterId = target.savedDateState?.encounterId
            || target.activeDateEncounter?.encounterId;
        try {
            if (encounterId) {
                await cancelPendingDateBackgroundJobs(encounterId);
                const [dateMsgs, popupMsgs] = await Promise.all([
                    DB.getRecentMessagesByCharIdAndSource(target.id, 'date', Number.MAX_SAFE_INTEGER),
                    DB.getRecentMessagesByCharIdAndSource(target.id, 'date-end-popup', Number.MAX_SAFE_INTEGER),
                ]);
                const ids = [...dateMsgs, ...popupMsgs]
                    .filter(message => message.metadata?.dateEncounterId === encounterId)
                    .map(message => message.id);
                if (ids.length) await DB.deleteMessages(ids);
            }
        } catch (error) {
            console.error('[DateApp] 丢弃见面时清理记录失败，仍继续清状态', error);
            addToast('记录没能全部删掉，但这次见面已经作废', 'info');
        } finally {
            clearDateResumeAttempt();
            clearDateEncounter(target.id, encounterId);
            updateCharacter(target.id, { savedDateState: undefined, activeDateEncounter: undefined });
            if (activeEncounterRef.current?.id === encounterId || !encounterId) setEncounterRuntime(null);
            // 让下一次 fire_pack 同步立刻带上「已经没有见面了」，别等下一轮聊天。
            markDateTurnDirty({ ...target, activeDateEncounter: undefined, savedDateState: undefined });
            setPendingSessionChar(null);
            setPendingMeetingInviteMessageId(undefined);
            setDiscardBusy(false);
            addToast('这次见面已丢弃', 'success');
            trackEvent('选择见面存档处理方式', { choice: 'discard' });
            if (cameFromChat) returnToChat();
        }
    };

    // --- 关键修复: 进入 Session 时立即归档开场白 ---
    const handleEnterSession = async () => {
        if (!char) return;
        const encounter = ensureEncounter();
        activateDateEncounter(char.id, encounter);

        // 1. 如果有开场白且未保存，立即保存到数据库
        // 这确保了 user 发送第一句话时，AI 能在历史记录里读到这个开场
        // UPDATE: 添加 isOpening 标记，用于区分新会话
        if (peekStatus && !hasSavedOpening) {
            try {
                await DB.saveMessage({
                    charId: char.id,
                    role: 'assistant',
                    type: 'text',
                    content: peekStatus,
                    metadata: sceneClockMetadata(encounter, { isOpening: true })
                });
                setHasSavedOpening(true);
            } catch (e) {
                console.error("Failed to save opening", e);
                // 落库失败不能静默：开场白进不了 DB，阅读模式/见面记录会缺这次开场，
                // 表现和「阅读模式播旧剧情」一样，让用户知道出了什么事
                addToast('开场白保存失败，本次开场可能不会出现在阅读模式', 'error');
            }
        }

        // 2. 切换模式并刷新数据
        setMode('session');
        trackEvent('走过去开始见面会话');
        await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT, true);
    };

    /**
     * 接受角色邀约后的原子入口：开场白落库成功后才建立 active presence，
     * 然后切入 session。这样用户接受卡片后不会再停在「走过去」，也不会在
     * 开场落库失败时留下一个看似正在进行的空 encounter。
     */
    const startSessionFromMeetingInvite = async (
        c: CharacterProfile,
        opening: string,
        encounter: DateEncounterRuntime,
        meetingInviteMessageId?: number,
    ): Promise<boolean> => {
        if (activeEncounterRef.current?.id !== encounter.id) return false;
        const cleanOpening = opening.trim();
        if (!cleanOpening) return false;

        let openingMessageId: number;
        try {
            openingMessageId = await DB.saveMessage({
                charId: c.id,
                role: 'assistant',
                type: 'text',
                content: cleanOpening,
                metadata: sceneClockMetadata(encounter, { isOpening: true }),
            });
        } catch (error) {
            console.error('[DateApp] 接受见面邀约时保存开场失败', error);
            addToast('见面开场保存失败，请稍后再试', 'error');
            return false;
        }

        // 用户可能在模型返回前离开或重新感知；过期请求不能重新把页面拽回 session。
        if (activeEncounterRef.current?.id !== encounter.id) {
            // 开场已经写入但本次入口已过期，尽量撤销这条孤立的 date 记录。
            await DB.deleteMessage(openingMessageId).catch(error => {
                console.error('[DateApp] 清理过期见面开场失败', error);
            });
            return false;
        }
        const presence = activateDateEncounter(c.id, encounter);
        markMeetingInviteAccepted(meetingInviteMessageId, encounter.id);
        markDateTurnDirty({ ...c, activeDateEncounter: presence });
        setPeekStatus(cleanOpening);
        setHasSavedOpening(true);
        setMode('session');
        trackEvent('接受角色见面邀请并直接进入会话');
        // DateApp 的 session effect 会在 activeCharacterId / mode 更新后的渲染中
        // 读取当前角色的最新消息，不在这里用旧闭包重复加载。
        return true;
    };

    // --- Peek (Generation) Logic ---
    const startPeek = async (c: CharacterProfile, options: { autoStart?: boolean; meetingInviteMessageId?: number } = {}) => {
        const encounter = newEncounter(c);
        setEncounterRuntime(encounter);
        setActiveCharacterId(c.id);
        setMode('peek');
        setPeekLoading(true);
        setPeekStatus('');
        setHasSavedOpening(false);
        trackEvent('进入见面感知页');

        try {
            const msgs = await DB.getRecentMessagesByCharId(c.id, getDateContextFetchLimit(c), true);
            const preparedMsgs = await materializeVisionDescriptions(msgs, apiConfig.visionApi);
            const emojis = await DB.getEmojis();
            const { messages } = DatePrompts.buildPeekPayload({
                char: c,
                userProfile,
                allMsgs: preparedMsgs,
                emojis,
                useVisionDescriptions: apiConfig.visionApi?.enabled === true,
            });
            const content = await callLLM(messages, apiConfig.temperature ?? 0.85);
            // 过期的感知请求不能覆盖用户已经开始的另一场见面。
            if (activeEncounterRef.current?.id !== encounter.id) return;
            setPeekStatus(content);
            if (options.autoStart) {
                await startSessionFromMeetingInvite(c, content, encounter, options.meetingInviteMessageId);
            }

        } catch (e: any) {
            if (activeEncounterRef.current?.id === encounter.id) {
                setPeekStatus(`(无法感知状态: ${e.message})`);
            }
        } finally {
            if (activeEncounterRef.current?.id === encounter.id) {
                setPeekLoading(false);
            }
        }
    };

    // 接受卡片后使用与选择页相同的存档/进行中判断；没有旧状态时才自动生成
    // 开场并直接进入 session。characters 尚未加载时保留意图，下一次渲染再处理。
    useEffect(() => {
        if (!acceptedInviteLaunch) return;
        const target = characters.find(c => c.id === acceptedInviteLaunch.charId);
        if (!target) return;
        setAcceptedInviteLaunch(null);
        setCameFromChat(true);
        setMeetSurface('companion');
        handleCharClick(target, {
            autoStart: true,
            meetingInviteMessageId: acceptedInviteLaunch.meetingInviteMessageId,
        });
        // handleCharClick / startPeek 是本组件内随渲染重建的命令函数；意图本身才是
        // 这个 effect 的稳定触发源，避免每次输入消息都重新开始感知。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [acceptedInviteLaunch, characters]);

    // 后台见面通知点击后的精确回跳：按 encounterId 恢复正在进行的这一场，
    // 不凭 charId 猜“最近一场”，也不创建新的 encounter。
    useEffect(() => {
        if (!pendingDateEncounterOpen) return;
        const request = pendingDateEncounterOpen;
        const target = characters.find(c => c.id === request.charId);
        if (!target) return;
        setPendingDateEncounterOpen(null);
        const source = getActiveDatePresence(target.id) || target.activeDateEncounter || target.savedDateState;
        if (!source || source.encounterId !== request.encounterId) {
            setMode('select');
            addToast('这条见面回复对应的现场已经结束或被删除', 'info');
            return;
        }
        const encounter = runtimeFromSource(target, source);
        activateDateEncounter(target.id, encounter);
        setActiveCharacterId(target.id);
        setPeekStatus('');
        setHasSavedOpening(true);
        setDateBackgroundPendingJobId(getPendingDateBackgroundJobForEncounter(request.encounterId)?.jobId || null);
        setMode('session');
        trackEvent('从见面后台通知打开现场');
        // 导航意图本身才是稳定触发源；其余命令函数随渲染更新即可。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingDateEncounterOpen, characters]);

    // 与聊天侧 useChatAI 完全一致的 Memory Palace 后台流程：
    // 触发缓冲区处理 + 自动归档（如开启） + 50 轮认知消化。
    const runMemoryPalacePostHook = useCallback(async (charForHook: CharacterProfile) => {
        // 用 charactersRef 读最新状态，避免见面流程中用户去 MemoryPalaceApp 关掉宫殿后
        // 这里仍然按 charForHook 闭包里的旧 enabled 触发一次 LLM 总结
        const liveBefore = charactersRef.current.find(c => c.id === charForHook.id) || null;
        if (!liveBefore?.memoryPalaceEnabled) return;
        const mpEmb = memoryPalaceConfig?.embedding;
        const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
        const mpLLM = (mpLLMConfigured?.baseUrl)
            ? mpLLMConfigured
            : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
        if (!mpEmb?.baseUrl || !mpEmb?.apiKey || !mpLLM.baseUrl) return;

        const recentMsgs = await DB.getRecentMessagesByCharId(charForHook.id, 50);
        try {
            const pipelineResult = await processNewMessagesWithAutoArchive(
                recentMsgs,
                charForHook.id,
                charForHook.name,
                mpEmb,
                mpLLM,
                userProfile?.name || '',
                false,
                (stage) => setMemoryPalaceStatus(stage),
            );

            // pipeline 跑的过程中用户可能又关了宫殿，再 check 一次
            const liveAfter = charactersRef.current.find(c => c.id === charForHook.id) || null;
            if (!liveAfter?.memoryPalaceEnabled) return;

            if (pipelineResult && pipelineResult.stored > 0) {
                setMemoryPalaceResult(pipelineResult);
            }

            // 50 轮自动认知消化（与聊天侧共享计数器，按 charId 持久化）
            const shouldAutoDigest = incrementDigestRound(charForHook.id);
            if (shouldAutoDigest) {
                setMemoryPalaceStatus(`${charForHook.name}闭上眼睛，开始整理内心…`);
                const persona = [liveAfter.systemPrompt || '', liveAfter.worldview || ''].filter(Boolean).join('\n');
                await runCognitiveDigestion(charForHook.id, charForHook.name, persona, mpLLM, false, userProfile?.name, mpEmb);
            }
        } catch (e: any) {
            console.error('❌ [DateApp MemoryPalace] 后台处理异常:', e?.message || e);
            addToast('记忆整理失败', 'error');
        } finally {
            const current = memoryPalaceStatusRef.current;
            if (current && current.includes('完成')) {
                addToast(current, 'success');
            }
            setMemoryPalaceStatus('');
        }
    }, [memoryPalaceConfig, apiConfig, userProfile?.name, updateCharacter, addToast]);

    const beginDateTurnRequest = () => {
        dateTurnRequestRef.current += 1;
        return dateTurnRequestRef.current;
    };

    const isCurrentDateTurnRequest = (
        requestId: number,
        encounterId: string,
        sceneClockRevision: number,
    ) => {
        const current = activeEncounterRef.current;
        return dateTurnRequestRef.current === requestId
            && current?.id === encounterId
            && current.sceneClockRevision === sceneClockRevision;
    };

    /** 手动校时是显式提交：允许往前或往回调，但会使正在飞行的旧请求失效。 */
    const handleSetSceneClock = async (sceneClockAt: number): Promise<void> => {
        if (!char || !isFiniteNumber(sceneClockAt)) return;
        beginDateTurnRequest();
        const current = ensureEncounter();
        const next = makeNextClockRuntime(current, sceneClockAt, current.sceneClockAdvancedMs);
        const committed = commitSceneClock(char.id, next, {
            encounterId: current.id,
            sceneClockRevision: current.sceneClockRevision,
        });
        if (!committed) throw new Error('见面状态已变化，请重新打开校时面板');
        try {
            await updateLatestSceneClockCheckpoint(char.id, committed);
        } catch (error) {
            // presence / saved state 已经即时更新；单条历史检查点失败不阻断继续见面，
            // 下一条新消息会再次带上完整时钟快照。
            console.warn('[DateApp] 更新剧情时钟检查点失败', error);
        }
        markDateTurnDirty({ ...char, activeDateEncounter: getActiveDatePresence(char.id) || undefined });
        addToast('剧情时间已调整', 'success');
        trackEvent('手动调整见面剧情时间');
    };

    /** 过场不创建 user 消息；只有生成后的 assistant 正文进入 date 历史与总结。 */
    const handleInterlude = async (description: string, targetAt?: number): Promise<string> => {
        if (!char) throw new Error('No char');
        const requestId = beginDateTurnRequest();
        const base = ensureEncounter();
        const baseSnapshot = { ...base };
        const allMsgs = await DB.getRecentMessagesByCharId(char.id, getDateContextFetchLimit(char), true);
        const preparedAllMsgs = await materializeVisionDescriptions(allMsgs, apiConfig.visionApi);
        const emojis = await DB.getEmojis();
        const { messages } = await DatePrompts.buildInterludePayload({
            char,
            userProfile,
            allMsgs: preparedAllMsgs,
            emojis,
            description,
            targetAt,
            sceneClockAt: baseSnapshot.sceneClockAt,
            sceneClockAdvancedMs: baseSnapshot.sceneClockAdvancedMs,
            sceneClockRevision: baseSnapshot.sceneClockRevision,
            sceneClockUpdatedAt: baseSnapshot.sceneClockUpdatedAt,
            sceneClockTimeZone: baseSnapshot.sceneClockTimeZone,
            useVisionDescriptions: apiConfig.visionApi?.enabled === true,
        });
        const rawContent = await callLLM(messages, Math.max(apiConfig.temperature ?? 0.85, 0.85));
        if (!isCurrentDateTurnRequest(requestId, baseSnapshot.id, baseSnapshot.sceneClockRevision)) {
            throw new Error('这段过场已过期，请按当前剧情时间重新生成');
        }

        const resolved = DatePrompts.resolveInterludeSceneClock({
            text: rawContent,
            currentAt: baseSnapshot.sceneClockAt,
            currentAdvancedMs: baseSnapshot.sceneClockAdvancedMs,
            targetAt,
            timeZone: baseSnapshot.sceneClockTimeZone,
        });
        const content = resolved.content.replace(/\[\[END_MEETING:\s*[^\]]*\]\]/gi, '').trim();
        if (!content) throw new Error('过场没有生成正文，请重试');

        const next = makeNextClockRuntime(
            baseSnapshot,
            resolved.sceneClockAt,
            resolved.sceneClockAdvancedMs,
        );
        const saved = await DB.saveMessage({
            charId: char.id,
            role: 'assistant',
            type: 'text',
            content,
            metadata: sceneClockMetadata(next, {
                dateTurnKind: 'interlude',
                sceneClockBefore: baseSnapshot.sceneClockAt,
                sceneClockBeforeAdvancedMs: baseSnapshot.sceneClockAdvancedMs,
                sceneClockAfter: next.sceneClockAt,
                sceneClockAdvancedDeltaMs: resolved.sceneClockAdvancedDeltaMs,
                sceneClockResolution: resolved.resolution,
                ...(description.trim() ? { interludeInstruction: description.trim().slice(0, 4000) } : {}),
                ...(targetAt !== undefined && isFiniteNumber(targetAt) ? { interludeTargetAt: targetAt } : {}),
                ...(resolved.requestedSceneClockAt !== undefined ? { requestedSceneClockAt: resolved.requestedSceneClockAt } : {}),
            }),
        });
        const committed = commitSceneClock(char.id, next, {
            encounterId: baseSnapshot.id,
            sceneClockRevision: baseSnapshot.sceneClockRevision,
        });
        if (!committed) {
            await DB.deleteMessage(saved as number).catch(error => {
                console.warn('[DateApp] 清理过期过场消息失败', error);
            });
            throw new Error('这段过场已过期，请按当前剧情时间重新生成');
        }
        markDateTurnDirty({ ...char, activeDateEncounter: getActiveDatePresence(char.id) || undefined });
        await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);
        runMemoryPalacePostHook(char);
        trackEvent('生成一次见面过场', { 结果: resolved.resolution });
        return content;
    };

    // --- Session API Logic ---
    const handleSendMessage = async (text: string): Promise<string | { queued: true; jobId: string }> => {
        if (!char) throw new Error("No char");
        const requestId = beginDateTurnRequest();
        const encounter = ensureEncounter();
        const encounterSnapshot = { ...encounter };

        // 重发场景：如果 DB 里最后一条已经是这条 user 消息（上一轮发送后 API 失败 / 网络抖动等），
        // 就跳过重复落库，直接走 API。与 chat app 行为对齐，让用户按发送键即可重新触发 LLM。
        const recentCheck = await DB.getRecentMessagesByCharIdAndSource(char.id, 'date', 1);
        const isRetry = recentCheck.length > 0
            && recentCheck[0].role === 'user'
            && recentCheck[0].content === text
            && recentCheck[0].metadata?.source === 'date'
            && recentCheck[0].metadata?.dateEncounterId === encounterSnapshot.id;

        let sourceUserMessageId: number;
        if (!isRetry) {
            // 1. Save User Msg
            sourceUserMessageId = await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: text, metadata: sceneClockMetadata(encounterSnapshot, { dateTurnKind: 'dialogue' }) });
            markDateTurnDirty(char);
        } else {
            sourceUserMessageId = recentCheck[0].id;
        }

        // 2. Prepare Context
        // Re-fetch messages. Since we saved the opening in handleEnterSession,
        // 'allMsgs' will now correctly contain: [History..., Opening, UserMsg]
        const allMsgs = await DB.getRecentMessagesByCharId(char.id, getDateContextFetchLimit(char), true);
        const preparedAllMsgs = await materializeVisionDescriptions(allMsgs, apiConfig.visionApi);

        // Update local state for display
        await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);

        const emojis = await DB.getEmojis();
        const { messages } = await DatePrompts.buildSessionPayload({
            char,
            userProfile,
            allMsgs: preparedAllMsgs,
            emojis,
            userText: text,
            variant: 'send',
            sceneClockAt: encounterSnapshot.sceneClockAt,
            sceneClockAdvancedMs: encounterSnapshot.sceneClockAdvancedMs,
            sceneClockRevision: encounterSnapshot.sceneClockRevision,
            sceneClockUpdatedAt: encounterSnapshot.sceneClockUpdatedAt,
            sceneClockTimeZone: encounterSnapshot.sceneClockTimeZone,
            useVisionDescriptions: apiConfig.visionApi?.enabled === true,
        });

        // 普通纯文本回复先尝试交给 AMSG2。pending 必须在 schedule 前写入，
        // 这样即使页面在上传/建任务之间被系统回收，下一次打开仍能恢复这轮。
        const pending = buildPendingDateBackgroundJob({
            char,
            encounter: {
                encounterId: encounterSnapshot.id,
                startedAt: encounterSnapshot.startedAt,
                sceneClockAt: encounterSnapshot.sceneClockAt,
                sceneClockAdvancedMs: encounterSnapshot.sceneClockAdvancedMs,
                sceneClockRevision: encounterSnapshot.sceneClockRevision,
            },
            sourceUserMessageId,
            messages,
        });
        if (pending) {
            const existing = getPendingDateBackgroundJobForEncounter(encounterSnapshot.id);
            if (existing && existing.jobId !== pending.jobId) {
                throw new Error('上一条见面回复仍在后台生成，请等待它完成后再继续');
            }
            if (!existing || existing.jobId === pending.jobId) {
                // 同一条 user 消息重试时复用确定性 jobId，不重复生成另一份快照。
                const currentPending = getPendingDateBackgroundJobForEncounter(encounterSnapshot.id);
                if (!currentPending || currentPending.jobId === pending.jobId) {
                    if (!currentPending) {
                        // 仅在尚未有 pending 时写入；已有 pending 由恢复路径继续调度。
                        savePendingDateBackgroundJob(pending);
                    }
                    const remote = await schedulePendingDateBackgroundJob({
                        jobId: pending.jobId,
                        char,
                        api: apiConfig,
                    });
                    if (remote.status === 'queued' || remote.status === 'uncertain') {
                        setDateBackgroundPendingJobId(pending.jobId);
                        await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);
                        return { queued: true, jobId: pending.jobId };
                    }
                    // Worker 不支持 / 本次探测不到 / 明确建任务失败：本地生成一次，
                    // 不把「没有副作用」的失败误当成已在云端运行。
                    removePendingDateBackgroundJob(pending.jobId);
                }
            }
        }

        const rawContent = await callLLM(messages, apiConfig.temperature ?? 0.85);
        if (!isCurrentDateTurnRequest(requestId, encounterSnapshot.id, encounterSnapshot.sceneClockRevision)) {
            throw new Error('这轮回复已过期，请按当前剧情时间重新发送');
        }
        const endMatch = rawContent.match(/\[\[END_MEETING:\s*([^\]]{1,200})\]\]/i);
        const resolved = resolveDialogueClock(rawContent, encounterSnapshot);
        const content = resolved.content.replace(/\[\[END_MEETING:\s*[^\]]*\]\]/gi, '').trim();
        if (!content) throw new Error('回复没有生成正文，请重试');
        if (endMatch?.[1]?.trim()) setEndSuggestedReason(endMatch[1].trim());

        // 3. 先保存带新检查点的回复，再用 encounter + revision CAS 提交剧情钟。
        // 没有明确推进时沿用旧快照，不增加 revision。
        const nextEncounter = resolved.advanced
            ? makeNextClockRuntime(encounterSnapshot, resolved.sceneClockAt, resolved.sceneClockAdvancedMs)
            : encounterSnapshot;
        const savedMessageId = await DB.saveMessage({
            charId: char.id,
            role: 'assistant',
            type: 'text',
            content,
            metadata: dialogueClockMetadata(encounterSnapshot, nextEncounter, resolved, { dateTurnKind: 'dialogue' }),
        });
        if (resolved.advanced) {
            const committed = commitSceneClock(char.id, nextEncounter, {
                encounterId: encounterSnapshot.id,
                sceneClockRevision: encounterSnapshot.sceneClockRevision,
            });
            if (!committed) {
                await DB.deleteMessage(savedMessageId).catch(error => {
                    console.warn('[DateApp] 清理过期见面回复失败', error);
                });
                throw new Error('这轮回复已过期，请按当前剧情时间重新发送');
            }
        }
        markDateTurnDirty(resolved.advanced
            ? { ...char, activeDateEncounter: getActiveDatePresence(char.id) || undefined }
            : char);

        // Refresh local state
        await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);

        // Memory Palace 后台流程（不阻塞返回，与聊天侧一致）
        runMemoryPalacePostHook(char);

        return content;
    };

    const handleReroll = async (): Promise<string> => {
        if (!char || dateMessages.length === 0) throw new Error("No context");
        const requestId = beginDateTurnRequest();
        const currentEncounter = ensureEncounter();
        const currentEncounterSnapshot = { ...currentEncounter };

        const lastMsg = dateMessages[dateMessages.length - 1];
        if (isDatePhoneBridge(lastMsg) || lastMsg.role !== 'assistant') throw new Error("Cannot reroll user message");

        // Keep the old reply until the replacement request succeeds.
        const allMsgs = await DB.getRecentMessagesByCharId(char.id, getDateContextFetchLimit(char), true);
        const validMsgs = allMsgs.filter(m => m.id !== lastMsg.id);
        const preparedValidMsgs = await materializeVisionDescriptions(validMsgs, apiConfig.visionApi);
        const emojis = await DB.getEmojis();

        // 过场是可重 roll 的：只允许重掷当前时间线最末端的过场，旧的过场不提供
        // 单独入口，避免替换中间检查点后让后续剧情出现两条时间线。
        if (lastMsg.metadata?.dateTurnKind === 'interlude') {
            const beforeAt = isFiniteNumber(lastMsg.metadata?.sceneClockBefore)
                ? lastMsg.metadata.sceneClockBefore
                : currentEncounterSnapshot.sceneClockAt;
            const beforeAdvancedMs = Math.max(0, isFiniteNumber(lastMsg.metadata?.sceneClockBeforeAdvancedMs)
                ? lastMsg.metadata.sceneClockBeforeAdvancedMs
                : Math.max(0, currentEncounterSnapshot.sceneClockAdvancedMs - (Number(lastMsg.metadata?.sceneClockAdvancedDeltaMs) || 0)));
            const targetAt = isFiniteNumber(lastMsg.metadata?.interludeTargetAt)
                ? lastMsg.metadata.interludeTargetAt
                : undefined;
            const { messages } = await DatePrompts.buildInterludePayload({
                char,
                userProfile,
                allMsgs: preparedValidMsgs,
                emojis,
                description: lastMsg.metadata?.interludeInstruction || '',
                targetAt,
                sceneClockAt: beforeAt,
                sceneClockAdvancedMs: beforeAdvancedMs,
                sceneClockRevision: currentEncounterSnapshot.sceneClockRevision,
                sceneClockUpdatedAt: currentEncounterSnapshot.sceneClockUpdatedAt,
                sceneClockTimeZone: currentEncounterSnapshot.sceneClockTimeZone,
                useVisionDescriptions: apiConfig.visionApi?.enabled === true,
                variant: 'reroll',
            });
            const rawContent = await callLLM(messages, Math.max(apiConfig.temperature ?? 0.85, 0.9));
            if (!isCurrentDateTurnRequest(requestId, currentEncounterSnapshot.id, currentEncounterSnapshot.sceneClockRevision)) {
                throw new Error('这段过场已过期，请按当前剧情时间重新生成');
            }
            const resolved = DatePrompts.resolveInterludeSceneClock({
                text: rawContent,
                currentAt: beforeAt,
                currentAdvancedMs: beforeAdvancedMs,
                targetAt,
                timeZone: currentEncounterSnapshot.sceneClockTimeZone,
            });
            const content = resolved.content.replace(/\[\[END_MEETING:\s*[^\]]*\]\]/gi, '').trim();
            if (!content) throw new Error('过场没有生成正文，请重试');
            const next = makeNextClockRuntime(
                currentEncounterSnapshot,
                resolved.sceneClockAt,
                resolved.sceneClockAdvancedMs,
            );
            const newMessageId = await DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'text',
                content,
                metadata: sceneClockMetadata(next, {
                    dateTurnKind: 'interlude',
                    sceneClockBefore: beforeAt,
                    sceneClockBeforeAdvancedMs: beforeAdvancedMs,
                    sceneClockAfter: next.sceneClockAt,
                    sceneClockAdvancedDeltaMs: resolved.sceneClockAdvancedDeltaMs,
                    sceneClockResolution: resolved.resolution,
                    ...(lastMsg.metadata?.interludeInstruction ? { interludeInstruction: lastMsg.metadata.interludeInstruction } : {}),
                    ...(targetAt !== undefined ? { interludeTargetAt: targetAt } : {}),
                    ...(resolved.requestedSceneClockAt !== undefined ? { requestedSceneClockAt: resolved.requestedSceneClockAt } : {}),
                    rerolledFromMessageId: lastMsg.id,
                }),
            });
            const committed = commitSceneClock(char.id, next, {
                encounterId: currentEncounterSnapshot.id,
                sceneClockRevision: currentEncounterSnapshot.sceneClockRevision,
            });
            if (!committed) {
                await DB.deleteMessage(newMessageId).catch(error => console.warn('[DateApp] 清理过期过场重掷消息失败', error));
                throw new Error('这段过场已过期，请按当前剧情时间重新生成');
            }
            await DB.deleteMessage(lastMsg.id);
            markDateTurnDirty({ ...char, activeDateEncounter: getActiveDatePresence(char.id) || undefined });
            trackEvent('重掷见面回复', { 目标: '过场' });
            await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);
            runMemoryPalacePostHook(char);
            return content;
        }

        // 重掷的是开场白（isOpening 锚点消息）：走感知同款 payload 重新生成开场。
        // 不能走下面的普通 reroll 路径——开场白前面没有触发它的 user 消息。旧逻辑会
        // 先删消息再报 "Context lost"（开场白被吞），即使上一条恰好是 user 侥幸续上，
        // 新消息也不带 isOpening，阅读模式会从上一次见面的开场开始切片，表现为
        // 「新见面只有立绘模式是新剧情，阅读模式全是旧剧情」。
        if (lastMsg.metadata?.isOpening === true) {
            const { messages } = DatePrompts.buildPeekPayload({
                char,
                userProfile,
                allMsgs: preparedValidMsgs,
                emojis,
                useVisionDescriptions: apiConfig.visionApi?.enabled === true,
            });
            const content = await callLLM(messages, Math.max(apiConfig.temperature ?? 0.85, 0.9));
            if (!isCurrentDateTurnRequest(requestId, currentEncounterSnapshot.id, currentEncounterSnapshot.sceneClockRevision)) {
                throw new Error('这轮回复已过期，请按当前剧情时间重新生成');
            }
            // 生成成功后才动库：先删旧开场、再带 isOpening 落新开场，请求失败时原剧情不丢
            await DB.deleteMessage(lastMsg.id);
            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content, metadata: sceneClockMetadata(currentEncounterSnapshot, { isOpening: true }) });
            markDateTurnDirty(char);
            trackEvent('重掷见面回复', { 目标: '开场白' });
            // 阅读模式空会话时顶部渲染的开场 & 退出快照里的 peekStatus 同步成新开场
            setPeekStatus(content);

            await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);
            return content;
        }

        const beforeAt = isFiniteNumber(lastMsg.metadata?.sceneClockBefore)
            ? lastMsg.metadata.sceneClockBefore
            : currentEncounterSnapshot.sceneClockAt;
        const beforeAdvancedMs = Math.max(0, isFiniteNumber(lastMsg.metadata?.sceneClockBeforeAdvancedMs)
            ? lastMsg.metadata.sceneClockBeforeAdvancedMs
            : Math.max(0, currentEncounterSnapshot.sceneClockAdvancedMs - (Number(lastMsg.metadata?.sceneClockAdvancedDeltaMs) || 0)));
        const rerollClockBase: DateEncounterRuntime = {
            ...currentEncounterSnapshot,
            sceneClockAt: beforeAt,
            sceneClockAdvancedMs: beforeAdvancedMs,
        };

        const validDateMsgs = preparedValidMsgs.filter(m => m.metadata?.source === 'date');
        const lastUserMsg = validDateMsgs[validDateMsgs.length - 1];
        if (!lastUserMsg || lastUserMsg.role !== 'user') throw new Error("Context lost");

        // Call API logic（与 handleSendMessage 共用 buildSessionPayload，只差 variant）
        // 历史裁到被重掷的那一轮为止：见面回复之后用户又在普通聊天里发过消息时，
        // validMsgs（全来源）的尾巴不是这条 date user，直接传进去会把那条聊天消息当成
        // 「待重发的最后一条」砍掉，同时 date user 又被追加一次（丢一条、重一条）。
        const { messages } = await DatePrompts.buildSessionPayload({
            char,
            userProfile,
            allMsgs: trimHistoryThrough(preparedValidMsgs, lastUserMsg.id),
            emojis,
            userText: lastUserMsg.content,
            variant: 'reroll',
            // 让模型从被替换回复之前的剧情时刻重写，避免 reroll 把旧推进再累计一次。
            sceneClockAt: beforeAt,
            sceneClockAdvancedMs: beforeAdvancedMs,
            sceneClockRevision: currentEncounterSnapshot.sceneClockRevision,
            sceneClockUpdatedAt: currentEncounterSnapshot.sceneClockUpdatedAt,
            sceneClockTimeZone: currentEncounterSnapshot.sceneClockTimeZone,
            useVisionDescriptions: apiConfig.visionApi?.enabled === true,
        });
        // Reroll 略调高温度求多样性，但绝不低于用户配置的基线。
        const rawContent = await callLLM(messages, Math.max(apiConfig.temperature ?? 0.85, 0.9));
        if (!isCurrentDateTurnRequest(requestId, currentEncounterSnapshot.id, currentEncounterSnapshot.sceneClockRevision)) {
            throw new Error('这轮回复已过期，请按当前剧情时间重新生成');
        }
        const endMatch = rawContent.match(/\[\[END_MEETING:\s*([^\]]{1,200})\]\]/i);
        const parsedFromBase = resolveDialogueClock(rawContent, rerollClockBase);
        // 旧回复的推进已经包含在 currentEncounterSnapshot 里。新回复若只重写到
        // 同一时刻，不再增加 revision；若它继续向前，只累计相对当前时刻的增量。
        const resolved = parsedFromBase.advanced && parsedFromBase.sceneClockAt > currentEncounterSnapshot.sceneClockAt
            ? {
                ...parsedFromBase,
                sceneClockAdvancedMs: currentEncounterSnapshot.sceneClockAdvancedMs
                    + (parsedFromBase.sceneClockAt - currentEncounterSnapshot.sceneClockAt),
                sceneClockAdvancedDeltaMs: parsedFromBase.sceneClockAt - currentEncounterSnapshot.sceneClockAt,
            }
            : parsedFromBase.advanced
                ? {
                    ...parsedFromBase,
                    sceneClockAt: currentEncounterSnapshot.sceneClockAt,
                    sceneClockAdvancedMs: currentEncounterSnapshot.sceneClockAdvancedMs,
                    sceneClockAdvancedDeltaMs: 0,
                    advanced: false,
                    resolution: 'unchanged' as const,
                }
                : parsedFromBase;
        const content = resolved.content.replace(/\[\[END_MEETING:\s*[^\]]*\]\]/gi, '').trim();
        if (!content) throw new Error('回复没有生成正文，请重试');
        setEndSuggestedReason(endMatch?.[1]?.trim() || '');

        const nextEncounter = resolved.advanced
            ? makeNextClockRuntime(currentEncounterSnapshot, resolved.sceneClockAt, resolved.sceneClockAdvancedMs)
            : currentEncounterSnapshot;
        // 生成成功后才删旧回复：先保存新回复，再提交时钟，CAS 失败时保留旧剧情。
        const newMessageId = await DB.saveMessage({
            charId: char.id,
            role: 'assistant',
            type: 'text',
            content,
            metadata: dialogueClockMetadata(currentEncounterSnapshot, nextEncounter, resolved, {
                dateTurnKind: 'dialogue',
                rerolledFromMessageId: lastMsg.id,
            }),
        });
        if (resolved.advanced) {
            const committed = commitSceneClock(char.id, nextEncounter, {
                encounterId: currentEncounterSnapshot.id,
                sceneClockRevision: currentEncounterSnapshot.sceneClockRevision,
            });
            if (!committed) {
                await DB.deleteMessage(newMessageId).catch(error => console.warn('[DateApp] 清理过期见面重掷回复失败', error));
                throw new Error('这轮回复已过期，请按当前剧情时间重新发送');
            }
        } else if (!isCurrentDateTurnRequest(requestId, currentEncounterSnapshot.id, currentEncounterSnapshot.sceneClockRevision)) {
            await DB.deleteMessage(newMessageId).catch(error => console.warn('[DateApp] 清理过期见面重掷回复失败', error));
            throw new Error('这轮回复已过期，请按当前剧情时间重新发送');
        }
        await DB.deleteMessage(lastMsg.id);
        markDateTurnDirty(resolved.advanced
            ? { ...char, activeDateEncounter: getActiveDatePresence(char.id) || undefined }
            : char);
        trackEvent('重掷见面回复', { 目标: '回复', 时间结果: resolved.resolution });

        // Sync
        await loadDateMessages(DATE_SESSION_MESSAGE_LIMIT);

        // Memory Palace 后台流程（Reroll 也算一轮新输出）
        runMemoryPalacePostHook(char);

        return content;
    };

    // --- Editing & Deletion ---
    // 删改同样要打脏（对齐 Chat.tsx 的同款处理器）：云端快照里带着最近对话原文，
    // 不刷的话角色到点还会提起这条已经被删掉 / 已经改过的消息。
    const handleDeleteMessage = async (msg: Message) => {
        await DB.deleteMessage(msg.id);
        setDateMessages(prev => prev.filter(m => m.id !== msg.id));
        markDateTurnDirty();
        trackEvent('删除一条见面消息');
    };

    const handleDeleteMessages = async (ids: number[]) => {
        if (ids.length === 0) return;
        await Promise.all(ids.map(id => DB.deleteMessage(id)));
        setDateMessages(prev => prev.filter(m => !ids.includes(m.id)));
        markDateTurnDirty();
        addToast(`已删除 ${ids.length} 条记录`, 'success');
        trackEvent('批量删除见面消息');
    };

    const confirmEditMessage = async () => {
        if (!editTargetMsg) return;
        await DB.updateMessage(editTargetMsg.id, editContent);
        const applyEdit = (m: Message) => m.id === editTargetMsg.id ? { ...m, content: editContent } : m;
        setDateMessages(prev => prev.map(applyEdit));
        setHistoryMessages(prev => prev.map(applyEdit));
        markDateTurnDirty();
        setIsEditModalOpen(false);
        setEditTargetMsg(null);
        addToast('已修改', 'success');
        trackEvent('编辑一条见面消息');
    };

    // --- History Long Press ---
    const handleHistoryLongPressStart = useCallback((msg: Message, e: React.TouchEvent | React.MouseEvent) => {
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        longPressTimer.current = setTimeout(() => {
            setHistoryMenuMsg(msg);
            setHistoryMenuPos({ x: clientX, y: clientY });
        }, 500);
    }, []);

    const handleHistoryLongPressEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleHistoryDelete = async (msg: Message) => {
        await DB.deleteMessage(msg.id);
        setHistoryMessages(prev => prev.filter(m => m.id !== msg.id));
        markDateTurnDirty();
        setHistoryMenuMsg(null);
        addToast('已删除', 'success');
        trackEvent('删除见面记录里的一条消息');
    };

    /** 删除一整次分页/见面：正文、结束标记和同步到信息界面的完结卡片一起移除。 */
    const confirmHistoryGroupDelete = async () => {
        const target = historyDeleteTarget;
        if (!char || !target || historyDeleteBusy) return;
        setHistoryDeleteBusy(true);
        try {
            // 列表可能只加载了最近窗口；删除前完整读取，避免长见面只删掉屏幕上那一部分。
            const allDateMessages = await DB.getRecentMessagesByCharIdAndSource(char.id, 'date', Number.MAX_SAFE_INTEGER);
            const allEncounterGroups = buildDateHistoryGroups(allDateMessages, 'encounter', 'oldest');
            const encounterId = target.messages.find(message => typeof message.metadata?.dateEncounterId === 'string')?.metadata?.dateEncounterId;
            const fullTarget = allEncounterGroups.find(group => group.id === target.id)
                || (encounterId ? allEncounterGroups.find(group => group.messages.some(message => message.metadata?.dateEncounterId === encounterId)) : undefined);
            const resolvedEncounterId = encounterId
                || fullTarget?.messages.find(message => typeof message.metadata?.dateEncounterId === 'string')?.metadata?.dateEncounterId;
            const dateIds = (fullTarget?.messages || target.messages).map(message => message.id);

            // 完结卡片使用独立 source 保存，否则只删正文会留下“见面结束”卡片。
            const popupMessages = resolvedEncounterId
                ? await DB.getRecentMessagesByCharIdAndSource(char.id, 'date-end-popup', Number.MAX_SAFE_INTEGER)
                : [];
            const popupIds = popupMessages
                .filter(message => message.metadata?.dateEncounterId === resolvedEncounterId)
                .map(message => message.id);
            const ids = Array.from(new Set([...dateIds, ...popupIds]));
            await DB.deleteMessages(ids);
            setHistoryMessages(prev => prev.filter(message => !ids.includes(message.id)));
            if (char.savedDateState?.encounterId && char.savedDateState.encounterId === resolvedEncounterId) {
                updateCharacter(char.id, { savedDateState: undefined });
            }
            if (char.activeDateEncounter?.encounterId && char.activeDateEncounter.encounterId === resolvedEncounterId) {
                clearDateEncounter(char.id, resolvedEncounterId);
                if (activeEncounterRef.current?.id === resolvedEncounterId) setEncounterRuntime(null);
            }
            setHistoryDeleteTarget(null);
            setHistorySelectedGroupId(null);
            markDateTurnDirty(char);
            addToast('整次见面已删除', 'success');
            trackEvent('删除整次见面', { 消息数: ids.length });
        } catch (error) {
            console.error('Delete Date Encounter Error', error);
            addToast('整次见面删除失败，请稍后重试', 'error');
        } finally {
            setHistoryDeleteBusy(false);
        }
    };

    const handleHistoryEditOpen = (msg: Message) => {
        setHistoryEditMsg(msg);
        setHistoryEditContent(msg.content);
        setHistoryMenuMsg(null);
    };

    const handleHistoryEditConfirm = async () => {
        if (!historyEditMsg) return;
        await DB.updateMessage(historyEditMsg.id, historyEditContent);
        const applyEdit = (m: Message) => m.id === historyEditMsg.id ? { ...m, content: historyEditContent } : m;
        setHistoryMessages(prev => prev.map(applyEdit));
        setDateMessages(prev => prev.map(applyEdit));
        markDateTurnDirty();
        setHistoryEditMsg(null);
        addToast('已修改', 'success');
        trackEvent('编辑见面记录里的一条消息');
    };

    const onExitSession = (finalState: DateState) => {
        if (historyReplayGroupId) {
            clearDateResumeAttempt();
            setHistoryReplayGroupId(null);
            setHistorySelectedGroupId(null);
            setDateMessages([]);
            setPeekStatus('');
            setHasSavedOpening(false);
            setEndSuggestedReason('');
            setMode('history');
            trackEvent('退出见面回顾');
            // 从聊天的见面完结卡片直接进来的回顾，退出时一步回到那段对话，
            // 跟通话记录卡片的返回行为保持一致，而不是先落到见面记录列表。
            if (cameFromChat) returnToChat();
            return;
        }
        // 用户主动保存并退出 = 干净退出，撤销恢复哨兵。
        clearDateResumeAttempt();
        if (char) {
            const encounter = ensureEncounter();
            const nextEncounter = runtimeFromSource(char, {
                ...finalState,
                encounterId: encounter.id,
                encounterStartedAt: encounter.startedAt,
            }, encounter);
            const presence = activateDateEncounter(char.id, nextEncounter);
            updateCharacter(char.id, {
                savedDateState: {
                    ...finalState,
                    encounterId: nextEncounter.id,
                    encounterStartedAt: nextEncounter.startedAt,
                    sceneClockAt: nextEncounter.sceneClockAt,
                    sceneClockAdvancedMs: nextEncounter.sceneClockAdvancedMs,
                    sceneClockRevision: nextEncounter.sceneClockRevision,
                    sceneClockUpdatedAt: nextEncounter.sceneClockUpdatedAt,
                    sceneClockTimeZone: nextEncounter.sceneClockTimeZone,
                },
                activeDateEncounter: presence,
            });
            setEncounterRuntime(null);
            addToast('进度已保存', 'success');
        }
        // 来自聊天：退出见面回聊天
        if (cameFromChat) { returnToChat(); return; }
        setMode('select');
        setPeekStatus('');
        setHasSavedOpening(false);
    };

    const formatDuration = (durationMs: number) => {
        const minutes = Math.max(1, Math.round(durationMs / 60000));
        if (minutes < 60) return `${minutes} 分钟`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
    };

    /**
     * 结束见面。
     *
     * 这里的顺序是有代价换来的：以前是「读历史 → 等模型写总结 → 存结束卡 → 清状态」，
     * 一条直线全程 await，而 callLLM 既没有超时也没有 AbortSignal。渠道一慢（或者 iOS
     * 把 PWA 挂起），整条链就停在总结那一步——**结束卡没写、见面状态也没清**。用户看到的
     * 就是「我明明结束了，信息界面没有卡片，再点见面还说有未结束的见面」；而云端那边
     * activeDateEncounter 一直是 active，自然主动会被永久闷掉。
     *
     * 现在：读历史和总结都不再是必经关卡，总结另加 20 秒上限，超时/失败一律退回本地
     * 摘要。总结只是锦上添花，不该决定这次见面能不能收尾。
     */
    const finishEncounter = async (finalState: DateState) => {
        if (!char) return;
        const encounter = ensureEncounter();
        await cancelPendingDateBackgroundJobs(encounter.id);
        setDateBackgroundPendingJobId(null);
        const realEndedAt = Date.now();
        // 见面长度和结束卡展示都以剧情时钟为准；现实结束时刻只作为调试/同步留档，
        // 不能把用户离开 App 的时间误当成剧情里经过的时间。
        const sceneEndedAt = isFiniteNumber(finalState.sceneClockAt) ? finalState.sceneClockAt : encounter.sceneClockAt;
        let current: Message[] = [];
        try {
            // 收尾总结不是交互热路径：这里完整读取 date 源，确保任意早期过场都不会
            // 因为后续消息超过 500 条而从见面总结素材里消失。
            const allDate = await DB.getRecentMessagesByCharIdAndSource(char.id, 'date', Number.MAX_SAFE_INTEGER);
            current = allDate.filter(m => m.metadata?.dateEncounterId === encounter.id);
        } catch (error) {
            // 读历史失败也不能卡住收尾：大不了这次的总结简略一点。
            console.warn('[DateApp] 读取见面正文失败，改用简略摘要收尾', error);
        }
        // 总结默认只取最近 30 条以控制请求体，但过场是用户明确插入的时间轴节点，
        // 即使它较早也必须进入总结素材，不能因为后续对话多而被窗口截掉。
        const summaryMessages = current.filter((message, index) => (
            index >= Math.max(0, current.length - 30)
            || message.metadata?.dateTurnKind === 'interlude'
        ));
        const transcript = summaryMessages.map(m => {
            const clean = typeof m.content === 'string'
                ? stripFaceToFacePhoneSourceTags(stripMessageReactionTags(m.content))
                : m.content;
            return `${m.role === 'user' ? userProfile.name || '用户' : char.name}：${clean}`;
        }).join('\n');
        const localSummary = current.length > 0
            ? `你和${char.name}结束了这次见面，共留下 ${current.length} 条现场记录。`
            : `你和${char.name}结束了这次见面。`;
        const sceneTimeLabel = DatePrompts.formatSceneClock(sceneEndedAt, encounter.sceneClockTimeZone);
        let summary = '';
        try {
            // callLLM 自己没有超时，慢渠道会无限期挂着。这一层 race 是收尾流程的保命绳。
            summary = await Promise.race([
                callLLM([
                    { role: 'system', content: `你是见面记录整理器。本次见面结束时的剧情时间是 ${sceneTimeLabel}；如果摘要提到时间，必须以这个剧情时间为准，不要使用用户离开 App 的现实时间。用一段简洁、温柔、忠于原文的中文，概括这次线下见面的地点、共同活动、重要情绪与结束方式。不要虚构，不要加标题，80字以内。` },
                    { role: 'user', content: transcript ? `本次见面结束时的剧情时间：${sceneTimeLabel}\n${transcript}` : '这次见面没有留下更多对话。' },
                ], 0.3),
                new Promise<string>((_, reject) => setTimeout(
                    () => reject(new Error('见面总结超时')), FINISH_SUMMARY_TIMEOUT_MS,
                )),
            ]);
        } catch (error) {
            console.warn('[DateApp] 见面总结生成失败或超时，使用本地摘要', error);
            summary = localSummary;
        }
        if (!summary.trim()) summary = localSummary;
        const durationMs = Math.max(0, sceneEndedAt - encounter.startedAt);
        // 两条结束卡都用 try 包住：写失败最多是少一张卡片，而下面的状态清理必须照走，
        // 否则用户会永远卡在「有未结束的见面」，云端的自然主动也跟着被闷掉。
        try {
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'system',
            content: `见面结束 · ${char.name}`,
            metadata: {
                source: 'date',
                isDateEnding: true,
                dateEncounterId: encounter.id,
                dateEncounterStartedAt: encounter.startedAt,
                dateEncounterEndedAt: sceneEndedAt,
                dateEncounterSceneClockAt: sceneEndedAt,
                dateEncounterRealEndedAt: realEndedAt,
                dateEncounterDurationMs: durationMs,
                dateEncounterDurationText: formatDuration(durationMs),
                dateEncounterSummary: summary.trim(),
                sceneClockAt: sceneEndedAt,
                sceneClockAdvancedMs: encounter.sceneClockAdvancedMs,
                sceneClockRevision: encounter.sceneClockRevision,
                sceneClockUpdatedAt: encounter.sceneClockUpdatedAt,
                ...(encounter.sceneClockTimeZone ? { sceneClockTimeZone: encounter.sceneClockTimeZone } : {}),
            },
        });
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'system',
            content: `见面结束 · ${char.name}`,
            metadata: {
                source: 'date-end-popup',
                dateEncounterId: encounter.id,
                startedAt: encounter.startedAt,
                endedAt: sceneEndedAt,
                realEndedAt,
                sceneClockAt: sceneEndedAt,
                sceneClockTimeZone: encounter.sceneClockTimeZone,
                durationText: formatDuration(durationMs),
                summary: summary.trim(),
                charName: char.name,
                charAvatar: char.avatar,
            },
        });
        } catch (error) {
            console.error('[DateApp] 见面结束卡写入失败，仍继续收尾', error);
            addToast('结束卡片没能保存，但这次见面已经正常结束', 'info');
        }
        clearDateResumeAttempt();
        clearDateEncounter(char.id, encounter.id);
        setEncounterRuntime(null);
        setEndSuggestedReason('');
        // updateCharacter is intentionally async; pass the post-finish snapshot to
        // the first fire_pack sync as well, otherwise one stale pack could still
        // advertise the meeting as active for a short window.
        markDateTurnDirty({ ...char, activeDateEncounter: undefined, savedDateState: undefined });
        addToast('这次见面已完结，并同步到聊天', 'success');
        trackEvent('正式结束一次见面');
        returnToChat();
    };

    // 从选择页直接进设置（不用先进见面再点菜单），改完立绘/观测等即时生效
    const openSettings = (c: CharacterProfile) => {
        setActiveCharacterId(c.id);
        setPreviousMode('select');
        setMode('settings');
        trackEvent('打开见面设置面板', { from: 'select' });
    };

    /**
     * 从分页卡片进入“见面回顾”：完整读取该分页，直接挂载同一套阅读/立绘会话。
     * 回顾只把原消息交给 DateSession，不创建新消息、不恢复未结束存档。
     */
    const openHistoryReplay = async (group: DateHistoryGroup) => {
        if (!char || historyBusy) return;
        setHistoryBusy(true);
        try {
            // 列表可能只加载了最近窗口；回顾必须拿到这一页的完整正文。
            const allDateMessages = await DB.getRecentMessagesByCharIdAndSource(char.id, 'date', Number.MAX_SAFE_INTEGER);
            const allGroups = buildDateHistoryGroups(allDateMessages, historyView, historySortOrder);
            const fullGroup = allGroups.find(candidate => candidate.id === group.id) || group;
            const replayDateMessages = fullGroup.messages.filter(message => message.metadata?.isDateEnding !== true);
            // 按日期的一个分组可能包含多次见面；必须把当天所有 encounterId
            // 一次性交给显示桥接，否则中间场次的线上手机消息会在回顾里消失。
            const encounterIds = Array.from(new Set(
                fullGroup.messages
                    .map(message => message.metadata?.dateEncounterId)
                    .filter((id): id is string => typeof id === 'string' && id.length > 0),
            ));
            const allCharMessages = encounterIds.length ? await DB.getMessagesByCharId(char.id, true) : [];
            const replayMessages = mergeDatePhoneMessages(
                replayDateMessages,
                allCharMessages,
                encounterIds,
                userProfile.name || '用户',
                char.name,
            );
            setHistoryReplayGroupId(fullGroup.id);
            setHistorySelectedGroupId(null);
            setDateMessages(replayMessages);
            setDateLoadLimit(replayDateMessages.length);
            setDateHistoryReachedEnd(true);
            setPeekStatus('');
            setHasSavedOpening(true);
            setEndSuggestedReason('');
            setMode('session');
            trackEvent('打开见面回顾', { 记录: historyView === 'encounter' ? '按次' : '按日期', 消息数: replayDateMessages.length });
        } catch (error) {
            console.error('Open Date History Replay Error', error);
            addToast('见面回顾加载失败，请稍后重试', 'error');
        } finally {
            setHistoryBusy(false);
        }
    };

    const openHistory = async (c: CharacterProfile, focusEncounterId?: string) => {
        setActiveCharacterId(c.id);
        setHistoryReplayGroupId(null);
        setHistoryFocusEncounterId(focusEncounterId || null);
        setHistorySelectedGroupId(null);
        setHistoryQuery('');
        setHistoryDeleteTarget(null);
        // 见面历史按 source=date 独立读取，不受聊天侧记忆宫殿高水位影响。
        const msgs = await DB.getRecentMessagesByCharIdAndSource(c.id, 'date', DATE_HISTORY_MESSAGE_LIMIT);
        setHistoryMessages(msgs);
        setHistoryView('encounter');
        setHistorySortOrder('newest');
        setHistoryLoadLimit(DATE_HISTORY_MESSAGE_LIMIT);
        setHistoryReachedEnd(msgs.length < DATE_HISTORY_MESSAGE_LIMIT);
        setMode('history');
        trackEvent('打开见面记录');
    };

    // 完结卡片携带的 encounterId 由 DateApp 挂载后的下一帧接管，
    // 直接打开对应角色的见面记录，而不是再落到角色选择页。
    useEffect(() => {
        if (!pendingHistoryOpen) return;
        const target = characters.find(c => c.id === pendingHistoryOpen.charId);
        if (!target) return;
        const request = pendingHistoryOpen;
        setPendingHistoryOpen(null);
        void openHistory(target, request.encounterId);
        // openHistory 只负责本次导航，不需要作为稳定依赖；DateApp 挂载后才执行。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingHistoryOpen, characters]);

    useEffect(() => {
        if (mode !== 'history' || !historyFocusEncounterId) return;
        const group = historyGroups.find(candidate => candidate.messages.some(message => message.metadata?.dateEncounterId === historyFocusEncounterId));
        if (!group) return;
        setHistoryFocusEncounterId(null);
        void openHistoryReplay(group);
        // openHistoryReplay 只负责这次回顾导航；列表数据变化不应重复打开。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, historyFocusEncounterId, historyGroups]);

    const handleLoadMoreHistory = async () => {
        if (!char || historyBusy || historyReachedEnd) return;
        const nextLimit = historyLoadLimit + DATE_HISTORY_MESSAGE_LIMIT;
        setHistoryBusy(true);
        try {
            const msgs = await DB.getRecentMessagesByCharIdAndSource(char.id, 'date', nextLimit);
            setHistoryMessages(msgs);
            setHistoryLoadLimit(nextLimit);
            setHistoryReachedEnd(msgs.length < nextLimit);
        } catch (error) {
            console.error('Load Earlier Date History Error', error);
            addToast('更早的见面记录加载失败', 'error');
        } finally {
            setHistoryBusy(false);
        }
    };

    const exportHistoryGroups = async (groups: DateHistoryGroup[], scope: string) => {
        if (!char || groups.length === 0 || historyBusy) return;
        setHistoryBusy(true);
        try {
            const result = await shareOrDownloadFile({
                content: formatDateHistoryExport(char.name, groups, historyView),
                fileName: makeDateHistoryFileName(char.name, scope),
                mimeType: 'text/plain;charset=utf-8',
                shareTitle: `${char.name}的见面记录`,
            });
            addToast(result === 'shared' ? '已打开分享面板' : '见面记录已导出', 'success');
            trackEvent('导出见面记录', { 范围: scope, 整理方式: historyView === 'encounter' ? '按次' : '按日期' });
        } catch (error) {
            console.error('Export Date History Error', error);
            addToast('见面记录导出失败', 'error');
        } finally {
            setHistoryBusy(false);
        }
    };

    const handleExportAllHistory = async () => {
        if (!char || historyBusy) return;
        setHistoryBusy(true);
        try {
            // 导出属于用户主动操作，可以完整扫描该角色消息索引；只收集 source=date，避免把图片聊天读进内存。
            const allDateMessages = await DB.getRecentMessagesByCharIdAndSource(char.id, 'date', Number.MAX_SAFE_INTEGER);
            const allGroups = buildDateHistoryGroups(allDateMessages, historyView, historySortOrder);
            if (allGroups.length === 0) {
                addToast('暂无可导出的见面记录', 'info');
                return;
            }
            const result = await shareOrDownloadFile({
                content: formatDateHistoryExport(char.name, allGroups, historyView),
                fileName: makeDateHistoryFileName(char.name, `全部_${historyView === 'encounter' ? '按次' : '按日期'}`),
                mimeType: 'text/plain;charset=utf-8',
                shareTitle: `${char.name}的全部见面记录`,
            });
            addToast(result === 'shared' ? '已打开分享面板' : '全部见面记录已导出', 'success');
            trackEvent('导出全部见面记录', { 整理方式: historyView === 'encounter' ? '按次' : '按日期' });
        } catch (error) {
            console.error('Export All Date History Error', error);
            addToast('全部见面记录导出失败', 'error');
        } finally {
            setHistoryBusy(false);
        }
    };

    // --- Render ---

    if (meetSurface === 'story' && mode === 'select' && !cameFromChat) {
        return <StoryTheater onSwitchCompanion={() => setMeetSurface('companion')} onClose={closeApp} />;
    }

    if (mode === 'select' || !char) {
        // 6 个角色一页，横向翻页（先按分组筛选，再切页）
        const selectChars = filterCharactersByGroup(characters, characterGroups, selectGroupId);
        const pages: CharacterProfile[][] = [];
        for (let i = 0; i < selectChars.length; i += SELECT_PAGE_SIZE) pages.push(selectChars.slice(i, i + SELECT_PAGE_SIZE));
        if (pages.length === 0) pages.push([]);
        // 浅色主题（参考「小屋 · 小小窝」房间）：薰衣草浅背景 + 柔星点 + 衬线标题 + 罗盘环角色卡
        const th = {
            pageBg: 'linear-gradient(180deg,#efe9f7 0%,#f4eff9 45%,#f7f2fb 100%)',
            stars: 'radial-gradient(1.5px 1.5px at 14% 16%,rgba(190,160,225,.45),transparent),radial-gradient(1px 1px at 80% 12%,rgba(220,190,235,.5),transparent),radial-gradient(1.5px 1.5px at 42% 28%,rgba(180,200,240,.4),transparent),radial-gradient(1px 1px at 86% 42%,rgba(200,175,230,.4),transparent),radial-gradient(1px 1px at 22% 66%,rgba(210,185,235,.35),transparent),radial-gradient(1px 1px at 66% 80%,rgba(200,210,240,.35),transparent)',
            title: '#6a5790', titleShadow: 'rgba(170,150,220,.4)', line: 'rgba(150,120,190,.5)',
            cardBorder: 'rgba(170,140,210,.3)', cardShadow: '0 8px 22px rgba(150,120,200,.18)',
            inner: 'rgba(170,140,210,.22)', gem: 'rgba(190,160,220,.85)',
            tick: 'rgba(170,140,210,.16)', halo: 'rgba(200,175,235,.3)',
            ring1: 'rgba(180,150,215,.5)', ring2: 'rgba(180,150,215,.25)', avGlow: 'rgba(190,160,235,.4)',
        };
        // 每张卡片按序循环的柔色底——粉/薰衣草/浅蓝渐变（同小小窝浅色卡）
        const CARD_TINTS = [
            'linear-gradient(180deg,rgba(250,212,228,.85),rgba(242,228,246,.8))',
            'linear-gradient(180deg,rgba(232,228,248,.85),rgba(242,238,250,.8))',
            'linear-gradient(180deg,rgba(226,216,246,.85),rgba(238,230,249,.8))',
            'linear-gradient(180deg,rgba(212,230,247,.85),rgba(234,240,250,.8))',
            'linear-gradient(180deg,rgba(226,212,245,.85),rgba(238,228,249,.8))',
            'linear-gradient(180deg,rgba(234,231,242,.88),rgba(242,240,247,.82))',
        ];
        return (
            <div className="h-full w-full relative overflow-hidden flex flex-col font-light" style={{ background: th.pageBg }}>
                {/* 柔星点氛围 */}
                <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: th.stars }} />

                {/* 顶栏 + 标题 */}
                <div className="relative z-10 shrink-0" style={{ paddingTop: 'max(1.25rem, var(--safe-top))' }}>
                    <div className="relative flex items-center justify-center px-5 pt-2">
                        <button onClick={() => { if (cameFromChat) { returnToChat(); } else { closeApp(); } }}
                                className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                                style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                            <CaretLeft size={19} weight="bold" />
                        </button>
                        <div className="text-center">
                            <h1 className="text-[26px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: th.title, textShadow: `0 2px 18px ${th.titleShadow}` }}>选择见面对象</h1>
                            <div className="flex items-center justify-center gap-2 mt-1.5">
                                <span className="h-px w-10" style={{ background: `linear-gradient(90deg,transparent,${th.line})` }} />
                                <span className="text-[9px] tracking-[0.4em] font-bold" style={{ color: 'rgba(150,120,190,0.75)' }}>✦ CHOOSE CHARACTER ✦</span>
                                <span className="h-px w-10" style={{ background: `linear-gradient(270deg,transparent,${th.line})` }} />
                            </div>
                        </div>
                    </div>
                    <div className='mx-auto mt-4 mb-3 grid w-[min(18rem,calc(100%-2.5rem))] grid-cols-2 rounded-xl bg-white/45 p-1 shadow-sm'>
                        <button className='rounded-lg bg-white py-2 text-xs font-bold text-[#715d99] shadow-sm'>陪伴</button>
                        <button onClick={() => setMeetSurface('story')} className='rounded-lg py-2 text-xs font-bold text-[#8f7bb5]'>剧情</button>
                    </div>
                    {/* 分组筛选（没建分组时不渲染）。切组后回到第一页 */}
                    <CharacterGroupFilterBar characters={characters} groups={characterGroups} dark
                        value={selectGroupId}
                        onChange={(id) => { setSelectGroupId(id); setSelectPage(0); pagerRef.current?.scrollTo({ left: 0 }); }}
                        className="px-4 mb-3" />
                </div>

                {/* 分页卡片区 */}
                {selectChars.length === 0 ? (
                    <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'rgba(150,120,190,0.7)' }}>
                        <Sparkle size={40} weight="light" />
                        <span className="text-xs tracking-wider">{characters.length ? '该分组下没有角色' : '还没有可见面的角色'}</span>
                    </div>
                ) : (
                    <div ref={pagerRef} onScroll={onPagerScroll}
                         className="relative z-10 flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
                         style={{ scrollSnapType: 'x mandatory' }}>
                        {pages.map((page, pi) => (
                            <div key={pi} className="w-full shrink-0 snap-start h-full overflow-y-auto no-scrollbar px-5 pt-4">
                                <div className="grid grid-cols-2 gap-4 pb-6">
                                    {page.map((c, idx) => {
                                        const tint = CARD_TINTS[(pi * SELECT_PAGE_SIZE + idx) % CARD_TINTS.length];
                                        return (
                                        <div key={c.id} onClick={() => handleCharClick(c)}
                                             className="group relative rounded-2xl px-3 pt-8 pb-5 flex flex-col items-center active:scale-95 transition-all overflow-hidden"
                                             style={{ background: tint, border: `1px solid ${th.cardBorder}`, boxShadow: th.cardShadow }}>
                                            {/* 内描框 + 四角宝石 */}
                                            <div className="absolute inset-[7px] rounded-xl pointer-events-none" style={{ border: `1px solid ${th.inner}` }} />
                                            <span className="absolute top-[10px] left-[10px] w-1.5 h-1.5 rotate-45" style={{ background: th.gem }} />
                                            <span className="absolute top-[10px] right-[10px] w-1.5 h-1.5 rotate-45" style={{ background: th.gem }} />
                                            <span className="absolute bottom-[10px] left-[10px] w-1.5 h-1.5 rotate-45" style={{ background: th.gem }} />
                                            <span className="absolute bottom-[10px] right-[10px] w-1.5 h-1.5 rotate-45" style={{ background: th.gem }} />
                                            {/* 在线徽标 */}
                                            <div className="absolute top-2.5 left-2.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full z-10"
                                                 style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(120,200,160,0.4)', boxShadow: '0 1px 4px rgba(120,90,170,0.12)' }}>
                                                <span className="relative flex h-1.5 w-1.5">
                                                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                                </span>
                                                <span className="text-[8px] font-bold text-emerald-600 tracking-wider">在线</span>
                                            </div>
                                            {/* 设置 / 记录（竖排） */}
                                            <div className="absolute top-2 right-2 flex flex-col gap-1 z-20">
                                                <button onClick={(e) => { e.stopPropagation(); openSettings(c); }} title="布置场景 / 设定立绘 / 观测"
                                                        className="w-7 h-7 rounded-lg text-purple-500 flex items-center justify-center active:scale-90 transition-all"
                                                        style={{ background: 'rgba(255,255,255,0.88)', boxShadow: '0 1px 5px rgba(120,90,170,0.2)' }}>
                                                    <GearSix size={15} weight="fill" />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); openHistory(c); }} title="见面记录"
                                                        className="w-7 h-7 rounded-lg text-purple-500 flex items-center justify-center active:scale-90 transition-all"
                                                        style={{ background: 'rgba(255,255,255,0.88)', boxShadow: '0 1px 5px rgba(120,90,170,0.2)' }}>
                                                    <BookOpen size={15} weight="fill" />
                                                </button>
                                            </div>
                                            {/* 头像 + 罗盘环 + 双层环 + 光晕 */}
                                            <div className="relative w-[92px] h-[92px] flex items-center justify-center mt-1">
                                                <div className="absolute w-[124px] h-[124px] rounded-full" style={{ background: `repeating-conic-gradient(from 0deg, ${th.tick} 0deg 2.4deg, transparent 2.4deg 9deg)`, WebkitMaskImage: 'radial-gradient(circle, transparent 40%, #000 44%, #000 50%, transparent 55%)', maskImage: 'radial-gradient(circle, transparent 40%, #000 44%, #000 50%, transparent 55%)' }} />
                                                <div className="absolute w-[110px] h-[110px] rounded-full" style={{ background: `radial-gradient(circle, ${th.halo}, transparent 62%)` }} />
                                                <div className="absolute inset-[8px] rounded-full" style={{ border: `1px solid ${th.ring1}` }} />
                                                <div className="absolute inset-[12px] rounded-full" style={{ border: `1px solid ${th.ring2}` }} />
                                                <div className="w-[70px] h-[70px] rounded-full overflow-hidden" style={{ boxShadow: `0 0 18px ${th.avGlow}` }}>
                                                    <img src={c.avatar} className="w-full h-full object-cover" alt={c.name} />
                                                </div>
                                                {c.savedDateState && (
                                                    <div title="有存档" className="absolute bottom-0 right-1.5 w-[22px] h-[22px] rounded-full flex items-center justify-center" style={{ background: '#fbbf24', boxShadow: '0 1px 5px rgba(180,120,20,0.4)' }}>
                                                        <Sparkle size={12} weight="fill" className="text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            {/* 名字 + 简介 */}
                                            <span className="mt-3 text-[14px] font-semibold tracking-wide truncate max-w-full" style={{ color: '#4b3b6b', fontFamily: `'Noto Serif SC',serif` }}>{c.name}</span>
                                            <span className="mt-0.5 text-[10px] truncate max-w-full" style={{ color: c.description ? 'rgba(120,95,160,0.78)' : 'rgba(150,130,185,0.6)' }}>{c.description || '走过去见 ta'}</span>
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 页码点 */}
                {pages.length > 1 && (
                    <div className="relative z-10 shrink-0 flex justify-center items-center gap-2 py-3">
                        {pages.map((_, pi) => (
                            <button key={pi} onClick={() => goSelectPage(pi)} aria-label={`第 ${pi + 1} 页`}
                                    className="h-2 rounded-full transition-all"
                                    style={{ width: pi === selectPage ? 24 : 8, background: pi === selectPage ? '#a78bd6' : 'rgba(170,140,210,0.35)' }} />
                        ))}
                    </div>
                )}

                <Modal isOpen={!!pendingSessionChar} title="发现进度" onClose={() => { setPendingSessionChar(null); setPendingMeetingInviteMessageId(undefined); if (cameFromChat) returnToChat(); }} footer={<div className="flex flex-col gap-2 w-full"><div className="flex gap-3 w-full"><button disabled={discardBusy} onClick={handleStartNewSession} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold disabled:opacity-50">新的见面</button><button disabled={discardBusy} onClick={handleResumeSession} className="flex-1 py-3 bg-green-500 text-white rounded-2xl font-bold shadow-lg shadow-green-200 disabled:opacity-50">继续上次</button></div><button disabled={discardBusy} onClick={() => void handleDiscardSession()} className="w-full py-2.5 rounded-2xl text-red-500 text-sm font-bold bg-red-50 disabled:opacity-50">{discardBusy ? '正在丢弃…' : '丢弃这次见面'}</button></div>}>
                    <div className="text-center text-slate-500 text-sm py-4">检测到 {pendingSessionChar?.name} 有未结束的见面。<br/><span className="text-xs text-slate-400 mt-2 block">(存档时间: {pendingSessionChar?.savedDateState?.timestamp ? new Date(pendingSessionChar.savedDateState.timestamp).toLocaleString() : 'Unknown'})</span><span className="text-[11px] text-slate-400 mt-3 block leading-relaxed">只是想测试一下的话，选「丢弃这次见面」：这次的现场记录和结束卡片会一并删掉，角色也会立刻恢复正常的主动联系。</span></div>
                </Modal>
            </div>
        );
    }

    if (mode === 'history') {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-light" onClick={() => historyMenuMsg && setHistoryMenuMsg(null)}>
                <div className="border-b border-slate-200 bg-white sticky top-0 z-10" style={{ paddingTop: 'var(--safe-top)' }}>
                    <div className="h-16 flex items-center justify-between px-4">
                        <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-slate-100"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg></button>
                        <div className="text-center min-w-0">
                            <div className="font-bold text-slate-700">{selectedHistoryGroup ? '见面对话' : '分页记录'}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-36">{char.name}</div>
                        </div>
                        <button
                            onClick={(event) => { event.stopPropagation(); handleExportAllHistory(); }}
                            disabled={historyBusy || historyMessages.length === 0}
                            className="text-xs font-bold text-blue-500 px-2 py-2 -mr-2 rounded-lg hover:bg-blue-50 disabled:opacity-40"
                        >
                            导出全部
                        </button>
                    </div>
                    {!selectedHistoryGroup && <div className="px-4 pb-3 flex items-center gap-2">
                        <div className="flex-1 p-1 rounded-xl bg-slate-100 flex">
                            <button
                                onClick={() => setHistoryView('encounter')}
                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${historyView === 'encounter' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                            >按次</button>
                            <button
                                onClick={() => setHistoryView('date')}
                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${historyView === 'date' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                            >按日期</button>
                        </div>
                        <button
                            onClick={() => setHistorySortOrder(order => order === 'newest' ? 'oldest' : 'newest')}
                            className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-500 whitespace-nowrap"
                            title="切换排序方向"
                        >
                            {historySortOrder === 'newest' ? '新 → 旧' : '旧 → 新'}
                        </button>
                    </div>}
                </div>
                {selectedHistoryGroup ? (
                    <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
                        {!historyReachedEnd && historyMessages.length > 0 && <div className="sticky top-0 z-20 flex justify-center -mx-1 px-1 py-1 pointer-events-none"><button type="button" onClick={handleLoadMoreHistory} disabled={historyBusy} className="pointer-events-auto w-full max-w-sm py-2.5 rounded-2xl border border-slate-200 bg-white/95 shadow-sm text-xs font-bold text-slate-500 disabled:opacity-50">{historyBusy ? '正在加载…' : '加载更早的见面记录'}</button></div>}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex gap-3 justify-between items-center">
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-600 tracking-wide truncate">{historyView === 'encounter' ? formatDateHistoryTime(selectedHistoryGroup.startAt, true) : formatDateHistoryDate(selectedHistoryGroup.startAt)}</div>
                                    <div className="text-[10px] text-slate-400 mt-1">{selectedHistoryGroup.messages.length} 句 · {selectedHistoryGroup.completed ? `已完结${selectedHistoryGroup.durationText ? ` · ${selectedHistoryGroup.durationText}` : ''}` : '进行中/旧存档'}</div>
                                    {selectedHistoryGroup.summary && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{selectedHistoryGroup.summary}</p>}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <button type="button" onClick={(event) => { event.stopPropagation(); exportHistoryGroups([selectedHistoryGroup], `${historyView === 'encounter' ? '本次' : '当天'}_${selectedHistoryGroup.dateKey}`); }} disabled={historyBusy} className="text-[11px] font-bold text-blue-500 bg-blue-50 px-3 py-1.5 rounded-full disabled:opacity-40">导出</button>
                                    {historyView === 'encounter' && <button type="button" onClick={(event) => { event.stopPropagation(); setHistoryDeleteTarget(selectedHistoryGroup); }} disabled={historyBusy || historyDeleteBusy} aria-label="删除整次见面" className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-50 text-rose-500 transition-colors hover:bg-rose-100 disabled:opacity-40"><Trash size={15} weight="bold" /></button>}
                                </div>
                            </div>
                            <div className="p-4 space-y-4">
                                {selectedHistoryGroup.messages.map(m => {
                                    const text = stripFaceToFacePhoneSourceTags(stripMessageReactionTags(m.content || '')
                                        .replace(/\[.*?\]/g, '')
                                        .trim());
                                    return (
                                        <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} select-none`} onTouchStart={(e) => handleHistoryLongPressStart(m, e)} onTouchEnd={handleHistoryLongPressEnd} onTouchMove={handleHistoryLongPressEnd} onMouseDown={(e) => handleHistoryLongPressStart(m, e)} onMouseUp={handleHistoryLongPressEnd} onMouseLeave={handleHistoryLongPressEnd} onContextMenu={(e) => { e.preventDefault(); setHistoryMenuMsg(m); setHistoryMenuPos({ x: e.clientX, y: e.clientY }); }}>
                                            <div className={`max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-slate-500 text-right italic' : 'text-slate-800'}`}>{m.role === 'user' ? <span className="bg-slate-100 px-3 py-2 rounded-xl rounded-tr-none inline-block">{text}</span> : <span>{text || '(无内容)'}</span>}</div>
                                            <div className="text-[9px] text-slate-300 mt-1 px-1">{formatDateHistoryTime(m.timestamp)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-4 pb-20">
                        {!historyReachedEnd && historyMessages.length > 0 && <div className="sticky top-0 z-20 flex justify-center -mx-1 px-1 py-1 mb-2 pointer-events-none"><button type="button" onClick={handleLoadMoreHistory} disabled={historyBusy} className="pointer-events-auto w-full max-w-sm py-2.5 rounded-2xl border border-slate-200 bg-white/95 shadow-sm text-xs font-bold text-slate-500 disabled:opacity-50">{historyBusy ? '正在加载…' : '加载更早的见面记录'}</button></div>}
                        <label className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m0 0A7.5 7.5 0 1 0 6.04 6.04a7.5 7.5 0 0 0 10.61 10.61Z" /></svg>
                            <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索见面日期、摘要或内容…" className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-300" />
                            {historyQuery && <button type="button" onClick={() => setHistoryQuery('')} className="text-slate-300">×</button>}
                        </label>
                        {historyListGroups.length === 0 ? <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2"><BookOpen size={48} className="opacity-50" /><span className="text-xs">{historyQuery ? '没有匹配的分页' : '暂无分页记录'}</span></div> : <div className="space-y-2">
                            {historyListGroups.map((group, index) => {
                                const preview = truncateHistoryPreview(group.summary || group.messages.filter(message => message.role !== 'system').map(message => message.content || '').join(' '));
                                const originalIndex = historyGroups.findIndex(candidate => candidate.id === group.id);
                                const encounterNumber = originalIndex < 0 ? historyListGroups.length - index : (historySortOrder === 'newest' ? historyGroups.length - originalIndex : originalIndex + 1);
                                const dateLabel = group.dateKey.replace(/-/g, '/');
                                const openGroup = () => { if (!historyBusy) void openHistoryReplay(group); };
                                return (
                                    <div
                                        key={group.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={openGroup}
                                        aria-disabled={historyBusy}
                                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openGroup(); } }}
                                        className="group flex min-h-[92px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow-md active:scale-[0.995]"
                                    >
                                        {char.avatar ? <img src={char.avatar} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-sm font-bold text-rose-400">{char.name.slice(0, 1)}</div>}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-bold text-slate-700">{historyView === 'encounter' ? `第 ${encounterNumber} 次见面` : dateLabel}</span>
                                                <span className="shrink-0 text-[10px] text-slate-400">{formatDateHistoryTime(group.startAt, true)}</span>
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{historyView === 'encounter' ? dateLabel : `${group.encounterCount || 1} 次见面`}</div>
                                            <div className="mt-1 max-h-[2.75rem] overflow-hidden text-[11px] leading-[1.35rem] text-slate-500">{preview}</div>
                                            <div className="mt-1 text-[10px] text-slate-400">{group.messages.length} 句 · {group.completed ? `已完结${group.durationText ? ` · ${group.durationText}` : ''}` : '进行中/旧存档'}</div>
                                        </div>
                                        {historyView === 'encounter' && <button type="button" onClick={(event) => { event.stopPropagation(); setHistoryDeleteTarget(group); }} disabled={historyBusy || historyDeleteBusy} aria-label={`删除第 ${encounterNumber} 次见面`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"><Trash size={15} /></button>}
                                        <span className="shrink-0 text-lg text-slate-300">›</span>
                                    </div>
                                );
                            })}
                        </div>}
                    </div>
                )}

                {/* Long-press context menu */}
                {historyMenuMsg && (
                    <div
                        className="fixed z-50 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden animate-fade-in"
                        style={{ top: Math.min(historyMenuPos.y, window.innerHeight - 120), left: Math.min(historyMenuPos.x, window.innerWidth - 140) }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => handleHistoryEditOpen(historyMenuMsg)}
                            className="w-full px-5 py-3 text-sm text-left text-slate-700 hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                            编辑
                        </button>
                        <div className="border-t border-slate-100" />
                        <button
                            onClick={() => handleHistoryDelete(historyMenuMsg)}
                            className="w-full px-5 py-3 text-sm text-left text-red-500 hover:bg-red-50 active:bg-red-100 flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                            删除
                        </button>
                    </div>
                )}

                <Modal
                    isOpen={!!historyDeleteTarget}
                    title="删除整次见面？"
                    onClose={() => { if (!historyDeleteBusy) setHistoryDeleteTarget(null); }}
                    footer={
                        <div className="flex w-full gap-3">
                            <button type="button" onClick={() => setHistoryDeleteTarget(null)} disabled={historyDeleteBusy} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-600 disabled:opacity-50">取消</button>
                            <button type="button" onClick={() => void confirmHistoryGroupDelete()} disabled={historyDeleteBusy} className="flex-1 rounded-2xl bg-rose-500 py-3 font-bold text-white shadow-lg shadow-rose-200 disabled:opacity-50">{historyDeleteBusy ? '删除中…' : '删除整次'}</button>
                        </div>
                    }
                >
                    <p className="py-2 text-sm leading-relaxed text-slate-600">
                        将删除 {historyDeleteTarget ? formatDateHistoryTime(historyDeleteTarget.startAt, true) : '这次'} 的整次见面、结束标记及同步卡片，共 {historyDeleteTarget?.messages.length || 0} 条已加载记录。此操作不可恢复。
                    </p>
                </Modal>

                {/* History edit modal */}
                <Modal isOpen={!!historyEditMsg} title="编辑消息" onClose={() => setHistoryEditMsg(null)} footer={
                    <div className="flex gap-3 w-full">
                        <button onClick={() => setHistoryEditMsg(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">取消</button>
                        <button onClick={handleHistoryEditConfirm} className="flex-1 py-3 bg-blue-500 text-white rounded-2xl font-bold shadow-lg shadow-blue-200">保存</button>
                    </div>
                }>
                    <textarea
                        value={historyEditContent}
                        onChange={(e) => setHistoryEditContent(e.target.value)}
                        className="w-full h-48 p-3 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                </Modal>
            </div>
        );
    }

    if (mode === 'peek') {
        return (
            <div className="h-full w-full bg-black relative flex flex-col font-sans overflow-hidden">
                <div className="pt-24 flex flex-col items-center z-10 shrink-0">
                     <div className="text-xs font-mono text-neutral-500 mb-2 tracking-[0.2em] font-medium">{virtualTime.day.toUpperCase()} {formatTime()}</div>
                     <h2 className="text-4xl font-light text-white tracking-[0.3em] uppercase">{char.name}</h2>
                </div>
                {peekLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center -mt-20 z-10"><div className="w-12 h-[1px] bg-neutral-800 mb-12"></div><div className="w-[1px] h-12 bg-gradient-to-b from-transparent via-white to-transparent animate-pulse mb-6"></div><p className="text-sm font-light text-neutral-500 italic tracking-widest">正在感知...</p></div>
                )}
                {!peekLoading && peekStatus && (
                    <div className="flex-1 min-h-0 flex flex-col px-8 pb-10 z-10 animate-fade-in">
                        <div className="flex-1 overflow-y-auto no-scrollbar mb-8 mask-image-gradient pt-8"><div className="min-h-full flex flex-col justify-center"><p className="text-neutral-300 text-[15px] leading-8 tracking-wide text-justify font-light select-none whitespace-pre-wrap">{peekStatus}</p></div></div>
                        <div className="shrink-0 flex flex-col items-center gap-6">
                             <div className="w-full flex gap-3">
                                 {/* 修改这里：调用 handleEnterSession 确保开场白被保存 */}
                                 <button onClick={handleEnterSession} className="flex-1 h-14 bg-white text-black rounded-full font-bold tracking-[0.1em] text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95 transition-transform hover:bg-neutral-200">走过去 (Approach)</button>
                                 <button onClick={() => { trackEvent('重新感知一次角色状态'); startPeek(char); }} className="w-14 h-14 bg-neutral-800 text-white rounded-full flex items-center justify-center border border-neutral-700 shadow-lg active:scale-90 transition-transform"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg></button>
                             </div>
                             <div className="flex flex-col items-center gap-3 text-[10px] text-neutral-600 font-medium tracking-wider"><button onClick={() => { setPreviousMode('peek'); setMode('settings'); trackEvent('打开见面设置面板', { from: 'peek' }); }} className="hover:text-neutral-400 transition-colors">布置场景 / 设定立绘</button><button onClick={handleBack} className="hover:text-neutral-400 transition-colors">悄悄离开</button></div>
                        </div>
                    </div>
                )}
                {/* 兜底：感知结束但 peekStatus 为空（历史上模型空回复会走到这）——
                    以前这里什么都不渲染，页面只剩角色名的纯黑屏，连退出按钮都没有 */}
                {!peekLoading && !peekStatus && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-8 -mt-20 z-10 animate-fade-in">
                        <p className="text-sm font-light text-neutral-500 italic tracking-widest">未能感知到 {char.name} 的状态</p>
                        <button onClick={() => { trackEvent('重新感知一次角色状态'); startPeek(char); }} className="h-12 px-10 bg-white text-black rounded-full font-bold tracking-[0.1em] text-sm active:scale-95 transition-transform hover:bg-neutral-200">重新感知</button>
                        <button onClick={handleBack} className="text-[10px] text-neutral-600 font-medium tracking-wider hover:text-neutral-400 transition-colors">悄悄离开</button>
                    </div>
                )}
            </div>
        );
    }

    if (mode === 'settings') {
        return <DateSettings char={char} onBack={() => setMode(previousMode)} />;
    }

    if (mode === 'session') {
        return (
            <>
                <DateSession
                    char={char}
                    userProfile={userProfile}
                    messages={dateMessages}
                    peekStatus={historyReplayGroupId ? '' : peekStatus}
                    initialState={historyReplayGroupId ? undefined : char.savedDateState}
                    historyReplay={Boolean(historyReplayGroupId)}
                    encounterId={historyReplayGroupId ? undefined : activeEncounterRuntime?.id}
                    encounterStartedAt={historyReplayGroupId ? undefined : activeEncounterRuntime?.startedAt}
                    sceneClockAt={historyReplayGroupId ? undefined : activeEncounterRuntime?.sceneClockAt}
                    sceneClockAdvancedMs={historyReplayGroupId ? undefined : activeEncounterRuntime?.sceneClockAdvancedMs}
                    sceneClockRevision={historyReplayGroupId ? undefined : activeEncounterRuntime?.sceneClockRevision}
                    sceneClockUpdatedAt={historyReplayGroupId ? undefined : activeEncounterRuntime?.sceneClockUpdatedAt}
                    sceneClockTimeZone={historyReplayGroupId ? undefined : activeEncounterRuntime?.sceneClockTimeZone}
                    dateTimeAwarenessEnabled={char.dateTimeAwarenessEnabled !== false}
                    backgroundPending={historyReplayGroupId ? false : Boolean(dateBackgroundPendingJobId)}
                    onSendMessage={handleSendMessage}
                    onReroll={handleReroll}
                    onInterlude={historyReplayGroupId ? undefined : handleInterlude}
                    onSetSceneClock={historyReplayGroupId ? undefined : handleSetSceneClock}
                    onExit={onExitSession}
                    onEnd={finishEncounter}
                    endSuggestedReason={endSuggestedReason}
                    onEditMessage={(msg) => { setEditTargetMsg(msg); setEditContent(msg.content); setIsEditModalOpen(true); }}
                    onDeleteMessage={handleDeleteMessage}
                    onDeleteMessages={handleDeleteMessages}
                    onSettings={() => {}} // Removed parent state change, DateSession handles it internally now
                    onLoadMoreHistory={handleLoadMoreDateHistory}
                    historyLoadLimit={dateLoadLimit}
                    historyReachedEnd={historyReplayGroupId ? true : dateHistoryReachedEnd}
                />

                {/* 记忆整理中 — 顶部浮动胶囊（与聊天侧外观一致） */}
                {memoryPalaceStatus && (
                    <div
                        className="absolute top-[76px] left-1/2 z-[150] animate-fade-in"
                        style={{ transform: 'translateX(-50%)', pointerEvents: 'none', willChange: 'transform, opacity' }}
                    >
                        <div
                            className="flex items-center gap-2.5 pl-2.5 pr-3.5 py-2 max-w-[18rem]"
                            style={{
                                background: 'rgba(255,255,255,0.88)',
                                borderRadius: 999,
                                border: '1px solid rgba(99,102,241,0.18)',
                                boxShadow: '0 6px 18px -6px rgba(15,23,42,0.22)',
                            }}
                        >
                            <span
                                className="shrink-0 inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-200 animate-spin"
                                style={{ borderTopColor: '#6366f1', animationDuration: '0.9s' }}
                            />
                            <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                                {char.name}正在沉思
                            </span>
                            <span className="text-[10px] text-slate-400 truncate">{memoryPalaceStatus}</span>
                        </div>
                    </div>
                )}

                {/* 记忆整理结果 — 弹窗 */}
                {memoryPalaceResult && (
                    <div
                        className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                        style={{ pointerEvents: 'all', background: 'rgba(15,23,42,0.55)' }}
                        onClick={() => setMemoryPalaceResult(null)}
                    >
                        <div
                            className="w-full max-w-sm max-h-[82vh] overflow-hidden flex flex-col relative"
                            style={{
                                background: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 100%)',
                                borderRadius: 28,
                                border: '1px solid rgba(148,163,184,0.18)',
                                boxShadow: '0 20px 50px -20px rgba(15,23,42,0.35)',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div
                                className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
                                style={{ background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, #6366f1, transparent)' }}
                            />
                            <div className="px-6 pt-7 pb-4 text-center">
                                <div
                                    className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(129,140,248,0.06))',
                                        border: '1px solid rgba(99,102,241,0.15)',
                                    }}
                                >
                                    <span style={{ fontSize: 26 }}>🗂️</span>
                                </div>
                                <div className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6366f1' }}>Memory Palace</div>
                                <p className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>记忆整理完成</p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                    新增 {memoryPalaceResult.stored} 条 · 去重跳过 {memoryPalaceResult.skipped} 条
                                    {memoryPalaceResult.batches.length > 1 && ` · ${memoryPalaceResult.batches.length} 批`}
                                </p>
                                {memoryPalaceResult.batches.some(b => !b.ok) && (
                                    <p className="text-[10px] text-red-500 mt-1">
                                        {memoryPalaceResult.batches.filter(b => !b.ok).map(b => `第 ${b.index} 批失败`).join(', ')}
                                    </p>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2 no-scrollbar">
                                {memoryPalaceResult.memories.map((m, i) => {
                                    const roomMeta: Record<string, { label: string; color: string }> = {
                                        living_room: { label: '客厅', color: '#f59e0b' },
                                        bedroom: { label: '卧室', color: '#8b5cf6' },
                                        study: { label: '书房', color: '#0ea5e9' },
                                        user_room: { label: '用户房间', color: '#ec4899' },
                                        self_room: { label: '自我房间', color: '#10b981' },
                                        attic: { label: '阁楼', color: '#6366f1' },
                                        windowsill: { label: '窗台', color: '#14b8a6' },
                                    };
                                    const meta = roomMeta[m.room] || { label: m.room, color: '#64748b' };
                                    const roomLabel = getRoomLabel(m.room as any, userProfile?.name) || meta.label;
                                    return (
                                        <div
                                            key={i}
                                            className="p-3 rounded-2xl"
                                            style={{
                                                background: 'rgba(255,255,255,0.75)',
                                                border: `1px solid ${meta.color}22`,
                                                boxShadow: `0 2px 8px ${meta.color}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                            }}
                                        >
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                                    style={{ background: `${meta.color}18`, color: meta.color }}
                                                >
                                                    {roomLabel}
                                                </span>
                                                <span className="text-[10px] text-slate-400">{m.mood}</span>
                                                <span className="text-[10px] font-bold ml-auto" style={{ color: '#f59e0b' }}>{'★'.repeat(Math.min(m.importance, 5))}</span>
                                            </div>
                                            <p className="text-[12px] text-slate-700 leading-relaxed">{m.content}</p>
                                            {m.tags.length > 0 && (
                                                <div className="flex gap-1 mt-2 flex-wrap">
                                                    {m.tags.map((t, j) => (
                                                        <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                                            style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b' }}
                                                        >{t}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {memoryPalaceResult.memories.length === 0 && (
                                    <p className="text-center text-xs text-slate-400 py-4">本次未提取到新记忆</p>
                                )}
                            </div>
                            <div className="px-6 pb-6 pt-2">
                                <button
                                    onClick={() => setMemoryPalaceResult(null)}
                                    className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                    style={{
                                        background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                        boxShadow: '0 6px 18px -6px rgba(79,70,229,0.5)',
                                    }}
                                >
                                    确认
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Global Message Edit Modal for Session Mode */}
                <Modal isOpen={isEditModalOpen} title="编辑内容" onClose={() => setIsEditModalOpen(false)} footer={<><button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={confirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed" />
                </Modal>
            </>
        );
    }

    return null;
};

export default DateApp;
