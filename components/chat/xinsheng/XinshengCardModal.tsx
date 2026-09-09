// 心声卡弹层：点消息头像打开的那个。
//
// 一张卡 = 一轮回复。左右可以翻整段历史（最多 100 条），能收藏、删除、清空，
// 也是进「自定义心声」的入口。和糯叽机的交互一致。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterProfile, UserProfile } from '../../../types';
import type { XinshengEntry } from '../../../utils/xinsheng/xinshengData';
import {
    clearXinshengHistory,
    deleteXinshengEntry,
    listXinshengPresets,
    readXinshengHistory,
    sortRoundIds,
    toggleXinshengFavorite,
    updateXinshengEntryPreset,
    type XinshengHistory,
    type XinshengPreset,
} from '../../../utils/xinsheng/xinshengStore';
import { buildXinshengSystemData, type XinshengSystemData } from '../../../utils/xinsheng/xinshengSystemData';
import { XINSHENG_UPDATED_EVENT, type XinshengUpdatedDetail } from '../../../utils/xinsheng/xinshengEvents';
import { toEntryPreset, type XinshengEntryPreset } from '../../../utils/xinsheng/xinshengRandomPreset';
import XinshengLayoutRenderer from './XinshengLayoutRenderer';
import XinshengCard from './XinshengCard';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    userProfile: UserProfile;
    /** 点了哪一条气泡的头像就先翻到哪一轮；没有就落在最新一条。 */
    targetRoundId?: string | null;
    onOpenSettings: () => void;
}

/** 只在「已收藏」筛选下用。 */
type FilterKey = 'all' | 'favorited';

const relativeTime = (at?: number): string => {
    if (!at) return '';
    const min = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    if (min < 1440) return `${Math.round(min / 60)} 小时前`;
    return `${Math.round(min / 1440)} 天前`;
};

/** 历史列表预览里不该出现的内部字段（下划线开头的都是我们自己挂的簿记字段）。 */
const isInternalKey = (k: string): boolean => k.startsWith('_');

/**
 * 历史列表一行的预览文字。
 *
 * 默认卡（planner）的字段固定是 innerVoice/statusText，优先取它们；但换成自定义
 * 布局预设（比如「浅浅蓝」用的是 talk1~talk6、letterConfession 这类完全不同的字段名）
 * 就一个都取不到——不该直接显示"(无正文字段)"吓用户一跳，那条心声明明是有内容的，
 * 只是字段名不认识。取不到就退而求其次：挑这条记录里**第一个**有值的字符串字段。
 */
const previewText = (entry: XinshengEntry | undefined): string => {
    if (!entry) return '';
    if (entry.innerVoice) return entry.innerVoice;
    if (entry.statusText) return entry.statusText;
    for (const [k, v] of Object.entries(entry)) {
        if (isInternalKey(k)) continue;
        if (typeof v === 'string' && v.trim()) return v;
    }
    return '(无正文字段)';
};

/**
 * 「查看全文」用：把一条心声的全部字段摊平成 `字段名: 值` 列表。
 *
 * 不认布局模板、不套 CSS——布局模板的样式是为了好看，字段一多、字数一长（论坛美化
 * 动辄 27 个字段，长信件字段常有 150~200 字）反而看不全；这里就是纯文字，一次性看完。
 * innerVoice / statusText 排最前面（最常用），其余按写入顺序，内部簿记字段
 * （`_favorited` / `_at` / `_preset` / `_presetOverride` 这类下划线开头的）和 `raw`（原始 JSON 备份，
 * 给排障用，不是给人读的）都不列进来。
 */
