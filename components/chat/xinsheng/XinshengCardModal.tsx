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
    readXinshengHistory,
    sortRoundIds,
    toggleXinshengFavorite,
    type XinshengHistory,
} from '../../../utils/xinsheng/xinshengStore';
import { buildXinshengSystemData, type XinshengSystemData } from '../../../utils/xinsheng/xinshengSystemData';
import { XINSHENG_UPDATED_EVENT, type XinshengUpdatedDetail } from '../../../utils/xinsheng/xinshengEvents';
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
 * （`_favorited` / `_at` / `_preset` 这类下划线开头的）和 `raw`（原始 JSON 备份，
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
    const touchStart = useRef<{ x: number; y: number } | null>(null);

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

    useEffect(() => { if (!isOpen) { setShowList(false); setConfirmClear(false); setFilter('all'); setShowFullText(false); } }, [isOpen]);
    // 切筛选后旧的 index 可能越界
    useEffect(() => { setIndex(i => Math.min(i, Math.max(0, ids.length - 1))); }, [ids.length]);

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

    if (!isOpen) return null;

    // 这条记录生成时抽中过随机预设 → 用它自带的样式渲染，让旧卡保持当时的样子；
    // 否则用角色当前的设置。
    const entryPreset = (current as any)?._preset as
        { displayMode?: 'planner' | 'layout'; layout?: string; customCss?: string } | undefined;
    const displayMode = entryPreset?.displayMode ?? char.xinshengDisplayMode;
    const layoutSrc = entryPreset ? (entryPreset.layout || '') : (char.xinshengLayout || '');
    const cssSrc = entryPreset ? (entryPreset.customCss || '') : (char.xinshengCustomCss || '');
    const isLayout = displayMode === 'layout' && !!layoutSrc.trim();

    return (
        <div className="sully-ui-overlay fixed inset-0 z-[110] flex flex-col animate-fade-in">
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
                className="relative flex-1 overflow-y-auto no-scrollbar px-4"
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
            >
                <div className="mx-auto w-full max-w-[400px]">
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
                    <div className="flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-1.5">
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
                            onClick={() => setShowFullText(false)}
                            className="w-9 h-9 rounded-full bg-white/10 text-white text-[16px] leading-none active:scale-95 transition-transform"
                            aria-label="关闭全文"
                        >×</button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+24px)] space-y-5">
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
        </div>
    );
};

export default XinshengCardModal;
