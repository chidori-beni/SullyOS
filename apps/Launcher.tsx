import React, { useMemo, useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { isPaperWallpaper, useOS } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import AppIcon from '../components/os/AppIcon';
import { DB } from '../utils/db';
import { CharacterProfile, Anniversary, AppID, DailySchedule, LauncherBuiltinWidgetId, LauncherPage, LauncherPageLayout, LauncherUserWidget, LauncherWidgetSize, Task } from '../types';
import LauncherUserWidgetView from '../components/os/LauncherUserWidgetView';
import LauncherWidgetSheet, { LauncherBuiltinWidgetSheet } from '../components/os/LauncherWidgetSheet';
import { processImageToBlob } from '../utils/file';
import { putImageBlob } from '../utils/blobRef';
import { ScheduleHomeWidget, ScheduleFullscreenViewer } from '../components/schedule/ScheduleHomeWidget';
import NowPlayingSquareWidget from '../components/os/NowPlayingSquareWidget';
import MobileGameHome from '../components/os/MobileGameHome';
import TamagotchiHome from '../components/os/TamagotchiHome';
import { getDailyScheduleForChar } from '../utils/dailySchedule';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { resolveCharTimeZone } from '../utils/timezone';
import { trackEvent } from '../utils/analytics';
import { chatDetailLaunch } from '../utils/chatDetailLaunch';
import { CALENDAR_DATA_UPDATED_EVENT, eventOccursOnDate, notifyCalendarDataUpdated, sortTasksForCalendar, taskDateKey } from '../utils/calendarIntegration';
import {
    carouselCloneResetIndex,
    carouselLogicalIndex,
    carouselPhysicalIndex,
} from '../utils/circularPaging';
import {
    LAUNCHER_HOME_PAGE_ID,
    LAUNCHER_PINWHEEL_PAGE_ID,
    LAUNCHER_WIDGETS_PAGE_ID,
    addLauncherAppPage,
    canDeleteLauncherAppPage,
    deleteLauncherAppPage,
    moveLauncherApp,
    moveLauncherDockAppToPage,
    moveLauncherPageAppToDock,
    normalizeLauncherPageLayout,
    projectLauncherLayoutToLegacy,
    reorderLauncherDockApps,
    reorderLauncherPages,
} from '../utils/launcherPages';
import {
    addLauncherUserWidget,
    appTargetAfterWidget,
    applyLauncherWidgetAnchors,
    captureLauncherWidgetAnchors,
    hideLauncherBuiltinWidget,
    isLauncherBuiltinWidgetId,
    normalizeHiddenBuiltinWidgets,
    restoreLauncherBuiltinWidget,
    buildLauncherPageSlots,
    launcherWidgetIdFromItemKey,
    launcherWidgetSpan,
    migrateLegacyLauncherWidgets,
    moveLauncherUserWidget,
    normalizeLauncherUserWidgets,
    removeLauncherUserWidget,
    updateLauncherUserWidget,
} from '../utils/launcherUserWidgets';
import { resolveLauncherDropKey, type LauncherDropCandidate } from '../utils/launcherDropTarget';

const CompanionHome = React.lazy(() => import('../components/os/CompanionHome'));

// 页面 id 和组件 key 都是我们自己生成的安全字符（字母数字和 _ . : -）。
// CSS.escape 在 Safari 10+ 都有；万一没有，就把不安全字符剔掉当兜底。
const cssEscape = (value: string): string => (
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/[^A-Za-z0-9_.:-]/g, '')
);

const launcherPageIdAtIndex = (layout: LauncherPageLayout, index: number): string => (
    layout.pages[index]?.id || LAUNCHER_WIDGETS_PAGE_ID
);

const launcherPageIndexById = (layout: LauncherPageLayout, pageId: string): number => {
    if (pageId === LAUNCHER_WIDGETS_PAGE_ID) return layout.pages.length;
    const index = layout.pages.findIndex(page => page.id === pageId);
    return index >= 0 ? index : 0;
};

// --- Isolated Components to prevent full re-renders ---