const FULL_TEXT_SKIP = new Set(['raw']);
const flattenEntryFields = (entry: XinshengEntry | null): Array<{ key: string; value: string }> => {
    if (!entry) return [];
    const out: Array<{ key: string; value: string }> = [];
    const pushIfPresent = (key: string) => {
        const v = (entry as any)[key];
        if (v != null && String(v).trim()) out.push({ key, value: String(v) });
    };
    pushIfPresent('innerVoice');
    pushIfPresent('statusText');
    for (const [k, v] of Object.entries(entry)) {
        if (k === 'innerVoice' || k === 'statusText') continue;
        if (isInternalKey(k) || FULL_TEXT_SKIP.has(k)) continue;
        if (v == null || v === '') continue;
        out.push({ key: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) });
    }
    return out;
};

const characterPresetSnapshot = (char: CharacterProfile): XinshengEntryPreset => ({
    name: '角色当前设置',
    displayMode: char.xinshengDisplayMode === 'layout' ? 'layout' : 'planner',
    layout: char.xinshengLayout || '',
    customCss: char.xinshengCustomCss || '',
});

const sameEntryPreset = (a: XinshengEntryPreset | undefined, b: XinshengEntryPreset): boolean => (
    !!a
    && a.name === b.name
    && a.displayMode === b.displayMode
    && a.layout === b.layout
    && a.customCss === b.customCss
);

export const XinshengCardModal: React.FC<Props> = ({
    isOpen, onClose, char, userProfile, targetRoundId, onOpenSettings,
}) => {
    const [history, setHistory] = useState<XinshengHistory>({});
    const [index, setIndex] = useState(0);
    const [filter, setFilter] = useState<FilterKey>('all');
    const [showList, setShowList] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [showFullText, setShowFullText] = useState(false);
    const [systemData, setSystemData] = useState<XinshengSystemData | null>(null);
    const [presets, setPresets] = useState<XinshengPreset[]>([]);
    const [presetsLoading, setPresetsLoading] = useState(false);
    const [presetsError, setPresetsError] = useState(false);
    const [showPresetPicker, setShowPresetPicker] = useState(false);
    const [presetTargetRoundId, setPresetTargetRoundId] = useState<string | null>(null);
    const [presetSaving, setPresetSaving] = useState(false);
    const [presetActionError, setPresetActionError] = useState<string | null>(null);
    const [presetNotice, setPresetNotice] = useState<string | null>(null);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const presetSavingRef = useRef(false);

    const ids = useMemo(() => {
        const all = sortRoundIds(Object.keys(history)).filter(id => !!history[id]);
        return filter === 'favorited' ? all.filter(id => history[id]?._favorited) : all;
    }, [history, filter]);

    const current: XinshengEntry | null = ids.length > 0 ? history[ids[Math.min(index, ids.length - 1)]] : null;
    const currentId = ids.length > 0 ? ids[Math.min(index, ids.length - 1)] : null;

    // 打开时读一次历史；targetRoundId 决定落在哪一页（点头像进来就是那一轮）
    useEffect(() => {
        if (!isOpen || !char?.id) return;
        let alive = true;
        (async () => {
            const h = await readXinshengHistory(char.id);
            if (!alive) return;
            setHistory(h);
            const all = sortRoundIds(Object.keys(h));
            const at = targetRoundId ? all.indexOf(targetRoundId) : -1;
            setIndex(at >= 0 ? at : Math.max(0, all.length - 1));
        })();
        return () => { alive = false; };
    }, [isOpen, char?.id, targetRoundId]);

    const loadPresets = useCallback(async () => {
        setPresetsLoading(true);
        setPresetsError(false);
        try {
            setPresets(await listXinshengPresets());
        } catch {
            setPresetsError(true);
        } finally {
            setPresetsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        void loadPresets();
    }, [isOpen, loadPresets]);

    // 系统变量（日期/待办/纪念日/消息数）打开时算一次，不进聊天热路径
    useEffect(() => {
        if (!isOpen || !char?.id) return;
        let alive = true;
        buildXinshengSystemData(char.id).then(d => { if (alive) setSystemData(d); }).catch(() => {});
        return () => { alive = false; };
    }, [isOpen, char?.id]);

    // 卡开着的时候角色又回了一轮 —— 把新的那条接上，但不抢走用户正在看的那一页
    useEffect(() => {
        if (!isOpen) return;
        const onUpdated = (e: Event) => {
            const detail = (e as CustomEvent<XinshengUpdatedDetail>).detail;
            if (!detail || detail.charId !== char?.id) return;
            readXinshengHistory(char.id).then(setHistory).catch(() => {});
        };
        window.addEventListener(XINSHENG_UPDATED_EVENT, onUpdated);
        return () => window.removeEventListener(XINSHENG_UPDATED_EVENT, onUpdated);
    }, [isOpen, char?.id]);

    useEffect(() => {
        if (!isOpen) {
            setShowList(false);
            setConfirmClear(false);
            setFilter('all');
            setShowFullText(false);
            setShowPresetPicker(false);
            setPresetTargetRoundId(null);
            setPresetActionError(null);
            setPresetNotice(null);
        }
    }, [isOpen]);
    // 切筛选后旧的 index 可能越界
    useEffect(() => { setIndex(i => Math.min(i, Math.max(0, ids.length - 1))); }, [ids.length]);
    useEffect(() => { setPresetNotice(null); }, [currentId]);

    // 目标记录被外部删除或用户通过其它入口切走时，不要让选择器继续指向旧 roundId。
    useEffect(() => {
        if (!showPresetPicker || !presetTargetRoundId) return;
        if (!history[presetTargetRoundId] || presetTargetRoundId !== currentId) {
            setShowPresetPicker(false);
            setPresetTargetRoundId(null);
            setPresetActionError(null);
        }
    }, [currentId, history, presetTargetRoundId, showPresetPicker]);

    const go = useCallback((delta: number) => {
        setIndex(i => Math.max(0, Math.min(ids.length - 1, i + delta)));
    }, [ids.length]);

    const onTouchStart = (e: React.TouchEvent) => {
        const t = e.touches[0];
        touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const end = e.changedTouches[0];
        const dx = (end?.clientX ?? start.x) - start.x;
        const dy = (end?.clientY ?? start.y) - start.y;
        // 卡片区域本身要能纵向滚动（长布局模板划到底），一次「划到底」的长距离拖动
        // 免不了带一点横向漂移——只看 |dx| 门槛会把这点漂移误判成翻页手势，划到底突然
        // 跳到上一条/下一条。改成同时看纵向位移：横向必须明显压过纵向（1.5 倍）才算数，
        // 真正的横滑翻页 dy 很小，一眼就能分辨；纵向滚动 dy 本身就大，天然被这个比例挡住。
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        go(dx > 0 ? -1 : 1);
    };

    const openPresetPicker = () => {
        if (!currentId) return;
        setPresetTargetRoundId(currentId);
        setPresetActionError(null);
        setShowPresetPicker(true);
    };

    const applyPreset = useCallback(async (preset: XinshengEntryPreset | null) => {
        if (!char?.id || !presetTargetRoundId || presetSavingRef.current) return;
        presetSavingRef.current = true;
        setPresetSaving(true);
        setPresetActionError(null);
        try {
            const result = await updateXinshengEntryPreset(char.id, presetTargetRoundId, preset);
            if (!result.updated) {
                setPresetActionError('这条心声已经不存在了，请关闭后刷新历史。');
                return;
            }
            setHistory(result.history);
            setShowPresetPicker(false);
            setPresetTargetRoundId(null);
            setPresetNotice(preset
                ? `已为这条心声固定为「${preset.name || '未命名预设'}」`
                : '已恢复这条心声生成时的样式');
        } catch {
            setPresetActionError('保存失败，请再试一次。');
        } finally {
            presetSavingRef.current = false;
            setPresetSaving(false);
        }
    }, [char?.id, presetTargetRoundId]);

    if (!isOpen) return null;

    // 手动覆盖优先；否则使用这条记录生成时保存的快照，最后才回退到角色当前设置。
    const generatedPreset = (current as any)?._preset as XinshengEntryPreset | undefined;
    const manualPreset = (current as any)?._presetOverride as XinshengEntryPreset | undefined;
    const entryPreset = manualPreset || generatedPreset;
    const displayMode = entryPreset?.displayMode ?? char.xinshengDisplayMode;
    const layoutSrc = entryPreset ? (entryPreset.layout || '') : (char.xinshengLayout || '');
    const cssSrc = entryPreset ? (entryPreset.customCss || '') : (char.xinshengCustomCss || '');
    const isLayout = displayMode === 'layout' && !!layoutSrc.trim();
    const currentPresetLabel = manualPreset?.name?.trim()
        ? `手动：${manualPreset.name.trim()}`
        : entryPreset?.name?.trim()
            || (entryPreset ? '生成时的角色设置' : '角色当前设置（未固定）');

    return (
        <div className="sully-ui-layer sully-ui-overlay fixed inset-0 z-[110] flex flex-col animate-fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* 顶栏 */}
            <div className="relative flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 text-white">
                <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold truncate">心声</div>
                    <div className="text-[11px] text-white/60">
                        {ids.length > 0 ? `第 ${Math.min(index, ids.length - 1) + 1} / ${ids.length} 条 · ${relativeTime(current?._at)}` : '暂无心声记录'}
                    </div>
                </div>
                <button
                    onClick={() => setShowList(v => !v)}
                    className="px-3 py-1.5 rounded-full bg-white/15 text-[12px] active:scale-95 transition-transform"
                >历史</button>
                <button
                    onClick={onOpenSettings}
                    className="px-3 py-1.5 rounded-full bg-white/15 text-[12px] active:scale-95 transition-transform"
                >自定义</button>
                <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-white/15 text-[16px] leading-none active:scale-95 transition-transform"
                    aria-label="关闭"
                >×</button>
            </div>

            {/* 卡片区。翻页按钮跟卡片内容放在同一个滚动容器里，靠 CSS sticky 定位——
                短卡片时按钮跟着内容走，紧贴在卡片下方，不会被拉到屏幕最底部那种「找不到」
                的空档；长布局模板划到底之前，按钮会自己粘在屏幕底部，划多深都不挡。
                两头的行为都对，不用在「跟着内容」和「固定在底部」之间二选一。 */}
            <div
                className="sully-ui-body relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden no-scrollbar px-4"
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
            >
                <div className="mx-auto w-full max-w-[400px]">
                    {current && (
                        <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-2xl bg-black/20 text-[10px] text-white/70">
                            <span className="min-w-0 flex-1 truncate">显示预设：{currentPresetLabel}</span>
                            <button
                                onClick={openPresetPicker}
                                className="shrink-0 px-2.5 py-1 rounded-full bg-white/15 text-white active:scale-95 transition-transform"
                            >换预设</button>
                        </div>
                    )}
                    {presetNotice && current && (
                        <div className="mb-2 px-3 py-2 rounded-2xl bg-emerald-400/20 text-[10px] text-emerald-100">
                            {presetNotice}
                        </div>
                    )}
                    {!current ? (
                        <div className="mt-24 text-center text-white/60 text-[13px] leading-relaxed">
                            {filter === 'favorited' ? '还没有收藏的心声' : '暂无心声记录'}
                            <div className="mt-2 text-[11px] text-white/40">
                                {char.xinshengEnabled ? '等 TA 回复一次就会有了' : '心声功能还没开启，点右上角「自定义」打开'}
                            </div>
                        </div>
                    ) : isLayout ? (
                        <XinshengLayoutRenderer
                            layout={layoutSrc}
                            data={current}
                            character={{ name: char.name, image: char.avatar }}
                            customCss={cssSrc}
                            userInfo={{ name: userProfile?.name, avatar: userProfile?.avatar }}
                            systemData={systemData}
                        />
                    ) : (
                        <XinshengCard entry={current} charName={char.name} charAvatar={char.avatar} />
                    )}

                    {/* 翻页 + 收藏 + 删除。sticky bottom-0：卡片比屏幕短时，这一排就停在卡片
                        正下方（自然文档流里的位置，不会被顶到屏幕最底）；卡片比屏幕长、
                        划到这一排本该滚出屏幕的那一刻，它会自己粘住屏幕底边，不需要划到底。
                        不垫背景色——卡片的美化预设五花八门、什么底色都有，一块固定的
                        深色渐变糊在下面只会在浅色模板上显得很突兀（实测过）；每个按钮
                        自己带的 bg-white/15 半透明底色已经够撑住文字可读性了。 */}
                    {current && !showList && (
                        <div className="sticky bottom-0 pt-3 mt-4 flex flex-wrap items-center justify-center gap-2.5 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                            <button
                                onClick={() => go(-1)}
                                disabled={index <= 0}
                                className="w-10 h-10 rounded-full bg-white/15 text-white text-[18px] leading-none disabled:opacity-25 active:scale-95 transition-transform"
                                aria-label="上一条"
                            >‹</button>
                            <button
                                onClick={async () => { if (currentId) setHistory(await toggleXinshengFavorite(char.id, currentId)); }}
                                className={`px-4 h-10 rounded-full text-[12px] active:scale-95 transition-transform ${current._favorited ? 'bg-amber-400 text-white' : 'bg-white/15 text-white'}`}
                            >{current._favorited ? '★ 已收藏' : '☆ 收藏'}</button>
                            <button
                                onClick={async () => {
                                    if (!currentId) return;
                                    setHistory(await deleteXinshengEntry(char.id, currentId));
                                    setIndex(i => Math.max(0, i - 1));
                                }}
                                className="px-4 h-10 rounded-full bg-white/15 text-rose-200 text-[12px] active:scale-95 transition-transform"
                            >删除</button>
                            <button
                                onClick={() => setShowFullText(true)}
                                className="px-4 h-10 rounded-full bg-white/15 text-white text-[12px] active:scale-95 transition-transform"
                            >全文</button>
                            <button
                                onClick={openPresetPicker}
                                className="px-4 h-10 rounded-full bg-white/15 text-white text-[12px] active:scale-95 transition-transform"
                            >换预设</button>
                            <button
                                onClick={() => go(1)}
                                disabled={index >= ids.length - 1}
                                className="w-10 h-10 rounded-full bg-white/15 text-white text-[18px] leading-none disabled:opacity-25 active:scale-95 transition-transform"
                                aria-label="下一条"
                            >›</button>
                        </div>
                    )}
                </div>
            </div>

            {/* 历史列表：底部抽屉 */}
            {showList && (
                <div className="relative bg-white rounded-t-[2rem] shadow-2xl max-h-[58vh] flex flex-col">
                    <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                        <div className="text-[14px] font-bold text-slate-800 flex-1">心声历史</div>
                        {(['all', 'favorited'] as FilterKey[]).map(k => (
                            <button
                                key={k}
                                onClick={() => { setFilter(k); setIndex(0); }}
                                className={`px-3 py-1 rounded-full text-[11px] ${filter === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                            >{k === 'all' ? '全部' : '已收藏'}</button>
                        ))}
                        <button
                            onClick={async () => {
                                if (!confirmClear) { setConfirmClear(true); return; }
                                setHistory(await clearXinshengHistory(char.id));
                                setConfirmClear(false);
                                setIndex(0);
                            }}
                            className={`px-3 py-1 rounded-full text-[11px] ${confirmClear ? 'bg-rose-500 text-white' : 'bg-slate-100 text-rose-400'}`}
                        >{confirmClear ? '确认清空' : '清空'}</button>
                    </div>
                    {/* 「清空」保留收藏 —— 按钮旁写清楚，否则用户以为收藏也没了 */}
                    <div className="px-5 pb-2 text-[10px] text-slate-400">清空会保留已收藏的条目</div>
                    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-1.5">
                        {ids.length === 0 && (
                            <div className="py-8 text-center text-[12px] text-slate-400">
                                {filter === 'favorited' ? '还没有收藏的心声' : '暂无心声记录'}
                            </div>
                        )}
                        {[...ids].reverse().map(id => {
                            const e = history[id];
                            const at = ids.indexOf(id);
                            const active = at === Math.min(index, ids.length - 1);
                            return (
                                <div
                                    key={id}
                                    className={`w-full flex items-center gap-2 px-3.5 py-2.5 rounded-2xl transition-colors ${active ? 'bg-indigo-50 border border-indigo-200' : 'bg-slate-50 border border-transparent'}`}
                                >
                                    <button
                                        onClick={() => { setIndex(at); setShowList(false); }}
                                        className="flex-1 min-w-0 text-left"
                                    >
                                        <div className="flex items-center gap-2">
                                            {e?._favorited && <span className="text-amber-400 text-[11px]">★</span>}
                                            <span className="text-[10px] text-slate-400">{relativeTime(e?._at)}</span>
                                            {active && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500 text-white">当前</span>}
                                        </div>
                                        <div className="mt-1 text-[12px] text-slate-600 line-clamp-2">
                                            {previewText(e)}
                                        </div>
                                    </button>
                                    {/* 直达全文：字数长的预设在这个两行摘要里根本看不全，不用先跳回卡片再点 */}
                                    <button
                                        onClick={() => { setIndex(at); setShowList(false); setShowFullText(true); }}
                                        className="shrink-0 px-2.5 py-1.5 rounded-full bg-white text-slate-500 text-[10px] border border-slate-200 active:scale-95 transition-transform"
                                    >全文</button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 全文页：纯文字，不套任何布局模板的样式——字段多、字数长的预设（论坛美化常见）
                在花哨的卡片布局里会被截断或挤变形，这里就是让人一次性看完、看得清楚。
                自带翻页，不用退出去外面再点头像重进；文字可选中复制。 */}
            {showFullText && current && (
                <div className="fixed inset-0 z-[130] flex flex-col bg-slate-900">
                    <div className="flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
                        <div className="flex-1 min-w-0">
                            <div className="text-[15px] font-bold text-white">心声全文</div>
                            <div className="text-[11px] text-white/50">
                                第 {Math.min(index, ids.length - 1) + 1} / {ids.length} 条 · {relativeTime(current._at)}
                            </div>
                        </div>
                        <button
                            onClick={() => go(-1)}
                            disabled={index <= 0}
                            className="w-9 h-9 rounded-full bg-white/10 text-white text-[18px] leading-none disabled:opacity-25 active:scale-95 transition-transform"
                            aria-label="上一条"
                        >‹</button>
                        <button
                            onClick={() => go(1)}
                            disabled={index >= ids.length - 1}
                            className="w-9 h-9 rounded-full bg-white/10 text-white text-[18px] leading-none disabled:opacity-25 active:scale-95 transition-transform"
                            aria-label="下一条"
                        >›</button>
                        <button
                            onClick={() => { setShowFullText(false); openPresetPicker(); }}
                            className="px-3 h-9 rounded-full bg-white/10 text-white text-[11px] active:scale-95 transition-transform"
                        >换预设</button>
                        <button
                            onClick={() => setShowFullText(false)}
                            className="w-9 h-9 rounded-full bg-white/10 text-white text-[16px] leading-none active:scale-95 transition-transform"
                            aria-label="关闭全文"
                        >×</button>
                    </div>
                    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+24px)] space-y-5">
                        {flattenEntryFields(current).map(({ key, value }) => (
                            <div key={key}>
                                <div className="text-[10px] font-mono tracking-wide text-white/40 mb-1.5">{key}</div>
                                <div className="text-[15px] leading-[1.9] text-white whitespace-pre-wrap break-words select-text">
                                    {value}
                                </div>
                            </div>
                        ))}
                        {flattenEntryFields(current).length === 0 && (
                            <div className="mt-16 text-center text-[13px] text-white/40">这条记录没有可显示的文字字段</div>
                        )}
                    </div>
                </div>
            )}

            {/* 单条历史的显示预设选择器。放在心声卡片自己的 CSS 之外，空白卡也能打开。 */}
            {showPresetPicker && current && (
                <div className="fixed inset-0 z-[140] flex items-end bg-black/55">
                    <button
                        className="absolute inset-0"
                        onClick={() => { if (!presetSaving) setShowPresetPicker(false); }}
                        aria-label="关闭预设选择器"
                    />
                    <div className="relative w-full max-h-[80vh] rounded-t-[2rem] bg-white shadow-2xl flex flex-col">
                        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="text-[15px] font-bold text-slate-800">换这条心声的显示预设</div>
                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">当前：{currentPresetLabel}</div>
                            </div>
                            <button
                                onClick={() => setShowPresetPicker(false)}
                                disabled={presetSaving}
                                className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 text-[12px] disabled:opacity-40"
                            >取消</button>
                        </div>
                        <div className="px-5 pb-2 text-[11px] leading-relaxed text-slate-400">
                            只改变这条历史的布局和 CSS，不会重新生成文字，也不会改角色默认设置。
                        </div>
                        {presetActionError && (
                            <div className="mx-5 mb-2 px-3 py-2 rounded-2xl bg-rose-50 border border-rose-100 text-[11px] leading-relaxed text-rose-600">
                                {presetActionError}
                            </div>
                        )}
                        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] space-y-2">
                            {manualPreset && (
                                <button
                                    onClick={() => void applyPreset(null)}
                                    disabled={presetSaving}
                                    className="w-full px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50 text-left disabled:opacity-50"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="flex-1 text-[13px] font-semibold text-amber-700">恢复生成时样式</span>
                                        <span className="text-[10px] text-amber-500">撤销手动调整</span>
                                    </div>
                                    <div className="mt-1 text-[11px] leading-relaxed text-amber-600">
                                        放弃本条手动覆盖，回到它原本保存的生成快照。
                                    </div>
                                </button>
                            )}
                            <button
                                onClick={() => void applyPreset(characterPresetSnapshot(char))}
                                disabled={presetSaving}
                                className="w-full px-4 py-3 rounded-2xl border border-indigo-200 bg-indigo-50 text-left disabled:opacity-50"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="flex-1 text-[13px] font-semibold text-indigo-700">固定为角色当前设置</span>
                                    <span className="text-[10px] text-indigo-400">默认</span>
                                </div>
                                <div className="mt-1 text-[11px] leading-relaxed text-indigo-400">
                                    保存操作当下的布局 / CSS；以后修改角色默认设置不会影响这条。
                                </div>
                            </button>

                            {presetsLoading && (
                                <div className="py-4 text-center text-[12px] text-slate-400">正在读取预设库…</div>
                            )}
                            {presetsError && (
                                <div className="px-3 py-2 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] leading-relaxed text-amber-600">
                                    预设库读取失败。<button onClick={() => void loadPresets()} className="ml-1 underline">重试</button>
                                </div>
                            )}
                            {!presetsLoading && presets.length === 0 && !presetsError && (
                                <div className="py-4 text-center text-[12px] text-slate-400">
                                    预设库还是空的，可以先去「自定义 → 预设库」导入心声美化。
                                </div>
                            )}
                            {presets.map(p => {
                                const snapshot = toEntryPreset(p);
                                const active = sameEntryPreset(entryPreset, snapshot);
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => void applyPreset(snapshot)}
                                        disabled={presetSaving}
                                        className={`w-full px-4 py-3 rounded-2xl border text-left disabled:opacity-50 ${active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-slate-700">{p.name}</span>
                                            <span className={`shrink-0 text-[10px] ${active ? 'text-indigo-500' : 'text-slate-400'}`}>
                                                {active ? '当前' : p.displayMode === 'layout' ? '布局' : '默认卡'}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-[11px] text-slate-400">
                                            {p.displayMode === 'layout' ? '布局模板 + CSS' : 'Sully 默认卡'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default XinshengCardModal;