// 1. Clock Component (Consumes virtualTime)
const DesktopClock = React.memo(() => {
    const { virtualTime, theme } = useOS();
    const contentColor = theme.contentColor || '#ffffff';
    const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate().toString().padStart(2, '0');
    const yearNum = now.getFullYear();

    // 简单问候（基于虚拟时间）
    const greeting = virtualTime.hours < 5 ? 'Good Night'
        : virtualTime.hours < 12 ? 'Good Morning'
        : virtualTime.hours < 18 ? 'Good Afternoon'
        : 'Good Evening';

    const hh = virtualTime.hours.toString().padStart(2, '0');
    const mm = virtualTime.minutes.toString().padStart(2, '0');

    // 动森彩蛋：NookPhone 主屏时钟 —— 问候 + 大号时间(主角) + 星期·日期
    if (theme.skin === 'animalcrossing') {
        const weekdayTitle = dayName.charAt(0) + dayName.slice(1).toLowerCase();
        const monthTitle = monthName.charAt(0) + monthName.slice(1).toLowerCase();
        return (
            <div className="mt-7 mb-5 text-center animate-fade-in select-none">
                <div className="text-[13px] font-extrabold tracking-wide" style={{ color: '#8a7a5c' }}>
                    🍃 {greeting}, Resident
                </div>
                <div className="text-[3.5rem] font-extrabold leading-none mt-1.5 tracking-[2px]" style={{ color: '#8b7355' }}>
                    {hh}<span className="animate-pulse" style={{ color: '#cfcab2' }}>:</span>{mm}
                </div>
                <div className="text-[15px] font-bold mt-1.5" style={{ color: '#725C4E' }}>
                    {weekdayTitle} · {monthTitle} {Number(dateNum)}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col mb-5 mt-5 relative animate-fade-in" style={{ color: contentColor }}>
            {/* 顶部装饰 — 状态胶囊 + 细线 */}
            <div className="flex items-center gap-2 mb-3 opacity-90">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    style={{
                        background: paper ? 'rgba(224,221,215,0.30)' : 'rgba(255,255,255,0.28)',
                        border: paper ? '1px solid rgba(91,72,51,0.07)' : '1px solid rgba(255,255,255,0.18)',
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: paper ? '#788369' : '#4ade80', boxShadow: paper ? 'none' : '0 0 6px #4ade80' }} />
                    <span className="text-[9px] font-bold tracking-[0.2em] uppercase">System Online</span>
                </div>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-current to-transparent opacity-30" />
                <span className="text-[9px] tracking-[0.2em] uppercase opacity-60">{yearNum}</span>
            </div>

            {/* 问候 */}
            <div className="text-[11px] tracking-[0.25em] uppercase opacity-55 font-semibold mb-1">
                {greeting}
            </div>

            {/* 主时钟 */}
            <div className="flex items-end gap-4">
                <div className="relative">
                    <div className={`${paper ? 'text-[5.65rem] font-semibold tracking-[-0.055em] drop-shadow-[0_2px_0_rgba(255,255,255,0.34)]' : 'text-[6.25rem] font-black tracking-tighter drop-shadow-2xl'} leading-[0.84]`}
                        style={{ fontFamily: paper ? `'Iowan Old Style', 'Baskerville', 'Times New Roman', serif` : `'Space Grotesk', 'SF Pro Display', sans-serif`, fontFeatureSettings: '"tnum"' }}>
                        <span>{virtualTime.hours.toString().padStart(2, '0')}</span>
                        <span className="opacity-35 font-thin mx-0.5 animate-pulse">:</span>
                        <span>{virtualTime.minutes.toString().padStart(2, '0')}</span>
                    </div>
                    {/* 细光斑 */}
                    {!paper && <div className="absolute -top-2 -right-3 w-8 h-8 rounded-full pointer-events-none"
                        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)' }} />}
                </div>

                <div className="flex flex-col justify-end pb-2.5 gap-0.5">
                    <div className="text-[10px] font-bold tracking-[0.22em] opacity-85">{dayName}</div>
                    <div className="flex items-baseline gap-1">
                        <div className="text-2xl font-black leading-none" style={{ fontFamily: `'Space Grotesk', sans-serif` }}>{dateNum}</div>
                        <div className="text-[10px] font-bold tracking-[0.2em] opacity-70">{monthName}</div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// 2. Character Widget (Consumes Character Data & Messages)
const CharacterWidget = React.memo(({ 
    char, 
    unreadCount, 
    lastMessage, 
    onClick, 
    contentColor,
    paper = false,
}: { 
    char: CharacterProfile | null, 
    unreadCount: number, 
    lastMessage: string, 
    onClick: () => void,
    contentColor: string,
    paper?: boolean,
}) => {
    const { theme } = useOS();
    const acnh = theme.skin === 'animalcrossing'; // 动森彩蛋：会"说话"的村民卡

    // 动森：村民头像 + AC 对话气泡（显示最近消息，点开聊天）
    if (acnh) {
        return (
            <div className="mb-4 animate-fade-in" onClick={onClick}>
                <div className="flex items-end gap-2.5 cursor-pointer active:scale-[0.98] transition-transform">
                    {/* 村民头像（圆角方块 + 白边） */}
                    <div className="relative w-[60px] h-[60px] shrink-0 rounded-[26%] overflow-hidden bg-[#e8e2d6]"
                        style={{ border: '3px solid #ffffff', boxShadow: '0 4px 10px -2px rgba(61,52,40,0.28)' }}>
                        {char?.avatar
                            ? <img src={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                            : <div className="w-full h-full flex items-center justify-center text-2xl">🍃</div>}
                        {unreadCount > 0 && (
                            <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#fc736d] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ border: '2px solid #fff' }}>
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </div>
                        )}
                    </div>
                    {/* AC 对话气泡 */}
                    <div className="relative flex-1 min-w-0 mb-1">
                        <div className="absolute -left-1.5 bottom-3 w-3 h-3 rotate-45"
                            style={{ background: '#FFFBF2', borderLeft: '2px solid #ece0c8', borderBottom: '2px solid #ece0c8' }} />
                        <div className="relative rounded-2xl px-3.5 py-2.5"
                            style={{ background: '#FFFBF2', border: '2px solid #ece0c8', boxShadow: '0 4px 12px -5px rgba(120,90,40,0.25)' }}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[13px] font-extrabold truncate" style={{ color: '#725d42' }}>{char?.name || 'Resident'}</span>
                                <span className="text-[11px] leading-none">{unreadCount > 0 ? '💬' : '🍃'}</span>
                            </div>
                            <div className="text-[11px] leading-snug line-clamp-2" style={{ color: '#9f8b68' }}>{lastMessage}</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-3 group animate-fade-in">
             <div
                className="relative h-24 w-full overflow-hidden rounded-3xl cursor-pointer transition-transform duration-300 active:scale-[0.98]"
                onClick={onClick}
                style={paper ? {
                    background: 'rgba(224,221,215,0.40)',
                    border: '1px solid rgba(91,72,51,0.07)',
                    boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
                } : acnh ? {
                    background: 'rgb(247,243,223)',
                    border: '2px solid #e8e2d6',
                    boxShadow: '0 8px 24px 0 rgba(61,52,40,0.14)',
                } : {
                    background: 'rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(24px) saturate(1.4)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
             >
                 {/* 背景虚化角色头像（动森模式下省略，避免糊在奶油底上） */}
                 {!acnh && !paper && char?.avatar && (
                     <div className="absolute inset-0 opacity-25 pointer-events-none"
                         style={{
                             backgroundImage: `url(${char.avatar})`,
                             backgroundSize: 'cover',
                             backgroundPosition: 'center',
                             filter: 'blur(30px) saturate(1.6)',
                             transform: 'scale(1.3)',
                         }} />
                 )}

                 <div className="relative flex items-center p-3 gap-3 h-full">
                     {/* 头像 */}
                     <div className={`w-[68px] h-[68px] shrink-0 rounded-2xl overflow-hidden relative ${paper ? 'bg-[#ded2c1]' : 'bg-slate-800'}`}
                         style={{
                             border: paper ? '1px solid rgba(91,72,51,0.14)' : acnh ? '2px solid #e8e2d6' : '1.5px solid rgba(255,255,255,0.25)',
                             boxShadow: paper ? '0 5px 14px rgba(91,72,51,0.13)' : acnh ? '0 4px 12px -4px rgba(61,52,40,0.25)' : '0 4px 14px rgba(0,0,0,0.25)',
                         }}>
                         {char ? (
                             <img src={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                         ) : <div className="w-full h-full bg-white/10 animate-pulse" />}
                         {unreadCount > 0 ? (
                            <div className="absolute bottom-0.5 right-0.5 min-w-[16px] h-[16px] px-1 bg-red-500 rounded-full border border-white/30 shadow-sm flex items-center justify-center text-[9px] font-bold text-white">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </div>
                         ) : (
                            <div className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border-2 border-white/60" style={{ background: paper ? '#788369' : '#4ade80', boxShadow: paper ? 'none' : '0 0 6px #4ade80' }}></div>
                         )}
                     </div>

                     {/* 文本 */}
                     <div className="flex-1 min-w-0 flex flex-col justify-center gap-1" style={{ color: contentColor }}>
                         <div className="flex items-center gap-1.5">
                             <h3 className={`text-[15px] font-bold tracking-wide truncate ${paper ? '' : 'drop-shadow-md'}`}>
                                 {char?.name || 'NO SIGNAL'}
                             </h3>
                             {unreadCount > 0 ? (
                                 <div className="px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-[0.15em]"
                                     style={{ background: 'rgba(239,68,68,0.9)', color: 'white' }}>NEW</div>
                             ) : (
                                 <div className="px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-[0.15em]"
                                     style={paper ? { background: 'rgba(120,131,105,0.16)', color: '#68725b' } : acnh ? { background: '#7cba4c', color: 'white' } : { background: 'rgba(255,255,255,0.18)' }}>Online</div>
                             )}
                         </div>
                         <div className="text-xs font-medium leading-relaxed opacity-85 flex items-start gap-1.5">
                            <span
                                aria-hidden="true"
                                className="shrink-0 mt-[0.42em] opacity-45"
                                style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: '4px solid currentColor' }}
                            />
                            <span className="line-clamp-2">{lastMessage}</span>
                         </div>
                     </div>
                 </div>
             </div>
        </div>
    );
});

// 3. Grid Page Component
// App 图标和用户自己加的图片组件混排在同一个 4 列网格里：组件用 grid span 占格，
// 顺序由 buildLauncherPageSlots 按同一条排序轴算出来（见 utils/launcherUserWidgets.ts）。
const AppGridPage = React.memo(({
    apps,
    pageId,
    openApp,
    editing = false,
    userWidgets = [],
    paper = false,
    acnh = false,
    contentColor = '#ffffff',
}: {
    apps: typeof INSTALLED_APPS,
    pageId: string,
    openApp: (id: AppID) => void,
    editing?: boolean,
    userWidgets?: readonly LauncherUserWidget[],
    paper?: boolean,
    acnh?: boolean,
    contentColor?: string,
}) => {
    const appById = useMemo(() => new Map(apps.map(app => [String(app.id), app])), [apps]);
    const slots = useMemo(
        () => buildLauncherPageSlots({ id: pageId, appIds: apps.map(app => String(app.id)) }, userWidgets),
        [apps, pageId, userWidgets],
    );
    return (
        <div
            data-launcher-page-drop={pageId}
            data-launcher-page-kind="app"
            className="grid grid-cols-4 content-start place-items-center gap-y-5 gap-x-2 pb-8 animate-fade-in relative min-h-[5rem]"
            // 组件靠 grid-row: span N 撑高度，所以行高必须统一；minmax 保证图标那行
            // 仍能按自身内容长高（字体放大 / 长 App 名不会被裁）。
            style={{ gridAutoRows: 'minmax(4.75rem, auto)' }}
        >
             {slots.map(slot => {
                 if (slot.kind === 'widget') {
                     const span = launcherWidgetSpan(slot.widget.size);
                     return (
                         <div
                            key={slot.key}
                            data-launcher-item={slot.key}
                            data-launcher-kind="uwidget"
                            data-launcher-page-id={pageId}
                            className={`relative min-w-0 place-self-stretch ${editing ? 'launcher-edit-item' : ''}`}
                            style={{ gridColumn: `span ${span.cols}`, gridRow: `span ${span.rows}` }}
                         >
                             <LauncherUserWidgetView
                                widget={slot.widget}
                                editing={editing}
                                paper={paper}
                                acnh={acnh}
                                contentColor={contentColor}
                             />
                         </div>
                     );
                 }
                 const app = appById.get(slot.appId);
                 if (!app) return null;
                 return (
                     <div
                        key={app.id}
                        data-launcher-item={app.id}
                        data-launcher-kind="app"
                        data-launcher-page-id={pageId}
                        className={`relative transition-transform duration-200 active:scale-95 ${editing ? 'launcher-edit-item' : ''}`}
                     >
                         <AppIcon
                            app={app}
                            onClick={() => { if (!editing) openApp(app.id); }}
                            size="md"
                         />
                     </div>
                 );
             })}
        </div>
    );
});

// 3b. Small 2x2 app grid for pinwheel cells
const AppQuadGrid = React.memo(({ apps, pageId, openApp, editing = false }: { apps: typeof INSTALLED_APPS, pageId: string, openApp: (id: AppID) => void, editing?: boolean }) => {
    return (
        <div data-launcher-page-drop={pageId} data-launcher-page-kind="app" className="w-full h-full min-h-[5rem] grid grid-cols-2 grid-rows-2 place-items-center gap-x-2 gap-y-3">
            {apps.map(app => (
                <div key={app.id} data-launcher-item={app.id} data-launcher-kind="app" data-launcher-page-id={pageId} className={`relative transition-transform duration-200 active:scale-95 ${editing ? 'launcher-edit-item' : ''}`}>
                    <AppIcon app={app} onClick={() => { if (!editing) openApp(app.id); }} />
                </div>
            ))}
        </div>
    );
});

// 3c. Square image slot for pinwheel (bottom-right)
const DesktopSquareImage = React.memo(({ image, contentColor, onClick, acnh = false }: {
    image?: string,
    contentColor: string,
    onClick: () => void,
    acnh?: boolean,
}) => {
    const { theme } = useOS();
    const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
    return (
        <div
            onClick={onClick}
            className="relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer animate-fade-in transition-transform active:scale-[0.98]"
            style={paper ? {
                background: image ? 'rgba(224,221,215,0.26)' : 'rgba(224,221,215,0.38)',
                border: '1px solid rgba(91,72,51,0.07)',
                boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
                color: contentColor,
            } : acnh ? {
                background: image ? 'rgb(247,243,223)' : 'rgb(247,243,223)',
                border: '2px solid #e8e2d6',
                boxShadow: '0 6px 18px rgba(61,52,40,0.12)',
                color: contentColor,
            } : {
                background: image ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
                color: contentColor,
            }}
        >
            {image ? (
                <img src={image} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: paper ? 'rgba(120,131,105,0.10)' : 'rgba(255,255,255,0.1)', border: paper ? '1px solid rgba(91,72,51,0.12)' : '1px solid rgba(255,255,255,0.16)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-4 h-4 opacity-70">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                    </div>
                    <div className="text-[8.5px] uppercase font-bold tracking-[0.22em] opacity-55">Add Image</div>
                    <div className="text-[8.5px] opacity-40 leading-tight">从 外观 · 启动器组件<br/>设置一张方图</div>
                </div>
            )}
        </div>
    );
});

type LauncherPageManagerProps = {
    pages: LauncherPage[];
    appById: Map<string, (typeof INSTALLED_APPS)[number]>;
    paper: boolean;
    onAddPage: () => void;
    onDeletePage: (pageId: string) => void;
    onClose: () => void;
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
};

// The page overview is intentionally a separate interaction surface. A page
// drag must never bubble into the carousel's App drag/page-turn state machine.
const LauncherPageManager = React.memo(({
    pages,
    appById,
    paper,
    onAddPage,
    onDeletePage,
    onClose,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: LauncherPageManagerProps) => {
    const pageNumber = new Map<string, number>();
    let appPageNumber = 0;
    pages.forEach(page => {
        if (page.kind === 'app') {
            appPageNumber += 1;
            pageNumber.set(page.id, appPageNumber);
        }
    });

    return (
        <div
            className="absolute inset-0 z-[60] flex flex-col px-4 pt-[calc(var(--safe-top)+0.85rem)] pb-5"
            style={{
                background: paper ? 'rgba(247,244,238,0.96)' : 'rgba(25,25,35,0.94)',
                color: paper ? '#594d42' : '#fff',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
        >
            <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                    <div className="text-base font-bold tracking-wide">页面管理</div>
                    <div className="text-[10px] opacity-60 mt-1">按住页面缩略图拖动换顺序；App 可跨页拖动</div>
                </div>
                <button
                    type="button"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={onClose}
                    className="shrink-0 rounded-full px-3.5 py-2 text-xs font-bold active:scale-95"
                    style={{ background: paper ? 'rgba(120,131,105,0.14)' : 'rgba(255,255,255,0.15)' }}
                >
                    完成
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-3">
                <div className="grid grid-cols-2 gap-3">
                    {pages.map(page => {
                        const isHome = page.kind === 'home';
                        const isPinwheel = page.kind === 'pinwheel';
                        const title = isHome ? '主页' : isPinwheel ? '快捷页' : `App 页 ${pageNumber.get(page.id) || ''}`;
                        const previewApps = page.appIds
                            .slice(0, 8)
                            .map(id => appById.get(id))
                            .filter(Boolean) as typeof INSTALLED_APPS;
                        return (
                            <div
                                key={page.id}
                                data-launcher-page-tile={page.id}
                                data-launcher-page-locked={isHome ? 'true' : undefined}
                                role="button"
                                aria-label={`移动${title}`}
                                className="relative rounded-2xl p-2.5 select-none"
                                style={{
                                    touchAction: isHome ? 'auto' : 'none',
                                    background: paper ? 'rgba(224,221,215,0.50)' : 'rgba(255,255,255,0.10)',
                                    border: paper ? '1px solid rgba(91,72,51,0.10)' : '1px solid rgba(255,255,255,0.16)',
                                    boxShadow: paper ? '0 4px 12px rgba(91,72,51,0.06)' : '0 6px 18px rgba(0,0,0,0.12)',
                                }}
                            >
                                <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
                                    <span className="text-[11px] font-bold truncate">{title}</span>
                                    <div className="flex items-center gap-1.5">
                                        {isHome && <span className="text-[9px] opacity-50">固定</span>}
                                        {isPinwheel && <span className="text-[9px] opacity-50">不可删除</span>}
                                        {page.kind === 'app' && (
                                            <button
                                                type="button"
                                                aria-label={`删除${title}`}
                                                onPointerDown={e => e.stopPropagation()}
                                                onClick={e => { e.stopPropagation(); onDeletePage(page.id); }}
                                                className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold active:scale-90"
                                                style={{ background: 'rgba(220,70,70,0.85)', color: '#fff' }}
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="relative min-h-[7.2rem] rounded-xl flex items-start justify-center overflow-hidden"
                                    style={{ background: paper ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.06)' }}>
                                    {isHome && (
                                        <div className="absolute left-2 top-2 text-[8px] uppercase tracking-[0.18em] opacity-45">Clock · Character</div>
                                    )}
                                    {isPinwheel && (
                                        <div className="absolute left-2 top-2 text-[8px] uppercase tracking-[0.18em] opacity-45">Schedule · Shortcuts</div>
                                    )}
                                    <div className="pointer-events-none grid grid-cols-4 gap-x-0.5 gap-y-0.5 pt-6 px-1 scale-[0.62] origin-top">
                                        {previewApps.map(app => (
                                            <div key={app.id} className="flex justify-center">
                                                <AppIcon app={app} onClick={() => {}} size="sm" hideLabel />
                                            </div>
                                        ))}
                                    </div>
                                    {previewApps.length === 0 && (
                                        <span className="self-center text-[10px] opacity-45">空白页面</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    <div
                        data-launcher-page-end="true"
                        className="relative rounded-2xl p-2.5 opacity-65"
                        style={{
                            background: paper ? 'rgba(224,221,215,0.28)' : 'rgba(255,255,255,0.06)',
                            border: paper ? '1px dashed rgba(91,72,51,0.18)' : '1px dashed rgba(255,255,255,0.18)',
                        }}
                    >
                        <div className="text-[11px] font-bold mb-2 px-0.5">Widgets</div>
                        <div className="min-h-[7.2rem] rounded-xl flex items-center justify-center text-[10px] opacity-60"
                            style={{ background: paper ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.04)' }}>
                            固定在最后
                        </div>
                    </div>

                    <button
                        type="button"
                        onPointerDown={e => e.stopPropagation()}
                        onClick={onAddPage}
                        className="min-h-[10.1rem] rounded-2xl flex flex-col items-center justify-center gap-2 text-xs font-bold active:scale-[0.98]"
                        style={{
                            background: paper ? 'rgba(120,131,105,0.11)' : 'rgba(255,255,255,0.10)',
                            border: paper ? '1px dashed rgba(120,131,105,0.36)' : '1px dashed rgba(255,255,255,0.28)',
                        }}
                    >
                        <span className="text-2xl leading-none opacity-70">＋</span>
                        新增空白页
                    </button>
                </div>
            </div>

            <div className="pt-3 text-[10px] leading-relaxed opacity-55 text-center">
                主页和 Widgets 为系统页面；快捷页不能删除，但可以和普通 App 页换顺序。
            </div>
        </div>
    );
});

const CALENDAR_WEEKDAYS = [
    { key: 'sun', label: 'S' },
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
] as const;

// 4. Widget Page Component (Calendar + checkable user todos)
const WidgetsPage = React.memo(({ contentColor, openApp, anniversaries, tasks, characters, onToggleTask, acnh = false, paper = false, carouselClone = false }: any) => {
    // 动森：奶油卡片样式（替代暗色玻璃）
    const acCard = acnh ? { background: 'rgb(247,243,223)', border: '2px solid #e8e2d6', boxShadow: '0 6px 18px rgba(61,52,40,0.12)' } : undefined;
    const acDot = acnh ? '#6fba2c' : undefined;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthName = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][currentMonth];
    
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
    
    const totalDays = getDaysInMonth(currentYear, currentMonth);
    const startOffset = getFirstDayOfMonth(currentYear, currentMonth);
    
    const calendarDays = Array.from({ length: totalDays }, (_, i) => i + 1);
    const paddingDays = Array.from({ length: startOffset }, () => null);

    const todayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const visibleTasks = useMemo(
        () => sortTasksForCalendar((tasks as Task[]).filter(task => !task.isCompleted && taskDateKey(task) === todayStr)).slice(0, 5),
        [tasks, todayStr]
    );

    return (
        <div
            className="w-full flex-shrink-0 snap-center snap-always flex flex-col px-6 pt-24 pb-8 space-y-6 h-full overflow-y-auto no-scrollbar"
            data-launcher-carousel-clone={carouselClone ? 'true' : undefined}
        >
              <div className={`rounded-3xl p-6 ${acnh ? 'shadow-sm' : paper ? '' : 'bg-white/25 border border-white/25 shadow-xl'}`} style={paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid rgba(91,72,51,0.07)', boxShadow: '0 5px 16px rgba(91,72,51,0.05)' } : acCard}>
                  <div className="flex justify-between items-center mb-4" style={{ color: contentColor }}>
                      <h3 className="text-xl font-bold tracking-widest">{monthName} {currentYear}</h3>
                      <div onClick={() => openApp('schedule')} className={`p-2 rounded-full cursor-pointer transition-colors ${acnh ? 'bg-[#82D5BB]/30 hover:bg-[#82D5BB]/50' : paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/20 hover:bg-white/40'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-3 gap-x-1 text-center mb-2">
                      {CALENDAR_WEEKDAYS.map(day => <div key={day.key} className="text-[10px] font-bold opacity-40" style={{ color: contentColor }}>{day.label}</div>)}
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-2 gap-x-1 text-center">
                      {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}
                      {calendarDays.map(day => {
                          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isToday = day === now.getDate();
                          const hasEvent = anniversaries.some((a: any) => eventOccursOnDate(a, dateStr))
                              || tasks.some((task: Task) => taskDateKey(task) === dateStr);
                          
                          return (
                              <div key={day} className="flex flex-col items-center justify-center h-8 relative">
                                  <div
                                    className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium ${isToday ? (acnh ? 'text-white font-bold' : paper ? 'text-white font-bold' : 'bg-white text-black font-bold shadow-lg') : 'opacity-80'}`}
                                    style={isToday ? (acnh ? { background: '#19c8b9' } : paper ? { background: '#788369', boxShadow: '0 4px 10px rgba(91,72,51,0.14)' } : {}) : { color: contentColor }}
                                  >
                                      {day}
                                  </div>
                                  {hasEvent && <div className="w-1.5 h-1.5 rounded-full absolute bottom-0 shadow-sm border border-black/10" style={{ background: acDot || (paper ? '#a66f52' : '#c084fc') }}></div>}
                              </div>
                          );
                      })}
                  </div>
              </div>

              <div className={`rounded-3xl p-5 flex flex-col flex-1 min-h-[200px] ${acnh ? 'shadow-sm' : paper ? '' : 'bg-white/25 border border-white/25 shadow-xl'}`} style={paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid rgba(91,72,51,0.07)', boxShadow: '0 5px 16px rgba(91,72,51,0.05)' } : acCard}>
                  <div className="mb-4 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-60" style={{ color: contentColor }}>
                          <span className="h-2 w-2 rounded-full" style={{ background: acDot || (paper ? '#788369' : '#7dd3fc') }} /> Today's To-dos
                      </h3>
                      <button onClick={() => openApp('schedule')} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${paper ? 'bg-[#788369]/10' : 'bg-white/15'}`} style={{ color: contentColor }}>查看日历</button>
                  </div>
                  <div className="space-y-2">
                      {visibleTasks.length > 0 ? visibleTasks.map((task: Task) => (
                          <button
                              key={task.id}
                              onClick={(event) => { event.stopPropagation(); onToggleTask(task); }}
                              className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition active:scale-[0.98] ${acnh ? 'bg-[#efe7d4] border border-[#e0d6c0]' : paper ? 'bg-[#f3ecdf]/70 border border-[#5b4833]/10' : 'bg-white/5 border border-white/10'}`}
                          >
                              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${paper ? 'border-[#788369]/50' : 'border-white/50'}`} style={{ color: contentColor }} />
                                  <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-bold" style={{ color: contentColor }}>{task.title}</span>
                                      <span className="block truncate text-[10px] opacity-50" style={{ color: contentColor }}>
                                      {taskDateKey(task) < todayStr ? '已到期' : taskDateKey(task) === todayStr ? '今天' : taskDateKey(task)}{task.dueTime ? ` · ${task.dueTime}` : ''}
                                  </span>
                              </span>
                          </button>
                      )) : <div className="py-8 text-center text-xs opacity-30" style={{ color: contentColor }}>今天没有待办</div>}
                  </div>
              </div>
        </div>
    );
});

// --- Persist scroll page across remounts (e.g. returning from apps) ---
let _lastPageIndex = 0;
const LAUNCHER_HOME_RESET_EVENT = 'sullyos-launcher-home-reset';
const LAUNCHER_HOME_RESET_PENDING_KEY = 'sullyos_launcher_home_reset_pending_v1';
// A PWA can keep this module alive while it is backgrounded. Do not restore the
// last in-app page after that kind of relaunch/resume: the user should land on
// the actual home page, not whichever page happened to be visible before iOS
// suspended the document. Internal App -> Launcher remounts stay unaffected.
let _pageNeedsHomeAfterBackground = false;
let _launcherLifecycleTrackingAttached = false;

const ensureLauncherLifecycleTracking = () => {
  if (_launcherLifecycleTrackingAttached || typeof document === 'undefined' || typeof window === 'undefined') return;
  _launcherLifecycleTrackingAttached = true;
  const markHomeResetPending = () => { _pageNeedsHomeAfterBackground = true; };
  const markBackgrounded = () => {
    if (document.visibilityState === 'hidden') _pageNeedsHomeAfterBackground = true;
  };
  // The effect can run while the document is already hidden (for example when
  // iOS restores a suspended PWA), so do not wait for a second visibility event.
  markBackgrounded();
  window.addEventListener(LAUNCHER_HOME_RESET_EVENT, markHomeResetPending);
  document.addEventListener('visibilitychange', markBackgrounded);
  window.addEventListener('pagehide', () => { _pageNeedsHomeAfterBackground = true; });
};

const hasPendingLauncherHomeReset = () => {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(LAUNCHER_HOME_RESET_PENDING_KEY) === '1'; } catch { return false; }
};

const clearPendingLauncherHomeReset = () => {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(LAUNCHER_HOME_RESET_PENDING_KEY); } catch { /* ignore */ }
};

// --- Main Launcher ---

const Launcher: React.FC = () => {
  const { openApp, characters, activeCharacterId, theme, updateTheme, addToast, lastMsgTimestamp, isDataLoaded, unreadMessages } = useOS();
  useEffect(() => {
    ensureLauncherLifecycleTracking();
  }, []);

  // Local state for widget data to prevent context trashing
  const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
  const [scheduleCharId, setScheduleCharId] = useState<string | null>(null);
  const [scheduleViewerOpen, setScheduleViewerOpen] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [pageManagerOpen, setPageManagerOpen] = useState(false);
  const layoutPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutPointer = useRef<{
      pointerId: number;
      key: string;
      kind: string;
      pageId?: string;
      x: number;
      y: number;
      active: boolean;
      element: HTMLElement;
      ghost?: HTMLElement;
      grabOffsetX?: number;
      grabOffsetY?: number;
      /** 是否真的挪动过——组件「长按不动就松手」等于要求打开编辑面板。 */
      moved?: boolean;
      /**
       * 落点格子的量好的矩形，按页缓存。
       * 拖动期间页面不重排（ghost 是 fixed，源格子留在原位），所以一次量完就够；
       * 每个 pointermove 都去读 20 个 getBoundingClientRect 会强制重排，手机上会卡。
       */
      dropCache?: {
          pageId: string;
          scrollLeft: number;
          items: LauncherDropCandidate[];
          elements: Map<string, HTMLElement>;
          kinds: Map<string, string>;
      };
      lastTarget?: {
          kind: string;
          pageId?: string;
          key: string;
      };
      targetElement?: HTMLElement;
  } | null>(null);
  const suppressLayoutClickUntil = useRef(0);
  const layoutPageTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutPageTurnDirection = useRef<-1 | 0 | 1>(0);
  const pageManagerOpenRef = useRef(false);
  const pagePointer = useRef<{
      pointerId: number;
      pageId: string;
      x: number;
      y: number;
      element: HTMLElement;
      targetPageId?: string;
      targetElement?: HTMLElement;
      ghost?: HTMLElement;
  } | null>(null);
  useEffect(() => { pageManagerOpenRef.current = pageManagerOpen; }, [pageManagerOpen]);

  // Capture the page at this Launcher mount before the browser can emit an
  // initial scroll event for the leading clone. That event reports the last
  // physical page and must not turn a fresh home launch into the calendar.
  const mountPageIndexRef = useRef(_lastPageIndex);
  const carouselInitializedRef = useRef(false);
  const carouselReadyRef = useRef(false);
  // PhoneShell marks the lock-screen phase before Launcher mounts. This covers
  // iOS recreating the React tree while retaining the JavaScript module/global.
  const homeResetAtMountRef = useRef(hasPendingLauncherHomeReset());
  const [activePageIndex, setActivePageIndex] = useState(mountPageIndexRef.current);
  const activePageIndexRef = useRef(mountPageIndexRef.current);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const visiblePageIdRef = useRef<string>(LAUNCHER_HOME_PAGE_ID);

  // Mouse Drag Logic refs
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftRef = useRef(0);
  const dragMoved = useRef(0);
  const touchActive = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pagination Logic
  // 跟随 DevDebug 可用性：prod 用户在设置页连点 5 下解锁后，CharCreatorDev 立刻出现；
  // 点「关闭」/ 刷新（prod 自动失效）也立刻消失。useMemo deps 没列 devDebugVisible
  // 会让它锁在 mount 时的初值。
  const [devDebugVisible, setDevDebugVisible] = useState(() => isDevDebugAvailable());
  useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);
  const availableGridApps = useMemo(() => {
    return INSTALLED_APPS.filter(app =>
      // 「捏脸·开发」仅在开发模式（右下角开发徽标可见或手动解锁时）显示
      app.id !== AppID.CharCreatorDev || devDebugVisible
    );
  }, [devDebugVisible]);

  const availableGridIds = useMemo(() => availableGridApps.map(app => app.id), [availableGridApps]);

  const hasLauncherMediaPage = Boolean(
      theme.launcherWidgets?.['tl']
      || theme.launcherWidgets?.['tr']
      || theme.launcherWidgets?.['wide']
      || theme.desktopDecorations?.length
  );
  const [launcherPageLayout, setLauncherPageLayout] = useState<LauncherPageLayout>(() => normalizeLauncherPageLayout(
      theme.launcherPageLayout,
      availableGridIds,
      theme.launcherAppOrder,
      {
          showMediaPage: hasLauncherMediaPage,
          legacyDockOrder: theme.launcherDockOrder,
          defaultDockIds: DOCK_APPS,
      },
  ));
  const [launcherDockOrder, setLauncherDockOrder] = useState<string[]>(() => [...(launcherPageLayout.dockAppIds || [])]);
  const [pinwheelOrder, setPinwheelOrder] = useState<Array<'music' | 'appsA' | 'appsB' | 'image'>>(() => {
      const available = ['music', 'appsA', 'appsB', 'image'] as const;
      const saved = theme.launcherPinwheelOrder || [];
      return [...saved.filter((id, index) => available.includes(id) && saved.indexOf(id) === index), ...available.filter(id => !saved.includes(id))];
  });
  const launcherPageLayoutRef = useRef(launcherPageLayout);
  const launcherDockOrderRef = useRef(launcherDockOrder);
  const pinwheelOrderRef = useRef(pinwheelOrder);
  const pendingCarouselPageIdRef = useRef<string | null>(null);

  // ── 用户自己加的桌面图片组件 ───────────────────────────────────────────
  // theme.launcherUserWidgets 是真相；编辑期间用本地草稿，松手后 persist 回 theme
  // （和 App 顺序 / Dock 完全一样的两段式，避免每次拖动都写 localStorage）。
  const [userWidgets, setUserWidgets] = useState<LauncherUserWidget[]>(
      () => normalizeLauncherUserWidgets(theme.launcherUserWidgets),
  );
  const userWidgetsRef = useRef(userWidgets);
  useEffect(() => { userWidgetsRef.current = userWidgets; }, [userWidgets]);
  const [widgetSheet, setWidgetSheet] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [builtinWidgetSheet, setBuiltinWidgetSheet] = useState<LauncherBuiltinWidgetId | null>(null);
  const [hiddenBuiltinWidgets, setHiddenBuiltinWidgets] = useState<LauncherBuiltinWidgetId[]>(
      () => normalizeHiddenBuiltinWidgets(theme.launcherHiddenBuiltinWidgets),
  );
  const hiddenBuiltinWidgetsRef = useRef(hiddenBuiltinWidgets);
  useEffect(() => { hiddenBuiltinWidgetsRef.current = hiddenBuiltinWidgets; }, [hiddenBuiltinWidgets]);
  const [widgetBusy, setWidgetBusy] = useState(false);
  /** 正在拖动某个格子。拖动期间顶部工具条要让开，别挡住落点也别被误点到「完成」。 */
  const [layoutDragActive, setLayoutDragActive] = useState(false);
  const legacyWidgetMigrationRef = useRef(false);

  useEffect(() => {
      if (layoutEditing) return;
      const next = normalizeLauncherPageLayout(
          theme.launcherPageLayout,
          availableGridIds,
          theme.launcherAppOrder,
          {
              showMediaPage: hasLauncherMediaPage,
              legacyDockOrder: theme.launcherDockOrder,
              defaultDockIds: DOCK_APPS,
          },
      );
      launcherPageLayoutRef.current = next;
      setLauncherPageLayout(next);
      const nextDock = [...(next.dockAppIds || [])];
      launcherDockOrderRef.current = nextDock;
      setLauncherDockOrder(nextDock);
  }, [availableGridIds, hasLauncherMediaPage, layoutEditing, theme.launcherAppOrder, theme.launcherDockOrder, theme.launcherPageLayout]);
  useEffect(() => { launcherPageLayoutRef.current = launcherPageLayout; }, [launcherPageLayout]);
  useEffect(() => { launcherDockOrderRef.current = launcherDockOrder; }, [launcherDockOrder]);
  useEffect(() => { pinwheelOrderRef.current = pinwheelOrder; }, [pinwheelOrder]);
  useEffect(() => {
      if (layoutEditing) return;
      const available = ['music', 'appsA', 'appsB', 'image'] as const;
      const saved = theme.launcherPinwheelOrder || [];
      const next = [...saved.filter((id, index) => available.includes(id) && saved.indexOf(id) === index), ...available.filter(id => !saved.includes(id))];
      pinwheelOrderRef.current = next;
      setPinwheelOrder(next);
  }, [layoutEditing, theme.launcherPinwheelOrder]);

  // 组件可以落在任意一张真实页上（含风车页——那页移除自带格子后正好空出地方）；
  // 只有最后那张合成的 Widgets 日历页不在列。
  const widgetCapablePageIds = useMemo(
      () => launcherPageLayout.pages.map(page => page.id),
      [launcherPageLayout],
  );

  useEffect(() => {
      if (layoutEditing) return;
      const next = normalizeLauncherUserWidgets(
          theme.launcherUserWidgets,
          widgetCapablePageIds,
          widgetCapablePageIds[0] || LAUNCHER_HOME_PAGE_ID,
      );
      setUserWidgets(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layoutEditing, theme.launcherUserWidgets, widgetCapablePageIds]);

  useEffect(() => {
      if (layoutEditing) return;
      const next = normalizeHiddenBuiltinWidgets(theme.launcherHiddenBuiltinWidgets);
      setHiddenBuiltinWidgets(prev => (prev.join(' ') === next.join(' ') ? prev : next));
  }, [layoutEditing, theme.launcherHiddenBuiltinWidgets]);

  // 一次性迁移：外观定制里那三个固定槽位（tl / tr / wide）搬成可拖动的组件。
  // 必须把剩余槽位显式写回去（哪怕是空对象），否则 updateTheme 不会去删 widget_* 资产，
  // 下次启动加载资产时旧图会被合并回 theme.launcherWidgets 复活。
  useEffect(() => {
      if (legacyWidgetMigrationRef.current || !isDataLoaded) return;
      const pages = launcherPageLayoutRef.current.pages;
      const target = pages.find(page => page.kind === 'app' && page.showMedia)
          || pages.find(page => page.kind === 'app')
          || pages[0];
      if (!target) return;
      // 不能一进来就把闸拉上：theme 里的旧槽位是启动时从 IndexedDB 资产补进来的，
      // 第一次跑这个 effect 时可能还没到。migrate 本身幂等（没得搬就返回 null），
      // 所以闸只在真的搬完之后才拉。
      const migration = migrateLegacyLauncherWidgets(
          theme.launcherWidgets,
          normalizeLauncherUserWidgets(theme.launcherUserWidgets),
          target.id,
      );
      if (!migration) return;
      legacyWidgetMigrationRef.current = true;
      setUserWidgets(migration.widgets);
      userWidgetsRef.current = migration.widgets;
      void updateTheme({
          launcherUserWidgets: migration.widgets,
          launcherWidgets: migration.legacyWidgets,
      });
      addToast('旧的桌面小组件已搬到主界面，长按桌面即可编辑', 'success');
  }, [addToast, isDataLoaded, theme.launcherUserWidgets, theme.launcherWidgets, updateTheme]);

  const appById = useMemo(() => new Map(availableGridApps.map(app => [app.id, app])), [availableGridApps]);

  const dockAppsConfig = useMemo(() => {
      const byId = new Map(INSTALLED_APPS.map(app => [app.id, app]));
      return launcherDockOrder.map(id => byId.get(id as AppID)).filter(Boolean) as typeof INSTALLED_APPS;
  }, [launcherDockOrder]);

  // Home is a 4x5 page, the pinwheel carries two 2x2 app groups, and each
  // user-created page is another four-column grid. The Widgets page is a
  // fixed synthetic page rendered after this persisted list.
  const pinwheelPage = launcherPageLayout.pages.find(page => page.kind === 'pinwheel');
  const page2Apps = pinwheelPage ? pinwheelPage.appIds : [];
  const page2QuadA = useMemo(
      () => page2Apps.slice(0, 4).map(id => appById.get(id as AppID)).filter(Boolean) as typeof INSTALLED_APPS,
      [appById, page2Apps],
  );
  const page2QuadB = useMemo(
      () => page2Apps.slice(4, 8).map(id => appById.get(id as AppID)).filter(Boolean) as typeof INSTALLED_APPS,
      [appById, page2Apps],
  );

  // Total pages = persisted App pages + one fixed Widgets page.
  const totalPages = launcherPageLayout.pages.length + 1;

  useEffect(() => { activePageIndexRef.current = activePageIndex; }, [activePageIndex]);

  useEffect(() => {
      const loadData = async () => {
          // SAFEGUARD: If characters array is empty, reset widget char
          if (!characters || characters.length === 0) {
              setWidgetChar(null);
              setLastMessage('No Character Connected');
              setAnniversaries([]);
              setTasks([]);
              return;
          }

          const targetChar = characters.find(c => c.id === activeCharacterId) || characters[0];
          setWidgetChar(targetChar);

          try {
              const [msgs, annis, storedTasks] = await Promise.all([
                  DB.getMessagesByCharId(targetChar.id),
                  DB.getAllAnniversaries(),
                  DB.getAllTasks()
              ]);
              
              if (msgs.length > 0) {
                  const visibleMsgs = msgs.filter(m => m.role !== 'system');
                  if (visibleMsgs.length > 0) {
                      const last = visibleMsgs[visibleMsgs.length - 1];
                      const cleanContent = last.content.replace(/\[.*?\]/g, '').trim();
                      setLastMessage(cleanContent || (last.type === 'image' ? '[图片]' : '[消息]'));
                  } else {
                      setLastMessage(targetChar.description || "System Ready.");
                  }
              } else {
                  setLastMessage(targetChar.description || "System Ready.");
              }
              setAnniversaries(annis);
              setTasks(sortTasksForCalendar(storedTasks));
          } catch (e) {
              console.error(e);
          }
      };
      
      if (isDataLoaded) {
          loadData();
      }
  }, [activeCharacterId, lastMsgTimestamp, isDataLoaded, characters]); // Trigger on characters change

  useEffect(() => {
      const reloadCalendar = () => {
          Promise.all([DB.getAllTasks(), DB.getAllAnniversaries()]).then(([storedTasks, storedEvents]) => {
              setTasks(sortTasksForCalendar(storedTasks));
              setAnniversaries(storedEvents);
          }).catch(error => console.error('Launcher calendar reload failed', error));
      };
      window.addEventListener(CALENDAR_DATA_UPDATED_EVENT, reloadCalendar);
      return () => window.removeEventListener(CALENDAR_DATA_UPDATED_EVENT, reloadCalendar);
  }, []);

  const handleWidgetTaskToggle = useCallback(async (task: Task) => {
      const updated: Task = { ...task, isCompleted: true, completedAt: Date.now() };
      await DB.saveTask(updated);
      setTasks(current => current.map(item => item.id === task.id ? updated : item));
      notifyCalendarDataUpdated();
      trackEvent('首页组件完成待办');
  }, []);

  // Schedule widget data loading (shown below SpecialMoments icon)
  const scheduleChar = useMemo(() => {
      if (!characters || characters.length === 0) return null;
      if (scheduleCharId) return characters.find(c => c.id === scheduleCharId) || characters[0];
      return characters.find(c => c.id === activeCharacterId) || characters[0];
  }, [characters, scheduleCharId, activeCharacterId]);
  const scheduleDateKey = useLocalDateKey(resolveCharTimeZone(scheduleChar));

  useEffect(() => {
      if (!scheduleChar || !isDataLoaded) return;
      getDailyScheduleForChar(scheduleChar).then(s => setScheduleData(s)).catch(() => {});
  }, [scheduleChar, isDataLoaded, scheduleDateKey]);

  const jumpCarouselInstant = useCallback((scroller: HTMLDivElement, left: number) => {
      // `behavior: 'auto'` still follows CSS scroll-behavior on Safari. Clear
      // the inline smooth style and assign scrollLeft directly so clone
      // normalisation cannot animate through every middle page a second time.
      const previousBehavior = scroller.style.scrollBehavior;
      scroller.style.scrollBehavior = 'auto';
      scroller.scrollLeft = left;
      requestAnimationFrame(() => {
          if (scrollContainerRef.current === scroller) {
              scroller.style.scrollBehavior = previousBehavior || 'smooth';
          }
      });
  }, []);

  // Restore scroll position BEFORE paint to avoid visible flash/slide.
  // Retry until the container has a width; iOS can finish the boot/safe-area
  // handoff one frame after Launcher itself mounts.
  useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (!el || totalPages <= 0) return;
      let frame = 0;
      let settleFrame = 0;
      const restore = () => {
          if (scrollContainerRef.current !== el || totalPages <= 0) return;
          if (el.clientWidth <= 0) {
              frame = requestAnimationFrame(restore);
              return;
          }

          // A background/resume is a new home launch. Returning from an App
          // while the document stayed visible still restores the last page.
          const pendingPageId = pendingCarouselPageIdRef.current;
          const rememberedIndex = pendingPageId
              ? launcherPageIndexById(launcherPageLayout, pendingPageId)
              : carouselInitializedRef.current
                  ? _lastPageIndex
                  : mountPageIndexRef.current;
          const logicalIndex = homeResetAtMountRef.current || _pageNeedsHomeAfterBackground
              ? 0
              : Math.max(0, Math.min(totalPages - 1, rememberedIndex));
          const physicalIndex = carouselPhysicalIndex(logicalIndex, totalPages);
          activePageIndexRef.current = logicalIndex;
          setActivePageIndex(logicalIndex);
          _lastPageIndex = logicalIndex;
          visiblePageIdRef.current = launcherPageIdAtIndex(launcherPageLayout, logicalIndex);
          carouselReadyRef.current = false;
          jumpCarouselInstant(el, el.clientWidth * physicalIndex);

          // A direct scroll can still be clamped to 0 if the browser has not
          // laid out all flex children yet. Keep initialization locked until
          // the requested real page is actually reachable; otherwise the
          // leading calendar clone can win the first onScroll event.
          const settle = () => {
              if (scrollContainerRef.current !== el || totalPages <= 0) return;
              const width = el.clientWidth;
              if (width <= 0) {
                  settleFrame = requestAnimationFrame(settle);
                  return;
              }
              const expectedLeft = width * carouselPhysicalIndex(logicalIndex, totalPages);
              if (Math.abs(el.scrollLeft - expectedLeft) > 2) {
                  jumpCarouselInstant(el, expectedLeft);
                  settleFrame = requestAnimationFrame(settle);
                  return;
              }
              carouselInitializedRef.current = true;
              homeResetAtMountRef.current = false;
              _pageNeedsHomeAfterBackground = false;
              clearPendingLauncherHomeReset();
              pendingCarouselPageIdRef.current = null;
              carouselReadyRef.current = true;
          };
          settleFrame = requestAnimationFrame(settle);
      };
      restore();
      return () => {
          cancelAnimationFrame(frame);
          cancelAnimationFrame(settleFrame);
      };
  }, [jumpCarouselInstant, launcherPageLayout, totalPages]);

  // If iOS resumes the same mounted Launcher instead of remounting it, apply
  // the same fresh-home rule as soon as the document becomes visible again.
  useEffect(() => {
      const handleVisibilityResume = () => {
          if (document.visibilityState !== 'visible' || !_pageNeedsHomeAfterBackground) return;
          const scroller = scrollContainerRef.current;
          if (!scroller || totalPages <= 0) return;
          const restore = () => {
              if (scrollContainerRef.current !== scroller || !_pageNeedsHomeAfterBackground) return;
              if (scroller.clientWidth <= 0) {
                  requestAnimationFrame(restore);
                  return;
              }
              _pageNeedsHomeAfterBackground = false;
              activePageIndexRef.current = 0;
              setActivePageIndex(0);
              _lastPageIndex = 0;
              visiblePageIdRef.current = launcherPageIdAtIndex(launcherPageLayout, 0);
              carouselReadyRef.current = false;
              jumpCarouselInstant(scroller, scroller.clientWidth * carouselPhysicalIndex(0, totalPages));
              requestAnimationFrame(() => {
                  if (scrollContainerRef.current === scroller) carouselReadyRef.current = true;
              });
          };
          restore();
      };
      document.addEventListener('visibilitychange', handleVisibilityResume);
      return () => document.removeEventListener('visibilitychange', handleVisibilityResume);
  }, [jumpCarouselInstant, launcherPageLayout, totalPages]);

  const cancelCarouselNormalization = useCallback(() => {
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
      scrollEndTimer.current = null;
  }, []);

  const normalizeCarouselPosition = useCallback(() => {
      const scroller = scrollContainerRef.current;
      if (!scroller || totalPages <= 0 || scroller.clientWidth <= 0 || !carouselReadyRef.current) return;
      // Never move the edge clone while a pointer/finger is still holding it.
      // This keeps a long press at the edge from jumping underneath the finger.
      if (touchActive.current || isDragging.current) return;

      const width = scroller.clientWidth;
      const physicalIndex = Math.round(scroller.scrollLeft / width);
      const logicalIndex = carouselLogicalIndex(physicalIndex, totalPages);
      activePageIndexRef.current = logicalIndex;
      setActivePageIndex(logicalIndex);
      _lastPageIndex = logicalIndex;
      visiblePageIdRef.current = launcherPageIdAtIndex(launcherPageLayout, logicalIndex);

      const resetIndex = carouselCloneResetIndex(physicalIndex, totalPages);
      if (resetIndex == null) return;

      // Wait until native snap has actually settled on the clone. The clone and
      // its matching real page are identical, so this final auto reset is not
      // visible to the user and does not animate through pages 2–4.
      const snappedLeft = physicalIndex * width;
      if (Math.abs(scroller.scrollLeft - snappedLeft) > 2) {
          scrollEndTimer.current = setTimeout(() => {
              scrollEndTimer.current = null;
              normalizeCarouselPosition();
          }, 80);
          return;
      }

      jumpCarouselInstant(scroller, width * resetIndex);
  }, [jumpCarouselInstant, launcherPageLayout, totalPages]);

  const scheduleCarouselNormalization = useCallback(() => {
      cancelCarouselNormalization();
      if (totalPages <= 0) return;
      scrollEndTimer.current = setTimeout(() => {
          scrollEndTimer.current = null;
          normalizeCarouselPosition();
      }, 140);
  }, [cancelCarouselNormalization, normalizeCarouselPosition, totalPages]);

  useEffect(() => () => cancelCarouselNormalization(), [cancelCarouselNormalization]);

  const handleScroll = () => {
      const scroller = scrollContainerRef.current;
      // Ignore browser initialization scrolls until the real starting page has
      // been verified. Processing the leading clone here would immediately
      // persist the calendar as the next launch page.
      if (!scroller || totalPages <= 0 || scroller.clientWidth <= 0 || !carouselReadyRef.current) return;

      const physicalIndex = Math.round(scroller.scrollLeft / scroller.clientWidth);
      const logicalIndex = carouselLogicalIndex(physicalIndex, totalPages);
      if (logicalIndex !== activePageIndexRef.current) {
          setActivePageIndex(logicalIndex);
          activePageIndexRef.current = logicalIndex;
      }
      visiblePageIdRef.current = launcherPageIdAtIndex(launcherPageLayout, logicalIndex);
      _lastPageIndex = logicalIndex; // Persist the logical page across remounts

      if (carouselCloneResetIndex(physicalIndex, totalPages) != null && !touchActive.current && !isDragging.current) {
          scheduleCarouselNormalization();
      }
  };

  // Native scrolling now travels through edge clones. These handlers only keep
  // the normalisation timer from firing while the user still holds the gesture;
  // they intentionally do not call scrollTo at the boundary.
  /**
   * 把轮播的手势状态和被 handleMouseDown 改掉的行内样式收回到「能翻页」的初始态。
   *
   * 这是「进整理模式后翻页变成横向平移、退出也不恢复、重启才好」的根治点：
   * 长按进整理模式之前浏览器已经派过一次 mousedown，那时 handleMouseDown 把
   * scrollSnapType 关成了 none 并置 isDragging=true；随后长按定时器只把 isDragging
   * 清成 false，样式没人还原，而 handleMouseUp 又因为 isDragging 已是 false 直接返回，
   * 于是 snap 永久停在 none。touchActive 同理会被 pointercancel 卡在 true，
   * 让 handleScroll 再也不去做首尾克隆页的归位。
   */
  const resetCarouselGestureState = useCallback(() => {
      isDragging.current = false;
      touchActive.current = false;
      const scroller = scrollContainerRef.current;
      if (!scroller) return;
      scroller.style.scrollBehavior = 'smooth';
      scroller.style.scrollSnapType = 'x mandatory';
      scroller.style.cursor = 'grab';
  }, []);

  // 整理模式每次进出都强制归位一次，任何漏掉的收尾路径都在这里兜住。
  useEffect(() => {
      resetCarouselGestureState();
  }, [layoutEditing, resetCarouselGestureState]);

  const handleTouchStart = () => {
      if (layoutEditing) return;
      touchActive.current = true;
      cancelCarouselNormalization();
  };
  // 每次手指离开都顺手归位一次：即使某条路径漏了收尾，下一次划屏就自愈，
  // 不用像以前那样重启 App 才能把翻页找回来。
  const handleTouchEnd = () => {
      resetCarouselGestureState();
      scheduleCarouselNormalization();
  };
  const handleTouchCancel = () => {
      resetCarouselGestureState();
      scheduleCarouselNormalization();
  };

  // --- Mouse Drag Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
      if (!scrollContainerRef.current || layoutEditing) return;
      cancelCarouselNormalization();
      isDragging.current = true;
      dragMoved.current = 0;
      startX.current = e.pageX - scrollContainerRef.current.offsetLeft;
      scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
      
      // Disable snap and smooth scroll for direct control
      scrollContainerRef.current.style.scrollBehavior = 'auto';
      scrollContainerRef.current.style.scrollSnapType = 'none';
      scrollContainerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (layoutEditing || !isDragging.current || !scrollContainerRef.current) return;
      e.preventDefault();
      const x = e.pageX - scrollContainerRef.current.offsetLeft;
      const walk = (x - startX.current);
      scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
      
      dragMoved.current = Math.abs(x - (startX.current + scrollContainerRef.current.offsetLeft)); 
  };

  const handleMouseUp = () => {
      if (!isDragging.current || !scrollContainerRef.current) return;
      resetCarouselGestureState();
      scheduleCarouselNormalization();
  };

  const handleMouseLeave = () => {
      if (isDragging.current) handleMouseUp();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
      if (dragMoved.current > 5 || Date.now() < suppressLayoutClickUntil.current) {
          e.stopPropagation();
          e.preventDefault();
      }
  };

  const setLauncherPageLayoutDraft = useCallback((next: LauncherPageLayout, preferredPageId = visiblePageIdRef.current) => {
      launcherPageLayoutRef.current = next;
      setLauncherPageLayout(next);
      const nextDock = [...(next.dockAppIds || [])];
      launcherDockOrderRef.current = nextDock;
      setLauncherDockOrder(nextDock);
      pendingCarouselPageIdRef.current = preferredPageId;
      const nextIndex = launcherPageIndexById(next, preferredPageId);
      activePageIndexRef.current = nextIndex;
      setActivePageIndex(nextIndex);
      _lastPageIndex = nextIndex;
  }, []);

  const persistLauncherLayout = useCallback(() => {
      const projection = projectLauncherLayoutToLegacy(launcherPageLayoutRef.current);
      void updateTheme({
          launcherPageLayout: launcherPageLayoutRef.current,
          launcherAppOrder: projection.appOrder,
          launcherDockOrder: projection.dockOrder,
          launcherPinwheelOrder: pinwheelOrderRef.current,
      });
  }, [updateTheme]);

  // 组件改动都是「立刻落库」：加/删/换图不像拖 20 个图标那样连发，没必要攒批。
  const persistUserWidgets = useCallback((next: LauncherUserWidget[]) => {
      userWidgetsRef.current = next;
      setUserWidgets(next);
      void updateTheme({ launcherUserWidgets: next.length > 0 ? next : undefined });
  }, [updateTheme]);

  const visiblePinwheelCells = useMemo(
      () => pinwheelOrder.filter(cell => !hiddenBuiltinWidgets.includes(cell as LauncherBuiltinWidgetId)),
      [hiddenBuiltinWidgets, pinwheelOrder],
  );

  /**
   * 组件排序用的「页」。
   * 风车页里排在一起的不是 App 图标而是那四个自带格，所以把 appIds 换成可见的格位列表；
   * `buildLauncherPageSlots` / `moveLauncherUserWidget` 只拿它当排序轴，换掉即可复用。
   */
  const widgetDropPage = useCallback((page: LauncherPage | undefined): LauncherPage | undefined => {
      if (!page) return undefined;
      if (page.kind !== 'pinwheel') return page;
      const cells = pinwheelOrderRef.current
          .filter(cell => !hiddenBuiltinWidgetsRef.current.includes(cell as LauncherBuiltinWidgetId));
      return { ...page, appIds: cells };
  }, []);

  const widgetPageById = useCallback((pageId: string | undefined): LauncherPage | undefined => {
      if (!pageId) return undefined;
      return launcherPageLayoutRef.current.pages.find(item => item.id === pageId);
  }, []);

  const handleAddUserWidget = useCallback((size: LauncherWidgetSize) => {
      const page = widgetPageById(visiblePageIdRef.current);
      if (!page) {
          addToast('日历页放不了组件，点下方页码换一页', 'error');
          return;
      }
      const result = addLauncherUserWidget(userWidgetsRef.current, widgetDropPage(page)!, size);
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      persistUserWidgets(result.widgets);
      // 加完直接进编辑态，用户下一步本来就是传图。
      setWidgetSheet({ mode: 'edit', id: result.widget.id });
      trackEvent('桌面添加自定义组件', { size });
  }, [addToast, persistUserWidgets, widgetDropPage, widgetPageById]);

  const editingUserWidget = useMemo(
      () => (widgetSheet?.mode === 'edit' ? userWidgets.find(widget => widget.id === widgetSheet.id) : undefined),
      [userWidgets, widgetSheet],
  );

  const patchEditingWidget = useCallback((patch: Parameters<typeof updateLauncherUserWidget>[2]) => {
      if (widgetSheet?.mode !== 'edit') return;
      persistUserWidgets(updateLauncherUserWidget(userWidgetsRef.current, widgetSheet.id, patch));
  }, [persistUserWidgets, widgetSheet]);

  const handleUserWidgetFile = useCallback(async (file: File) => {
      if (widgetSheet?.mode !== 'edit') return;
      const id = widgetSheet.id;
      setWidgetBusy(true);
      try {
          // theme 整体要写进 localStorage，所以字段里只能放短令牌；二进制进 blob_assets。
          const blob = await processImageToBlob(file, { maxWidth: 1200, quality: 0.9 });
          const ref = await putImageBlob(blob);
          persistUserWidgets(updateLauncherUserWidget(userWidgetsRef.current, id, { image: ref }));
          addToast('组件图片已更新', 'success');
      } catch (e: any) {
          addToast(e?.message || '图片处理失败', 'error');
      } finally {
          setWidgetBusy(false);
      }
  }, [addToast, persistUserWidgets, widgetSheet]);

  const handleUserWidgetUrl = useCallback((url: string) => {
      if (!/^https?:\/\//i.test(url)) {
          addToast('请填写以 http(s):// 开头的图片地址', 'error');
          return;
      }
      patchEditingWidget({ image: url });
      addToast('组件图片已更新', 'success');
  }, [addToast, patchEditingWidget]);

  const persistHiddenBuiltinWidgets = useCallback((next: LauncherBuiltinWidgetId[]) => {
      hiddenBuiltinWidgetsRef.current = next;
      setHiddenBuiltinWidgets(next);
      void updateTheme({ launcherHiddenBuiltinWidgets: next.length > 0 ? next : undefined });
  }, [updateTheme]);

  const handleRemoveBuiltinWidget = useCallback((id: LauncherBuiltinWidgetId) => {
      persistHiddenBuiltinWidgets(hideLauncherBuiltinWidget(hiddenBuiltinWidgetsRef.current, id));
      setBuiltinWidgetSheet(null);
      addToast('已移除，可在「＋ 组件」里恢复', 'success');
      trackEvent('移除桌面自带组件', { cell: id });
  }, [addToast, persistHiddenBuiltinWidgets]);

  const handleRestoreBuiltinWidget = useCallback((id: LauncherBuiltinWidgetId) => {
      persistHiddenBuiltinWidgets(restoreLauncherBuiltinWidget(hiddenBuiltinWidgetsRef.current, id));
      addToast('已恢复到桌面第二页', 'success');
  }, [addToast, persistHiddenBuiltinWidgets]);

  /**
   * 跑一次 App 移动，并保证这一页上的组件仍然待在原来的邻居旁边。
   *
   * 组件的 pos 画在 appIds 下标那条轴上，App 一动，组件的相对位置就漂。
   * 用户遇到的正是这个：整行宽的组件把第二行挤成半行后，想把被挤下去的图标拖回那两个空位，
   * 图标是插进去了，可组件的 pos 没变，仍然卡在它前面，看上去「怎么拖都没反应」。
   *
   * @param anchorOverride 明确指定某个组件要跟到哪个 App 后面（「把图标放到组件前面」就是这个意思）。
   */
  const runAppMoveKeepingWidgets = useCallback((
      pageIds: readonly (string | undefined)[],
      move: () => void,
      anchorOverride?: { widgetId: string; afterAppId: string },
  ) => {
      const touched = Array.from(new Set(pageIds.filter((id): id is string => !!id)));
      const before = touched.map(pageId => {
          const page = launcherPageLayoutRef.current.pages.find(item => item.id === pageId);
          return page
              ? { pageId, anchors: captureLauncherWidgetAnchors(page, userWidgetsRef.current) }
              : null;
      }).filter(Boolean) as Array<{ pageId: string; anchors: ReturnType<typeof captureLauncherWidgetAnchors> }>;

      move();

      let next = userWidgetsRef.current;
      let changed = false;
      for (const { pageId, anchors } of before) {
          const page = launcherPageLayoutRef.current.pages.find(item => item.id === pageId);
          if (!page) continue;
          const merged = anchorOverride && anchorOverride.widgetId in anchors
              ? { ...anchors, [anchorOverride.widgetId]: anchorOverride.afterAppId }
              : anchors;
          const applied = applyLauncherWidgetAnchors(page, next, merged);
          if (applied.some((widget, index) => widget !== next[index])) changed = true;
          next = applied;
      }
      if (changed) persistUserWidgets(next);
  }, [persistUserWidgets]);

  const handleUserWidgetRemove = useCallback(() => {
      if (widgetSheet?.mode !== 'edit') return;
      persistUserWidgets(removeLauncherUserWidget(userWidgetsRef.current, widgetSheet.id));
      setWidgetSheet(null);
      addToast('组件已移除', 'success');
  }, [addToast, persistUserWidgets, widgetSheet]);

  const reorderByTarget = useCallback((kind: string, source: string, target: string) => {
      if (source === target) return;
      if (kind === 'dock') {
          const result = reorderLauncherDockApps(launcherPageLayoutRef.current, source, target);
          if (result.ok) setLauncherPageLayoutDraft(result.layout);
          return;
      }
      const reorder = <T extends string>(items: T[]) => {
          const from = items.indexOf(source as T);
          const to = items.indexOf(target as T);
          if (from < 0 || to < 0) return items;
          const next = [...items];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
      };
      if (kind === 'widget') {
          const next = reorder(pinwheelOrderRef.current) as Array<'music' | 'appsA' | 'appsB' | 'image'>;
          pinwheelOrderRef.current = next;
          setPinwheelOrder(next);
      }
  }, [setLauncherPageLayoutDraft]);

  const moveAppByTarget = useCallback((sourcePageId: string, sourceAppId: string, targetPageId: string, targetAppId?: string) => {
      const result = moveLauncherApp(
          launcherPageLayoutRef.current,
          sourcePageId,
          sourceAppId,
          targetPageId,
          targetAppId,
      );
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      setLauncherPageLayoutDraft(result.layout, targetPageId);
  }, [addToast, setLauncherPageLayoutDraft]);

  const moveDockAppByTarget = useCallback((dockAppId: string, targetPageId: string, targetAppId?: string) => {
      const result = moveLauncherDockAppToPage(
          launcherPageLayoutRef.current,
          dockAppId,
          targetPageId,
          targetAppId,
      );
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      setLauncherPageLayoutDraft(result.layout, targetPageId);
  }, [addToast, setLauncherPageLayoutDraft]);

  const movePageAppToDockByTarget = useCallback((sourcePageId: string, sourceAppId: string, targetDockAppId?: string) => {
      const result = moveLauncherPageAppToDock(
          launcherPageLayoutRef.current,
          sourcePageId,
          sourceAppId,
          targetDockAppId,
      );
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      setLauncherPageLayoutDraft(result.layout, sourcePageId);
  }, [addToast, setLauncherPageLayoutDraft]);

  const makeNewLauncherPageId = useCallback(() => {
      const prefix = `launcher-app-${Date.now()}`;
      const used = new Set(launcherPageLayoutRef.current.pages.map(page => page.id));
      let id = prefix;
      let suffix = 2;
      while (used.has(id)) {
          id = `${prefix}-${suffix}`;
          suffix += 1;
      }
      return id;
  }, []);

  const handleAddLauncherPage = useCallback(() => {
      const result = addLauncherAppPage(launcherPageLayoutRef.current, makeNewLauncherPageId());
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      setLauncherPageLayoutDraft(result.layout, result.layout.pages[result.layout.pages.length - 1].id);
      persistLauncherLayout();
      addToast('已新增空白 App 页', 'success');
  }, [addToast, makeNewLauncherPageId, persistLauncherLayout, setLauncherPageLayoutDraft]);

  const handleDeleteLauncherPage = useCallback((pageId: string) => {
      const current = launcherPageLayoutRef.current;
      const page = current.pages.find(item => item.id === pageId);
      if (!page) return;
      const check = canDeleteLauncherAppPage(current, pageId);
      if (!check.ok) {
          addToast(check.neededSlots
              ? `${check.reason}，还需要 ${check.neededSlots} 个空位`
              : check.reason || '这个页面不能删除', 'error');
          return;
      }
      if (page.appIds.length > 0 && typeof window !== 'undefined') {
          const confirmed = window.confirm(`此页有 ${page.appIds.length} 个 App，删除后会重新排列到其他页面。继续吗？`);
          if (!confirmed) return;
      }
      const result = deleteLauncherAppPage(current, pageId);
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      const fallbackPageId = current.pages[Math.max(0, current.pages.findIndex(item => item.id === pageId) - 1)]?.id || LAUNCHER_HOME_PAGE_ID;
      setLauncherPageLayoutDraft(result.layout, fallbackPageId);
      persistLauncherLayout();
      addToast('页面已删除，App 已安全重新排列', 'success');
  }, [addToast, persistLauncherLayout, setLauncherPageLayoutDraft]);

  const reorderPageByTarget = useCallback((sourcePageId: string, targetPageId: string) => {
      const result = reorderLauncherPages(launcherPageLayoutRef.current, sourcePageId, targetPageId);
      if (!result.ok) {
          addToast(result.reason, 'error');
          return;
      }
      setLauncherPageLayoutDraft(result.layout);
      persistLauncherLayout();
  }, [addToast, persistLauncherLayout, setLauncherPageLayoutDraft]);

  // 空白桌面长按也要能进整理模式（iOS / 糯叽机的手感），但它不能建拖拽 ghost，
  // 也绝不能 setPointerCapture —— 那会把横向翻页的原生滚动一起吃掉。
  const emptyPress = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const emptyPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearEmptyPress = useCallback(() => {
      if (emptyPressTimer.current) clearTimeout(emptyPressTimer.current);
      emptyPressTimer.current = null;
      emptyPress.current = null;
  }, []);

  const clearLayoutPressTimer = useCallback(() => {
      if (layoutPressTimer.current) clearTimeout(layoutPressTimer.current);
      layoutPressTimer.current = null;
  }, []);

  const clearLayoutPageTurn = useCallback(() => {
      if (layoutPageTurnTimer.current) clearTimeout(layoutPageTurnTimer.current);
      layoutPageTurnTimer.current = null;
      layoutPageTurnDirection.current = 0;
  }, []);

  const activateLayoutDrag = useCallback((pointer: NonNullable<typeof layoutPointer.current>) => {
      if (pointer.ghost) return;
      const rect = pointer.element.getBoundingClientRect();
      const ghost = pointer.element.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-launcher-item');
      ghost.removeAttribute('data-launcher-kind');
      ghost.classList.remove('launcher-edit-item', 'launcher-drop-target');
      ghost.classList.add('launcher-drag-ghost');
      Object.assign(ghost.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          pointerEvents: 'none',
          zIndex: '9999',
          transform: 'scale(1.055)',
          transformOrigin: 'center',
          transition: 'none',
      });
      document.body.appendChild(ghost);
      pointer.ghost = ghost;
      pointer.grabOffsetX = pointer.x - rect.left;
      pointer.grabOffsetY = pointer.y - rect.top;
      pointer.element.classList.add('launcher-dragging');
      pointer.element.style.pointerEvents = 'none';
      setLayoutDragActive(true);
  }, []);

  // 整理模式下点页码直接跳页（手指划不动，见页码那块的注释）。
  const goToLauncherPage = useCallback((index: number) => {
      const scroller = scrollContainerRef.current;
      if (!scroller || totalPages <= 0) return;
      const next = Math.max(0, Math.min(totalPages - 1, index));
      activePageIndexRef.current = next;
      setActivePageIndex(next);
      _lastPageIndex = next;
      visiblePageIdRef.current = launcherPageIdAtIndex(launcherPageLayout, next);
      scroller.scrollTo({
          left: scroller.clientWidth * carouselPhysicalIndex(next, totalPages),
          behavior: 'smooth',
      });
  }, [launcherPageLayout, totalPages]);

  const queueLayoutPageTurn = useCallback((direction: -1 | 1) => {
      if (layoutPageTurnDirection.current === direction && layoutPageTurnTimer.current) return;
      clearLayoutPageTurn();
      layoutPageTurnDirection.current = direction;
      const turn = () => {
          const pointer = layoutPointer.current;
          const scroller = scrollContainerRef.current;
          const isPageItemPointer = pointer?.kind === 'app' || pointer?.kind === 'dock' || pointer?.kind === 'uwidget';
          if (!pointer?.active || !isPageItemPointer || !scroller || layoutPageTurnDirection.current !== direction) {
              clearLayoutPageTurn();
              return;
          }
          // The persisted pages all accept Apps; the synthetic Widgets page
          // is deliberately excluded from edge dragging.
          const maxAppPage = Math.max(0, launcherPageLayout.pages.length - 1);
          const nextPage = Math.max(0, Math.min(maxAppPage, activePageIndexRef.current + direction));
          if (nextPage === activePageIndexRef.current) {
              clearLayoutPageTurn();
              return;
          }
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.targetElement = undefined;
          pointer.lastTarget = undefined;
          activePageIndexRef.current = nextPage;
          setActivePageIndex(nextPage);
          _lastPageIndex = nextPage;
          visiblePageIdRef.current = launcherPageIdAtIndex(launcherPageLayout, nextPage);
          scroller.scrollTo({
              left: scroller.clientWidth * carouselPhysicalIndex(nextPage, totalPages),
              behavior: 'smooth',
          });
          layoutPageTurnTimer.current = setTimeout(turn, 760);
      };
      layoutPageTurnTimer.current = setTimeout(turn, 560);
  }, [clearLayoutPageTurn, launcherPageLayout, totalPages]);

  useEffect(() => () => {
      clearEmptyPress();
      clearLayoutPressTimer();
      clearLayoutPageTurn();
      layoutPointer.current?.ghost?.remove();
  }, [clearEmptyPress, clearLayoutPageTurn, clearLayoutPressTimer]);

  const handleLayoutPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const launcherRoot = e.currentTarget;
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-launcher-item]');
      if (!item) {
          if (layoutEditing) return;
          if (!(e.target as HTMLElement).closest('[data-launcher-page-drop]')) return;
          clearEmptyPress();
          emptyPress.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
          emptyPressTimer.current = setTimeout(() => {
              if (emptyPress.current?.pointerId !== e.pointerId) return;
              clearEmptyPress();
              suppressLayoutClickUntil.current = Date.now() + 700;
              setLayoutEditing(true);
              trackEvent('进入桌面整理模式');
          }, 560);
          return;
      }
      const key = item.dataset.launcherItem;
      const kind = item.dataset.launcherKind;
      if (!key || !kind) return;
      clearLayoutPressTimer();
      layoutPointer.current = {
          pointerId: e.pointerId,
          key,
          kind,
          pageId: item.dataset.launcherPageId,
          x: e.clientX,
          y: e.clientY,
          active: layoutEditing,
          element: item,
      };
      if (layoutEditing) {
          activateLayoutDrag(layoutPointer.current);
          launcherRoot.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
      }
      layoutPressTimer.current = setTimeout(() => {
          if (!layoutPointer.current || layoutPointer.current.pointerId !== e.pointerId) return;
          layoutPointer.current.active = true;
          activateLayoutDrag(layoutPointer.current);
          launcherRoot.setPointerCapture(e.pointerId);
          // 长按之前那次 mousedown 已经把 snap 关掉了，这里必须整套还原，不能只清 isDragging。
          resetCarouselGestureState();
          suppressLayoutClickUntil.current = Date.now() + 700;
          setLayoutEditing(true);
          trackEvent('进入桌面整理模式');
      }, 520);
  };

  const handleLayoutPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const empty = emptyPress.current;
      if (empty && empty.pointerId === e.pointerId && Math.hypot(e.clientX - empty.x, e.clientY - empty.y) > 9) {
          clearEmptyPress();
      }
      const pointer = layoutPointer.current;
      if (!pointer || pointer.pointerId !== e.pointerId) return;
      if (!pointer.active) {
          if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 9) {
              clearLayoutPressTimer();
              layoutPointer.current = null;
          }
          return;
      }
      e.preventDefault();
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 9) pointer.moved = true;
      if (pointer.ghost) {
          pointer.ghost.style.left = `${e.clientX - (pointer.grabOffsetX || 0)}px`;
          pointer.ghost.style.top = `${e.clientY - (pointer.grabOffsetY || 0)}px`;
      }
      const rootRect = e.currentTarget.getBoundingClientRect();
      // 风车页的自带格只能在本页内换位，所以它不参与「拖到边缘翻页」，但要参与落点判定。
      const canCrossPages = pointer.kind === 'app' || pointer.kind === 'dock' || pointer.kind === 'uwidget';
      const isPageItemPointer = canCrossPages || pointer.kind === 'widget';
      if (canCrossPages && e.clientX <= rootRect.left + 72) queueLayoutPageTurn(-1);
      else if (canCrossPages && e.clientX >= rootRect.right - 72) queueLayoutPageTurn(1);
      else clearLayoutPageTurn();
      const pointTarget = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const target = pointTarget?.closest<HTMLElement>('[data-launcher-item]');
      const targetIsClone = !!target?.closest('[data-launcher-carousel-clone="true"]');
      const targetKey = target?.dataset.launcherItem;
      const targetKind = target?.dataset.launcherKind;
      const targetPageId = target?.dataset.launcherPageId;
      // 页面内的落点（App 图标 / 用户组件）一律交给下面的「最近格子」判定，
      // 因为直接命中只覆盖图标那 56px 的方块，格与格之间全是空隙，落空就会被
      // 当成「整页」→ 追加到页尾。这里只保留 Dock 和风车格这两种直接命中语义。
      const validItemTarget = !targetIsClone
          && !!targetKey
          && targetKey !== pointer.key
          && targetKind === 'dock'
          && (pointer.kind === 'app' || pointer.kind === 'dock');

      // If the pointer is over an App icon, keep the precise before-target
      // semantics. Dropping on one's own icon is a no-op, not an append.
      if (target && targetKey === pointer.key) {
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.targetElement = undefined;
          pointer.lastTarget = undefined;
          return;
      }

      if (validItemTarget) {
          if (target === pointer.targetElement) return;
          pointer.targetElement?.classList.remove('launcher-drop-target');
          target.classList.add('launcher-drop-target');
          pointer.targetElement = target;
          pointer.lastTarget = {
              kind: targetKind || pointer.kind,
              key: targetKey,
          };
          return;
      }

      // A page drop zone makes empty pages and the trailing area of a full
      // grid reachable. Clone pages are never canonical drop targets.
      const pageDrop = pointTarget?.closest<HTMLElement>('[data-launcher-page-drop]');
      const pageDropIsClone = !!pageDrop?.closest('[data-launcher-carousel-clone="true"]');
      const pageDropId = pageDrop?.dataset.launcherPageDrop;
      const applyPageDrop = (pageDropId: string, fallbackHighlight: HTMLElement) => {
          // 按「离手指最近的格子」定插入点，而不是只认正下方那个元素。
          const scrollLeft = Math.round(scrollContainerRef.current?.scrollLeft || 0);
          if (pointer.dropCache?.pageId !== pageDropId || pointer.dropCache.scrollLeft !== scrollLeft) {
              const items: LauncherDropCandidate[] = [];
              const elements = new Map<string, HTMLElement>();
              const kinds = new Map<string, string>();
              const nodes = document.querySelectorAll<HTMLElement>(
                  `[data-launcher-item][data-launcher-page-id="${cssEscape(pageDropId)}"]`,
              );
              nodes.forEach(node => {
                  const key = node.dataset.launcherItem;
                  // 轮播首尾的克隆页不能当落点，否则会把改动写到一个看不见的副本上。
                  if (!key || node.closest('[data-launcher-carousel-clone="true"]')) return;
                  const rect = node.getBoundingClientRect();
                  items.push({ key, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
                  elements.set(key, node);
                  kinds.set(key, node.dataset.launcherKind || 'app');
              });
              pointer.dropCache = { pageId: pageDropId, scrollLeft, items, elements, kinds };
          }
          const dropKey = resolveLauncherDropKey(pointer.dropCache.items, e.clientX, e.clientY, pointer.key);
          const dropElement = dropKey ? pointer.dropCache.elements.get(dropKey) : null;
          // 没算出目标就是「追加到页尾」，这时高亮整页，让用户知道会掉到最后。
          const highlight: HTMLElement = dropElement || fallbackHighlight;
          if (highlight !== pointer.targetElement) {
              pointer.targetElement?.classList.remove('launcher-drop-target');
              highlight.classList.add('launcher-drop-target');
              pointer.targetElement = highlight;
          }
          pointer.lastTarget = {
              // 落点自己是什么就报什么：App 图标 / 用户组件 / 风车页自带格。
              kind: dropKey ? (pointer.dropCache.kinds.get(dropKey) || 'app') : 'app',
              pageId: pageDropId,
              key: dropKey || '',
          };
      };

      if (isPageItemPointer && pageDrop && !pageDropIsClone && pageDropId) {
          applyPageDrop(pageDropId, pageDrop);
          return;
      }

      const dockDrop = pointTarget?.closest<HTMLElement>('[data-launcher-dock-drop]');
      if (pointer.kind === 'app' && dockDrop) {
          if (dockDrop === pointer.targetElement) return;
          pointer.targetElement?.classList.remove('launcher-drop-target');
          dockDrop.classList.add('launcher-drop-target');
          pointer.targetElement = dockDrop;
          pointer.lastTarget = { kind: 'dock', key: '' };
          return;
      }

      // 兜底：手指还在启动器里，但正压着一层不属于任何一页的浮层
      // （整理模式顶部的工具条、页码条、Dock 之间的缝……）。
      // 这些浮层视觉上就盖在当前这一页上，用户的意图明显是「放到这一页」。
      // 不兜的话最要命的是顶部工具条：它正好压在第一行图标上方那一带，
      // 于是「把组件 / 图标挪到这一页最顶上」根本做不到——手指一进那条带子落点就判空了。
      // 只在手指还在启动器矩形内时兜底，「拖出屏幕外松手 = 放弃这次拖动」的行为保持不变。
      const insideLauncher = e.clientX >= rootRect.left && e.clientX <= rootRect.right
          && e.clientY >= rootRect.top && e.clientY <= rootRect.bottom;
      if (isPageItemPointer && insideLauncher && !dockDrop) {
          // 必须按「手指几何上落在哪一页」找，不能图省事用 visiblePageIdRef ——
          // 那个 ref 靠 onScroll 维护，轮播还没归位、或滚动事件没跟上时就是旧值，
          // 会把东西悄悄搬到另一页去（实测把组件从第三页搬到了主页）。
          const geometricPage = [...document.querySelectorAll<HTMLElement>('[data-launcher-page-drop]')]
              .find(el => {
                  if (el.closest('[data-launcher-carousel-clone="true"]')) return false;
                  const rect = el.getBoundingClientRect();
                  return e.clientX >= rect.left && e.clientX <= rect.right
                      && e.clientY >= rect.top && e.clientY <= rect.bottom;
              });
          const geometricPageId = geometricPage?.dataset.launcherPageDrop;
          if (geometricPage && geometricPageId
              && launcherPageLayoutRef.current.pages.some(page => page.id === geometricPageId)) {
              applyPageDrop(geometricPageId, geometricPage);
              return;
          }
      }

      pointer.targetElement?.classList.remove('launcher-drop-target');
      pointer.targetElement = undefined;
      pointer.lastTarget = undefined;
  };

  const finishLayoutPointer = (e?: React.PointerEvent<HTMLDivElement>) => {
      const pointer = layoutPointer.current;
      if (e && pointer && pointer.pointerId !== e.pointerId) return;
      clearEmptyPress();
      clearLayoutPressTimer();
      clearLayoutPageTurn();
      setLayoutDragActive(false);
      if (pointer?.active) {
          suppressLayoutClickUntil.current = Date.now() + 500;
          pointer.element.style.pointerEvents = '';
          pointer.element.classList.remove('launcher-dragging');
          pointer.ghost?.remove();
          pointer.targetElement?.classList.remove('launcher-drop-target');
          const draggedWidgetId = launcherWidgetIdFromItemKey(pointer.key);
          if (draggedWidgetId && !pointer.moved) {
              // 长按 / 编辑态下原地松手 = 打开这个组件的编辑面板，不动位置。
              setWidgetSheet({ mode: 'edit', id: draggedWidgetId });
          } else if (pointer.kind === 'widget' && !pointer.moved && isLauncherBuiltinWidgetId(pointer.key)) {
              // 风车页自带的音乐卡片 / 方图：原地松手给一个移除入口（以前根本删不掉）。
              setBuiltinWidgetSheet(pointer.key);
          } else if (draggedWidgetId) {
              // 组件拖放：目标可以是 App、别的组件，或整页空白区（落到页尾）。
              const target = pointer.lastTarget;
              // 没落在任何页 / 任何格子上 = 放弃这次拖动，原样留在原处。
              const page = target ? widgetDropPage(widgetPageById(target.pageId || pointer.pageId)) : undefined;
              if (page) {
                  const result = moveLauncherUserWidget(
                      userWidgetsRef.current,
                      draggedWidgetId,
                      page,
                      target?.key || undefined,
                  );
                  if (result.ok) persistUserWidgets(result.widgets);
                  else addToast(result.reason, 'error');
              } else if (target?.pageId) {
                  addToast('这一页放不了组件', 'error');
              }
          } else if (pointer.lastTarget) {
              const target = pointer.lastTarget;
              // 风车页自带格之间的换位（音乐卡片 / 方图 / 两组图标）。
              const pinwheelSwap = pointer.kind === 'widget' && target.kind === 'widget' && target.key;
              // App / Dock 图标落在组件上：转译成「插到该组件后面那个 App 前面」。
              const targetWidgetId = target.kind === 'uwidget' ? launcherWidgetIdFromItemKey(target.key) : null;
              const targetWidgetPage = targetWidgetId ? widgetPageById(target.pageId) : undefined;
              const widgetAppTarget = targetWidgetPage && targetWidgetId
                  ? appTargetAfterWidget(targetWidgetPage, userWidgetsRef.current, targetWidgetId)
                  : undefined;
              if (pinwheelSwap) {
                  reorderByTarget('widget', pointer.key, target.key);
              } else if (target.kind === 'widget' && target.pageId && pointer.kind === 'app' && pointer.pageId) {
                  // App 落在风车页自带格上：那几格里排的不是 App，没法精确插队，落到该页末尾。
                  const src = pointer.pageId;
                  runAppMoveKeepingWidgets([src, target.pageId], () => {
                      moveAppByTarget(src, pointer.key, target.pageId!, undefined);
                  });
              } else if (target.kind === 'widget' && target.pageId && pointer.kind === 'dock') {
                  runAppMoveKeepingWidgets([target.pageId], () => {
                      moveDockAppByTarget(pointer.key, target.pageId!, undefined);
                  });
              } else if (targetWidgetPage && pointer.kind === 'app' && pointer.pageId) {
                  // 「把图标放到这个组件前面」：光挪 App 是不够的——组件的 pos 没变，
                  // 仍然卡在图标前面，看上去完全没动。所以顺手把组件重新钉到这个图标后面。
                  const src = pointer.pageId;
                  runAppMoveKeepingWidgets(
                      [src, targetWidgetPage.id],
                      () => { moveAppByTarget(src, pointer.key, targetWidgetPage.id, widgetAppTarget); },
                      targetWidgetId ? { widgetId: targetWidgetId, afterAppId: pointer.key } : undefined,
                  );
              } else if (targetWidgetPage && pointer.kind === 'dock') {
                  runAppMoveKeepingWidgets(
                      [targetWidgetPage.id],
                      () => { moveDockAppByTarget(pointer.key, targetWidgetPage.id, widgetAppTarget); },
                      targetWidgetId ? { widgetId: targetWidgetId, afterAppId: pointer.key } : undefined,
                  );
              } else if (pointer.kind === 'app' && pointer.pageId && target.kind === 'app' && target.pageId) {
                  const src = pointer.pageId;
                  runAppMoveKeepingWidgets([src, target.pageId], () => {
                      moveAppByTarget(src, pointer.key, target.pageId!, target.key || undefined);
                  });
              } else if (pointer.kind === 'app' && pointer.pageId && target.kind === 'dock') {
                  const src = pointer.pageId;
                  runAppMoveKeepingWidgets([src], () => {
                      movePageAppToDockByTarget(src, pointer.key, target.key || undefined);
                  });
              } else if (pointer.kind === 'dock' && target.kind === 'app' && target.pageId) {
                  runAppMoveKeepingWidgets([target.pageId], () => {
                      moveDockAppByTarget(pointer.key, target.pageId!, target.key || undefined);
                  });
              } else if (target.kind === pointer.kind && target.key) {
                  reorderByTarget(pointer.kind, pointer.key, target.key);
              }
          }
          if (!draggedWidgetId) persistLauncherLayout();
      }
      layoutPointer.current = null;
  };

  const finishLayoutEditing = () => {
      finishLayoutPointer();
      clearPagePointer();
      setPageManagerOpen(false);
      setWidgetSheet(null);
      setBuiltinWidgetSheet(null);
      setLayoutEditing(false);
  };

  const clearPagePointer = useCallback(() => {
      pagePointer.current?.targetElement?.classList.remove('launcher-page-drop-target');
      pagePointer.current?.ghost?.remove();
      pagePointer.current = null;
  }, []);

  const activatePagePointer = useCallback((pointer: NonNullable<typeof pagePointer.current>) => {
      if (pointer.ghost) return;
      const rect = pointer.element.getBoundingClientRect();
      const ghost = pointer.element.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-launcher-page-tile');
      ghost.removeAttribute('data-launcher-page-locked');
      ghost.classList.add('launcher-page-drag-ghost');
      Object.assign(ghost.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          pointerEvents: 'none',
          zIndex: '9999',
          transform: 'scale(1.035)',
          transformOrigin: 'center',
          transition: 'none',
      });
      document.body.appendChild(ghost);
      pointer.ghost = ghost;
      pointer.element.classList.add('launcher-page-dragging');
  }, []);

  const handlePageManagerPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-launcher-page-tile]');
      const pageId = tile?.dataset.launcherPageTile;
      if (!tile || !pageId || tile.dataset.launcherPageLocked === 'true') return;
      clearPagePointer();
      pagePointer.current = { pointerId: e.pointerId, pageId, x: e.clientX, y: e.clientY, element: tile };
      activatePagePointer(pagePointer.current);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
  };

  const handlePageManagerPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
      const pointer = pagePointer.current;
      if (!pointer || pointer.pointerId !== e.pointerId) return;
      e.preventDefault();
      if (pointer.ghost) {
          pointer.ghost.style.left = `${e.clientX - (pointer.x - pointer.element.getBoundingClientRect().left)}px`;
          pointer.ghost.style.top = `${e.clientY - (pointer.y - pointer.element.getBoundingClientRect().top)}px`;
      }
       const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-launcher-page-tile], [data-launcher-page-end]');
       const targetPageId = target?.dataset.launcherPageTile;
       const isEndDrop = target?.dataset.launcherPageEnd === 'true';
       if (!target || (!targetPageId && !isEndDrop) || targetPageId === pointer.pageId) {
           pointer.targetElement?.classList.remove('launcher-page-drop-target');
           pointer.targetElement = undefined;
           pointer.targetPageId = undefined;
          return;
      }
      if (target === pointer.targetElement) return;
       pointer.targetElement?.classList.remove('launcher-page-drop-target');
       target.classList.add('launcher-page-drop-target');
       pointer.targetElement = target;
       pointer.targetPageId = targetPageId || LAUNCHER_WIDGETS_PAGE_ID;
  };

  const handlePageManagerPointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
      const pointer = pagePointer.current;
      if (!pointer || pointer.pointerId !== e.pointerId) return;
      const targetPageId = pointer.targetPageId;
      clearPagePointer();
      if (targetPageId) reorderPageByTarget(pointer.pageId, targetPageId);
  };

  const handlePageManagerPointerCancel: React.PointerEventHandler<HTMLDivElement> = (e) => {
      if (pagePointer.current?.pointerId !== e.pointerId) return;
      clearPagePointer();
  };

  useEffect(() => {
      const cancelInteractions = () => {
          if (layoutPointer.current) finishLayoutPointer();
          clearPagePointer();
      };
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          if (pageManagerOpenRef.current) {
              clearPagePointer();
              setPageManagerOpen(false);
          } else {
              cancelInteractions();
          }
      };
      window.addEventListener('blur', cancelInteractions);
      window.addEventListener('keydown', handleKeyDown);
      return () => {
          window.removeEventListener('blur', cancelInteractions);
          window.removeEventListener('keydown', handleKeyDown);
      };
  }, [clearPagePointer]);

  const contentColor = theme.contentColor || '#ffffff';
  const acnh = theme.skin === 'animalcrossing'; // 动森彩蛋：Dock 换奶油木质底
  const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
  // 已迁移 App 外壳已收回到可见 viewport 底边，dock 仅需自留视觉间距，无需再 + safe-bottom
  // （否则会比 home 条上方多让 34px，dock 看起来悬空）。
  const launcherBottomInset = '1.25rem';
  
  const totalUnread = Object.values(unreadMessages).reduce((a, b) => a + b, 0);
  const widgetUnread = widgetChar && unreadMessages[widgetChar.id] ? unreadMessages[widgetChar.id] : 0;

  // 手游主题：整页换成二次元手游首页布局（独立组件自渲染），不走下面的默认/动森启动器。
  if (theme.skin === 'mobilegame') {
    return <MobileGameHome />;
  }

  // 电子宠物主题：桌面即养成机——角色真实小屋做舞台 + 四颗糖果实体键（独立组件自渲染）。
  if (theme.skin === 'tamagotchi') {
    return <TamagotchiHome />;
  }

  if (theme.skin === 'companion') {
    return (
      <React.Suspense fallback={<div className="h-full w-full bg-[#100d1c]" />}>
        <CompanionHome />
      </React.Suspense>
    );
  }

  return (
    <div
      className="h-full w-full flex flex-col relative z-10 overflow-hidden font-sans select-none"
      onPointerDown={handleLayoutPointerDown}
      onPointerMove={handleLayoutPointerMove}
      onPointerUp={finishLayoutPointer}
      onPointerCancel={finishLayoutPointer}
      onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-launcher-item]')) e.preventDefault();
      }}
    >
      <style>{`
        .launcher-edit-item {
          touch-action: none;
          cursor: grab;
          transition: transform 180ms cubic-bezier(.2,.75,.25,1), opacity 150ms ease, filter 150ms ease;
          will-change: transform;
        }
        .launcher-dragging {
          cursor: grabbing;
          opacity: .18;
        }
        .launcher-drag-ghost {
          opacity: .96;
          filter: drop-shadow(0 12px 14px rgba(75,65,54,.18));
          cursor: grabbing;
        }
        .launcher-drop-target {
          transform: scale(.93);
          opacity: .52;
          outline: 1.5px dashed rgba(75,65,54,.36);
          outline-offset: 5px;
          border-radius: 1.35rem;
        }
        .launcher-page-dragging {
          opacity: .2;
        }
        .launcher-page-drag-ghost {
          opacity: .96;
          filter: drop-shadow(0 12px 18px rgba(75,65,54,.22));
        }
        .launcher-page-drop-target {
          outline: 2px solid rgba(120,131,105,.7);
          outline-offset: 3px;
          transform: scale(.97);
        }
      `}</style>
      {layoutEditing && (
          <div className="absolute top-[calc(var(--safe-top)+0.65rem)] left-4 right-4 z-50 flex items-center justify-between rounded-full px-3 py-2"
              style={{
                  background: 'rgba(75,65,54,0.88)', color: '#fffdf8', boxShadow: '0 8px 24px rgba(75,65,54,0.20)',
                  // 拖动时整条让开：它压在第一行上方那一带，挡着就没法把东西挪到页面最顶上。
                  pointerEvents: layoutDragActive ? 'none' : undefined,
                  opacity: layoutDragActive ? 0.45 : 1,
                  transition: 'opacity 160ms ease',
              }}>
              <button
                  type="button"
                  onClick={() => setWidgetSheet({ mode: 'add' })}
                  className="shrink-0 flex items-center gap-1 pl-1.5 pr-2.5 py-1 rounded-full text-[10px] font-bold bg-white/18 active:scale-95"
              >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.6} stroke="currentColor" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  组件
              </button>
              <span className="ml-2 flex-1 min-w-0 truncate text-[9.5px] font-semibold tracking-wide opacity-80">拖动换位 · 轻点组件编辑 · 点页码跳页</span>
              <div className="ml-2 flex items-center gap-1.5 shrink-0">
                  <button
                      type="button"
                      onClick={() => setPageManagerOpen(true)}
                      className="px-3 py-1 rounded-full text-[10px] font-bold bg-white/15 active:scale-95"
                  >
                      页面
                  </button>
                  <button onClick={finishLayoutEditing} className="px-3 py-1 rounded-full text-[10px] font-bold bg-white/15 active:scale-95">完成</button>
              </div>
          </div>
      )}
      
      {/* Visual Elements (Decorative Background - Static, low-cost gradients instead of blur) */}
      {/* 动森模式跳过：这层冷蓝光斑会污染奶油底 */}
      {!acnh && (
      <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full" style={{ background: paper ? 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, transparent 68%)' : 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)' }}></div>
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full" style={{ background: paper ? 'radial-gradient(circle, rgba(123,104,78,0.06) 0%, transparent 68%)' : 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }}></div>
      </div>
      )}

      {/* Scrollable Content Layer */}
      {/* UPDATE: Added snap-always to children to ensure one-page-at-a-time scrolling on mobile swipe */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseLeave}
         onTouchStart={handleTouchStart}
         onTouchEnd={handleTouchEnd}
         onTouchCancel={handleTouchCancel}
         onClickCapture={handleClickCapture}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-grab active:cursor-grabbing"
        style={{
            scrollBehavior: 'smooth',
            overscrollBehaviorX: 'contain',
            overscrollBehaviorY: 'none',
            touchAction: layoutEditing ? 'none' : 'pan-x pan-y',
            willChange: 'scroll-position',
            contain: 'layout paint',
            transform: 'translateZ(0)',
            WebkitOverflowScrolling: 'touch',
        }}
      >
          {/* Render a real page between a last-page clone and a first-page clone.
              The clones make the two ends physically adjacent while the
              logical page indicator remains 0..totalPages-1. */}
          {[
              { key: 'clone-last', idx: totalPages - 1, clone: true },
              ...Array.from({ length: totalPages }, (_, idx) => ({ key: `page-${idx}`, idx, clone: false })),
              { key: 'clone-first', idx: 0, clone: true },
          ].map(({ key, idx, clone }) => {
              const page = launcherPageLayout.pages[idx];
              const pageApps = page
                  ? page.appIds.map(id => appById.get(id as AppID)).filter(Boolean) as typeof INSTALLED_APPS
                  : [];
              // 风车页把「自带四格」和「用户组件」排进同一条顺序：自带格的排序键就是
              // 它在 pinwheelOrder 里的下标，组件用自己的 pos 插进去（和普通页一个套路）。
              const pinwheelSlots = page?.kind === 'pinwheel'
                  ? buildLauncherPageSlots({ id: page.id, appIds: visiblePinwheelCells }, userWidgets)
                  : [];
              if (idx === totalPages - 1) {
                  return (
                      <WidgetsPage
                          key={key}
                          contentColor={contentColor}
                          openApp={openApp}
                          anniversaries={anniversaries}
                          tasks={tasks}
                          characters={characters}
                          onToggleTask={handleWidgetTaskToggle}
                          acnh={acnh}
                          paper={paper}
                          carouselClone={clone}
                      />
                  );
              }
              return (
              <div
                key={key}
                className="w-full flex-shrink-0 snap-center snap-always flex flex-col px-6 pt-12 pb-8 h-full"
                data-launcher-carousel-clone={clone ? 'true' : undefined}
                data-launcher-page-drop={page?.id}
                style={{
                    // Edge clones must be painted before the first drag reaches them;
                    // keeping real off-screen pages virtualised preserves the old cost.
                    contentVisibility: clone ? 'visible' : 'auto',
                    contain: 'layout paint',
                    transform: 'translateZ(0)',
                    pointerEvents: layoutEditing && clone ? 'none' : undefined,
                }}
              >
                  {page?.kind === 'home' ? (
                      // Home page: Clock + Chat + 4x5 App Grid
                      <>
                        <DesktopClock />
                        <CharacterWidget
                            char={widgetChar}
                            unreadCount={widgetUnread}
                            lastMessage={lastMessage}
                            onClick={() => {
                                // 预览卡展示的就是某个角色的最新消息，点它要落到那段对话，
                                // 而不是好友列表（没有角色时才回落到列表）。
                                if (widgetChar) chatDetailLaunch.request({ charId: widgetChar.id, clearUnread: true });
                                openApp(AppID.Chat);
                            }}
                            contentColor={contentColor}
                            paper={paper}
                        />
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain no-scrollbar">
                            <AppGridPage
                                pageId={page.id}
                                apps={pageApps}
                                openApp={openApp}
                                editing={layoutEditing}
                                userWidgets={userWidgets}
                                paper={paper}
                                acnh={acnh}
                                contentColor={contentColor}
                            />
                        </div>
                      </>
                  ) : page?.kind === 'pinwheel' ? (
                      // Shortcut page: Schedule widget on top + Pinwheel (Music / 2x2 icons / 2x2 icons / Image) below
                      // justify-center 会让整列内容随高度变化上下漂：移掉音乐卡片 / 方图后
                      // 下面的网格变矮，日程卡就被重新居中压到了页面中段。改成从顶部排，
                      // 日程卡的位置就不再受下面有几格影响了。
                      // pt-10 是对齐普通 App 页：那边内容外面还包了一层 pt-10（见下面的 Regular App page），
                      // 风车页原本直接贴着外层 pt-12，日程卡就比别的页的首行高出 40px。
                      <div className="pt-10 flex-1 min-h-0 w-full flex flex-col gap-5 justify-start overflow-y-auto overscroll-y-contain no-scrollbar">
                          {scheduleChar && (
                              <ScheduleHomeWidget
                                  schedule={scheduleData}
                                  character={scheduleChar}
                                  contentColor={contentColor}
                                  onOpen={() => { setScheduleViewerOpen(true); trackEvent('打开角色日程面板'); }}
                                  acnh={acnh}
                                  paper={paper}
                              />
                          )}
                          {/* 风车格和用户组件排在同一个 4 列网格里：自带那四格各占 2 列 x 2 行，
                              尺寸和原来的 2 列布局一样。合成一个网格才能把组件真的挪到
                              「某一格旁边」；分成上下两块的话，往上拖多远都只会整块地跳。 */}
                          <div
                              data-launcher-page-drop={page.id}
                              className="grid grid-cols-4 gap-x-2 gap-y-5 w-full content-start"
                              // 行高比普通页矮一点：自带四格各占 2 列 x 2 行，
                              // 2*4.6rem + 1.25rem 间距 ≈ 2 列的宽度，这四格才保持原来的正方形。
                              style={{ gridAutoRows: 'minmax(4.6rem, auto)' }}
                          >
                              {pinwheelSlots.map(slot => {
                                  if (slot.kind === 'widget') {
                                      const span = launcherWidgetSpan(slot.widget.size);
                                      return (
                                          <div
                                              key={slot.key}
                                              data-launcher-item={slot.key}
                                              data-launcher-kind="uwidget"
                                              data-launcher-page-id={page.id}
                                              className={`relative min-w-0 place-self-stretch ${layoutEditing ? 'launcher-edit-item' : ''}`}
                                              style={{ gridColumn: `span ${span.cols}`, gridRow: `span ${span.rows}` }}
                                          >
                                              <LauncherUserWidgetView
                                                  widget={slot.widget}
                                                  editing={layoutEditing}
                                                  paper={paper}
                                                  acnh={acnh}
                                                  contentColor={contentColor}
                                              />
                                          </div>
                                      );
                                  }
                                  const cell = slot.appId as 'music' | 'appsA' | 'appsB' | 'image';
                                  return (
                                  <div
                                      key={cell}
                                      data-launcher-item={cell}
                                      data-launcher-kind="widget"
                                      data-launcher-page-id={page.id}
                                      className={`relative min-w-0 place-self-stretch ${layoutEditing ? 'launcher-edit-item' : ''}`}
                                      style={{ gridColumn: 'span 2', gridRow: 'span 2' }}
                                  >
                                      {/* 自带的音乐卡片 / 方图在整理模式下给一个可移除的提示；
                                          真正的移除走「原地松手打开面板」，见 finishLayoutPointer。 */}
                                      {layoutEditing && isLauncherBuiltinWidgetId(cell) && (
                                          <>
                                              <div
                                                  className="absolute left-1.5 top-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center pointer-events-none"
                                                  style={{ background: 'rgba(30,26,22,0.72)', color: '#fffdf8' }}
                                                  aria-hidden="true"
                                              >
                                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.8} stroke="currentColor" className="w-3 h-3">
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                                                  </svg>
                                              </div>
                                              <div
                                                  className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 px-2 py-[2px] rounded-full text-[8px] font-bold whitespace-nowrap pointer-events-none"
                                                  style={{ background: 'rgba(30,26,22,0.66)', color: '#fffdf8' }}
                                              >
                                                  轻点可移除
                                              </div>
                                          </>
                                      )}
                                      {cell === 'music' ? (
                                          <NowPlayingSquareWidget contentColor={contentColor} />
                                      ) : cell === 'appsA' ? (
                                          <AppQuadGrid pageId={page.id} apps={page2QuadA} openApp={openApp} editing={layoutEditing} />
                                      ) : cell === 'appsB' ? (
                                          <AppQuadGrid pageId={page.id} apps={page2QuadB} openApp={openApp} editing={layoutEditing} />
                                      ) : (
                                          <DesktopSquareImage
                                              image={theme.launcherWidgets?.['dsq']}
                                              contentColor={contentColor}
                                              onClick={() => { if (!layoutEditing) openApp(AppID.Appearance); }}
                                              acnh={acnh}
                                          />
                                      )}
                                  </div>
                                  );
                              })}
                          </div>
                      </div>
                  ) : (
                      // Regular App page: optional image/decorations + four-column grid
                      <div className="pt-10 flex-1 min-h-0 flex flex-col relative">
                          {/* 旧的 tl / tr / wide 固定图片槽位已迁移成可拖动的桌面组件
                              （见 utils/launcherUserWidgets.ts 的 migrateLegacyLauncherWidgets），
                              这里只剩自由摆放的装饰贴纸。 */}
                          {page?.showMedia && theme.desktopDecorations && theme.desktopDecorations.length > 0 && (
                            <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                              {theme.desktopDecorations.map(deco => (
                                <img
                                  key={deco.id}
                                  src={deco.content}
                                  alt=""
                                  loading="lazy"
                                  className="absolute w-16 h-16 object-contain select-none"
                                  style={{
                                    left: `${deco.x}%`,
                                    top: `${deco.y}%`,
                                    transform: `translate(-50%, -50%) scale(${deco.scale}) rotate(${deco.rotation}deg)${deco.flip ? ' scaleX(-1)' : ''}`,
                                    opacity: deco.opacity,
                                    zIndex: deco.zIndex,
                                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
                                  }}
                                />
                              ))}
                            </div>
                          )}

                          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain no-scrollbar">
                              <AppGridPage
                                    pageId={page?.id || `launcher-page-${idx}`}
                                    apps={pageApps}
                                    openApp={openApp}
                                    editing={layoutEditing}
                                    userWidgets={userWidgets}
                                    paper={paper}
                                    acnh={acnh}
                                    contentColor={contentColor}
                              />
                          </div>
                      </div>
                  )}
              </div>
              );
          })}

      </div>

      {/* Page Indicators
          整理模式下 touch-action 是 none，手指划不动页——不给个入口的话，
          「加组件」和「删自带组件」这些要落到特定页上的操作就够不着了。
          所以编辑时把页码点变成可点的跳页按钮，平时仍是纯装饰。 */}
      <div
          className={`absolute left-0 w-full flex justify-center gap-1 z-20 ${layoutEditing ? '' : 'pointer-events-none'}`}
          style={{ bottom: `calc(${launcherBottomInset} + 5.5rem)` }}
          aria-hidden={layoutEditing ? undefined : true}
      >
          {Array.from({ length: totalPages }).map((_, i) => (
              // 每个页码占固定 16px 槽位，只动画内部圆点。旧版直接动画 flex child 的宽度，
              // 快速划过多页时 WebKit 会一边改宽一边重算整行居中，几个过渡态就会挤成方块串。
              layoutEditing ? (
                  <button
                      key={i}
                      type="button"
                      onClick={() => goToLauncherPage(i)}
                      aria-label={`跳到第 ${i + 1} 页`}
                      className="flex h-6 w-5 shrink-0 items-center justify-center active:scale-90 transition-transform"
                  >
                      <span
                        className={`h-1.5 rounded-full transform-gpu transition-[width,opacity] duration-300 ${activePageIndex === i ? 'w-4 opacity-100' : 'w-2 opacity-55'}`}
                        style={{ backgroundColor: contentColor }}
                      />
                  </button>
              ) : (
                  <div key={i} className="flex h-1.5 w-4 shrink-0 items-center justify-center">
                      <div
                        className={`h-1.5 rounded-full transform-gpu transition-[width,opacity] duration-300 ${activePageIndex === i ? 'w-4 opacity-100' : 'w-1.5 opacity-40'}`}
                        style={{ backgroundColor: contentColor }}
                      />
                  </div>
              )
          ))}
      </div>

      {/* Floating Dock - Updated Margin and Safe Area handling */}
      <div
           className="mt-auto flex justify-center w-full px-4 relative z-30"
           style={{ paddingBottom: launcherBottomInset }}
      >
           <div
             className={`rounded-[1.75rem] px-4 py-3 flex gap-3 sm:gap-6 items-center mx-auto max-w-full justify-between overflow-x-auto no-scrollbar transform-gpu ${acnh || paper ? '' : 'bg-white/30 border border-white/25 shadow-[0_8px_40px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]'}`}
             data-launcher-dock-drop="true"
             style={acnh ? { background: 'transparent' } : paper ? {
               background: 'rgba(224,221,215,0.42)',
               border: '1px solid rgba(91,72,51,0.07)',
               boxShadow: '0 6px 18px rgba(91,72,51,0.065)',
             } : undefined}
           >
              {dockAppsConfig.map((app, index) => (
                  <div key={app.id} data-launcher-item={app.id} data-launcher-kind="dock" data-launcher-dock-index={index} className={`relative ${layoutEditing ? 'launcher-edit-item' : ''}`}>
                        <AppIcon app={app} onClick={() => { if (!layoutEditing) openApp(app.id); }} variant="dock" size="md" />
                        {app.id === 'chat' && totalUnread > 0 && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center border-2 border-white/20 shadow-sm font-bold pointer-events-none animate-pop-in">
                                {totalUnread > 9 ? '9+' : totalUnread}
                            </div>
                        )}
                   </div>
               ))}
           </div>
      </div>

      {builtinWidgetSheet && (
          <LauncherBuiltinWidgetSheet
              id={builtinWidgetSheet}
              paper={paper}
              onRemove={() => handleRemoveBuiltinWidget(builtinWidgetSheet)}
              onClose={() => setBuiltinWidgetSheet(null)}
          />
      )}

      {widgetSheet && (widgetSheet.mode === 'add' || editingUserWidget) && (
          <LauncherWidgetSheet
              mode={widgetSheet.mode}
              widget={editingUserWidget}
              paper={paper}
              busy={widgetBusy}
              hiddenBuiltins={hiddenBuiltinWidgets}
              onRestoreBuiltin={handleRestoreBuiltinWidget}
              onCreate={handleAddUserWidget}
              onChangeSize={(size) => patchEditingWidget({ size })}
              onPickFile={(file) => { void handleUserWidgetFile(file); }}
              onApplyUrl={handleUserWidgetUrl}
              onToggleFit={() => patchEditingWidget({ fit: editingUserWidget?.fit === 'contain' ? 'cover' : 'contain' })}
              onToggleFrame={() => patchEditingWidget({ frame: !editingUserWidget?.frame })}
              onRemove={handleUserWidgetRemove}
              onClose={() => setWidgetSheet(null)}
          />
      )}

      {layoutEditing && pageManagerOpen && (
          <LauncherPageManager
              pages={launcherPageLayout.pages}
              appById={appById}
              paper={paper}
              onAddPage={handleAddLauncherPage}
              onDeletePage={handleDeleteLauncherPage}
              onClose={() => setPageManagerOpen(false)}
              onPointerDown={handlePageManagerPointerDown}
              onPointerMove={handlePageManagerPointerMove}
              onPointerUp={handlePageManagerPointerUp}
              onPointerCancel={handlePageManagerPointerCancel}
          />
      )}

      <ScheduleFullscreenViewer
          open={scheduleViewerOpen}
          onClose={() => setScheduleViewerOpen(false)}
          characters={characters}
          activeCharId={scheduleChar?.id || null}
          onSwitchCharacter={(id) => setScheduleCharId(id)}
          schedule={scheduleData}
          activeCharacter={scheduleChar}
          contentColor={contentColor}
      />

    </div>
  );
};

export default Launcher;
