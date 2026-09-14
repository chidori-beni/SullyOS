import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppID, ChatFineTuneFields, OSTheme } from '../../types';
import { WhiteboxSound } from '../../utils/whiteboxSound';
import { ChatAppearanceEditor } from '../appearance/ChatAppearanceEditor';
import ChatFineTunePanel from './ChatFineTunePanel';
import ChromeCssEditor from './ChromeCssEditor';
import ChatCardCssEditor from '../appearance/ChatCardCssEditor';
import CssSlotEditor from '../appearance/CssSlotEditor';
import { BUILTIN_DIALOG_CSS_PRESETS, DIALOG_CSS_AI_PROMPT, DIALOG_HOOKS } from '../../utils/globalCss';
import WhiteboxSoundEditor from './WhiteboxSoundEditor';

/**
 * 角色「装扮」总面板 —— 从聊天「＋」菜单的单个「装扮」入口进入。
 *
 * 整合前：微调 / 白框 / 提示音 分成三个格子（还跨了两页），聊天背景图更是躲在
 * 「设置」弹窗的 API 配置和上下文条数中间。四处都是同一件事——把这个聊天打扮好看，
 * 却要在四个地方找。整合后统一进这一个底部抽屉，内部分页签，功能一个没少：
 *
 *  - 微调：char.chatFineTune（跟随全局 / 单独定制），另可切到悬浮模式边看边调
 *  - 背景：char.chatBackground（从「设置」弹窗搬来）
 *  - 气泡：跳「角色」页穿戴 / 去气泡工坊制作
 *  - 白框：char.chromeCustomCss（含坏 CSS 救援键）
 *  - 提示音：char.chatSound / 绑定进白框 CSS 指令
 *
 * 顶部还有一层作用域切换：「这个角色」= 上面这五项；「所有聊天」= 原「外观 App →
 * 聊天装扮」整页（聊天壳 / 头部 / 气泡与头像 / 全局微调 / 输入栏 / 全局提示音 /
 * 横幅 CSS / 白框还原），以 embedded 模式嵌进来。搬过来的理由就一个：聊天装扮的
 * 预览对象是聊天本身，放在外观 App 里只能对着一个假的迷你聊天调；放在这里，抽屉
 * 后面就是真聊天，改一下立刻看到真效果。外观 App 从此只管主页。
 *
 * 抽屉刻意只占下半屏（max-h 68vh，无遮罩色块），上方真聊天保持可见 —— 白框和微调
 * 本来就靠「上面就是实时预览」来调，遮死了反而没法用。
 */

/**
 * 重排后的五个页签（2026-09-04）。
 *
 * 旧版是「顶部作用域切换 + 只有角色侧才有页签」——「所有聊天」那边是一条十来个 section
 * 的长滚动，于是同一件事（比如气泡）在两个作用域下的入口长得完全不一样，很难上手。
 * 现在两个作用域**共用同一组页签**，内容按 (作用域 × 页签) 取；
 * 三份手写 CSS 也从三处收进「代码」一处。
 *
 * 'global' 保留为兼容值：老的跳转 payload（onOpenDecor('global')）还在用它，
 * 收到时当成「所有聊天 + 样式页」。
 */
export type ChatDecorTab = 'style' | 'bubble' | 'background' | 'code' | 'sound'
    // 兼容旧 payload
    | 'fine-tune' | 'chrome' | 'global';

type DecorTabId = 'style' | 'bubble' | 'background' | 'code' | 'sound';

const TABS: ReadonlyArray<{ id: DecorTabId; label: string }> = [
    { id: 'style', label: '样式' },
    { id: 'bubble', label: '气泡' },
    { id: 'background', label: '背景' },
    { id: 'code', label: '代码' },
    { id: 'sound', label: '声音' },
];

/** 旧页签名 → 新页签名。 */
const normalizeTab = (tab: ChatDecorTab): DecorTabId => {
    if (tab === 'fine-tune' || tab === 'global') return 'style';
    if (tab === 'chrome') return 'code';
    return tab as DecorTabId;
};

type Props = {
    charName: string;
    tab: ChatDecorTab;
    onChangeTab: (tab: ChatDecorTab) => void;
    onClose: () => void;

    /** 微调：value 是「全局打底 + 角色覆盖」合并后的生效值 */
    fineTuneValue: ChatFineTuneFields;
    fineTuneCustomized: boolean;
    onToggleFineTuneCustomized: (next: boolean) => void;
    onChangeFineTune: (patch: Partial<ChatFineTuneFields>) => void;
    onClearFineTune: () => void;
    /** 切到悬浮圆气泡模式（关掉抽屉，把整个聊天让出来当预览） */
    onOpenFloatingFineTune: () => void;

    /** 背景：角色那张 + 全局那张，两边同一套控件 */
    chatBackground?: string;
    onUploadBackground: (file: File) => void;
    onRemoveBackground: () => void;
    globalBackground?: string;
    onUploadGlobalBackground: (file: File) => void;
    onRemoveGlobalBackground: () => void;

    /** 气泡 */
    onOpenBubblePicker: () => void;
    onOpenThemeMaker: () => void;

    /** 代码：白框 / 卡片 / 聊天弹窗，三份都能按角色单独写，叠在全局那份之上 */
    chromeCss: string;
    onChangeChromeCss: (css: string) => void;
    onResetChromeCss: () => void;
    charCardCss: string;
    onChangeCharCardCss: (css: string) => void;
    charDialogCss: string;
    onChangeCharDialogCss: (css: string) => void;

    /** 提示音 */
    sound: WhiteboxSound | null;
    soundBound: boolean;
    onChangeSound: (sound: WhiteboxSound | null) => void;
    onChangeSoundBound: (bound: boolean) => void;

    /** 「所有聊天」作用域：原外观 App 那一页，整套全局聊天装扮 */
    theme: OSTheme;
    onUpdateTheme: (updates: Partial<OSTheme>) => void;
    /**
     * 「这个角色」作用域用的生效值 = 全局 + 该角色的 16 项外观覆盖。
     * 两个作用域共用同一套控件，区别只在读哪份值、写哪儿。
     */
    charAppearanceTheme: OSTheme;
    /** 角色侧的写入口：调用方负责把补丁拆进 chatAppearance / chatFineTune。 */
    onUpdateCharAppearance: (patch: Partial<OSTheme>) => void;
    onResetAllChrome: () => void;
    onOpenApp: (appId: AppID) => void;
    /** 卡片 CSS 的保存 / 重命名 / 删除结果走聊天页的 toast。 */
    onNotify?: (message: string, kind: 'success' | 'error') => void;
};

/** 提示语按 (作用域 × 页签) 给，两边说的不是一回事。 */
const TAB_HINTS: Record<DecorTabId, { char: string; global: string }> = {
    style: {
        char: '聊天壳、顶栏、气泡与头像、输入栏——跟「所有聊天」同样 25 项，只对 ta 生效。',
        global: '全部私聊的打底：聊天壳、顶栏、气泡与头像、输入栏。',
    },
    bubble: {
        char: '气泡穿在角色身上，没有全局/角色之分——这一页两边一样。',
        global: '气泡穿在角色身上，没有全局/角色之分——这一页两边一样。',
    },
    background: {
        char: '底纹 + 背景图，只对 ta 生效。',
        global: '所有私聊共用的底纹 / 网格 / 渐变。',
    },
    code: {
        char: '白框 / 卡片 / 聊天弹窗三份 CSS，只对 ta 生效，叠在「所有聊天」之上。',
        global: '白框 / 卡片 / 聊天弹窗三份 CSS，所有私聊的打底。',
    },
    sound: {
        char: 'ta 新发的消息成为最新一条时响一次。不设则用全局默认。',
        global: '没单独设提示音的角色回落到这里。',
    },
};

const ChatDecorSheet: React.FC<Props> = ({
    charName,
    tab,
    onChangeTab,
    onClose,
    fineTuneValue,
    fineTuneCustomized,
    onToggleFineTuneCustomized,
    onChangeFineTune,
    onClearFineTune,
    onOpenFloatingFineTune,
    chatBackground,
    onUploadBackground,
    onRemoveBackground,
    globalBackground,
    onUploadGlobalBackground,
    onRemoveGlobalBackground,
    onOpenBubblePicker,
    onOpenThemeMaker,
    chromeCss,
    onChangeChromeCss,
    onResetChromeCss,
    charCardCss,
    onChangeCharCardCss,
    charDialogCss,
    onChangeCharDialogCss,
    sound,
    soundBound,
    onChangeSound,
    onChangeSoundBound,
    theme,
    onUpdateTheme,
    charAppearanceTheme,
    onUpdateCharAppearance,
    onResetAllChrome,
    onOpenApp,
    onNotify,
}) => {
    const bgInputRef = useRef<HTMLInputElement>(null);
    const active = normalizeTab(tab);
    // 作用域独立于页签。老版本这俩纠缠在一起（'global' 既是作用域又是页签），
    // 于是「所有聊天」那边根本没有页签、是一条长滚动，两边入口长得完全不一样。
    const [scope, setScope] = useState<'char' | 'global'>(tab === 'global' ? 'global' : 'char');
    const isGlobal = scope === 'global';
    // 「先躲开，让我看看效果」：把抽屉整个收起来，只留这颗小圆钮。原版有，重排时补回来。
    const [peek, setPeek] = useState(false);

    const globalEditor = (section: 'style' | 'background' | 'code' | 'sound') => (
        <ChatAppearanceEditor
            embedded
            section={section}
            theme={theme}
            updateTheme={onUpdateTheme}
            onResetAllChrome={onResetAllChrome}
            onOpenApp={onOpenApp}
            onNotify={onNotify}
            backgroundImage={globalBackground}
            onUploadBackground={onUploadGlobalBackground}
            onRemoveBackground={onRemoveGlobalBackground}
        />
    );

    return (
        <div className="sully-ui-overlay fixed inset-0 z-[110] flex items-end justify-center bg-black/5" onClick={onClose}>
            {/* 一键预览：收起抽屉看真效果，再点一下回来。抽屉收起时它仍然浮着。 */}
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPeek(p => !p); }}
                aria-pressed={peek}
                aria-label={peek ? '展开装扮面板' : '收起面板，预览当前效果'}
                className="fixed right-3 z-[112] flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-primary shadow-lg ring-1 ring-primary/25 transition-all active:scale-90"
                style={{ bottom: 'calc(var(--safe-bottom) + 18px)' }}
            >
                <span className="text-[17px] font-bold leading-none">{peek ? '⌃' : '⌄'}</span>
            </button>

            {!peek && (
            <div
                className="sully-ui-sheet sully-ui-plain w-full max-h-[74vh] overflow-y-auto overflow-x-hidden rounded-t-3xl border-t border-white/60 bg-white/95 p-5 shadow-[0_-12px_40px_rgba(15,23,42,0.18)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ paddingBottom: 'calc(1.25rem + var(--safe-bottom))' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sully-ui-head mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="sully-ui-title text-sm font-bold text-slate-800">装扮 · {isGlobal ? '所有聊天' : charName}</div>
                        <div className="sully-ui-hint mt-0.5 text-[10px] leading-relaxed text-slate-400">
                            {isGlobal ? TAB_HINTS[active].global : TAB_HINTS[active].char}
                        </div>
                    </div>
                    <button onClick={onClose} className="sully-ui-close shrink-0 px-2 text-xl leading-none text-slate-400 hover:text-slate-600">{'×'}</button>
                </div>

                {/* 作用域：改这个角色，还是改全部私聊的打底 */}
                <div className="mb-3 flex gap-1 rounded-2xl bg-slate-100 p-1">
                    {([['char', charName], ['global', '所有聊天']] as const).map(([id, label]) => (
                        <button
                            key={id}
                            onClick={() => setScope(id)}
                            aria-pressed={scope === id}
                            className={`sully-ui-tab flex-1 truncate rounded-xl py-1.5 text-[11px] font-bold transition-all active:scale-[0.98] ${
                                scope === id ? 'sully-ui-tab-on bg-white text-slate-800 shadow-sm' : 'text-slate-400'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* 五个页签，两个作用域共用同一组 */}
                <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 no-scrollbar">
                    {TABS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onChangeTab(item.id)}
                            className={`sully-ui-tab shrink-0 rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 ${
                                active === item.id ? 'sully-ui-tab-on bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                {/* ══ 样式 ══ */}
                {active === 'style' && (isGlobal ? globalEditor('style') : (
                    <>
                        <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <div className="min-w-0 pr-3">
                                <div className="text-[11px] font-bold text-slate-700">{fineTuneCustomized ? '为 TA 单独定制中' : '跟随全局设置（默认）'}</div>
                                <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                                    {fineTuneCustomized
                                        ? '只有你改过的项目覆盖全局，其余仍跟随「所有聊天」。关掉开关回到跟随全局，定制内容保留。'
                                        : '当前用的是「所有聊天」里的设置。打开开关即可为这个角色单独定制。'}
                                </div>
                            </div>
                            <button
                                onClick={() => onToggleFineTuneCustomized(!fineTuneCustomized)}
                                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${fineTuneCustomized ? 'bg-primary' : 'bg-slate-300'}`}
                                aria-pressed={fineTuneCustomized}
                            >
                                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${fineTuneCustomized ? 'left-[22px]' : 'left-0.5'}`} />
                            </button>
                        </div>
                        {fineTuneCustomized && (
                            <>
                                {/* 跟「所有聊天」**同一套控件**（同一个组件、同样 6 页），
                                    只是读的是这个角色的生效值、写的是这个角色的覆盖。
                                    原来这里只有 9 项微调，现在 25 项全在——
                                    那 9 项就在这套控件的第 4 页，没有少，只是不再单独列一遍。 */}
                                <ChatAppearanceEditor
                                    embedded
                                    section="style"
                                    scopeLabel="character"
                                    theme={charAppearanceTheme}
                                    updateTheme={onUpdateCharAppearance}
                                    onOpenApp={onOpenApp}
                                    onNotify={onNotify}
                                />
                                <button
                                    onClick={onOpenFloatingFineTune}
                                    className="mt-3 w-full rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-[11px] font-bold text-primary transition-all active:scale-[0.99]">
                                    切到悬浮小窗（边看整屏聊天边调）
                                </button>
                                <button
                                    onClick={onClearFineTune}
                                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-bold text-slate-500 transition-all hover:bg-slate-100 active:scale-[0.99]">
                                    清除定制，回到跟随全局
                                </button>
                            </>
                        )}
                        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                            只影响私聊，群聊不受影响。手写过「代码」页 CSS 的不用担心：<b>自定义 CSS 优先级更高</b>，永远盖得过这里。
                        </p>
                    </>
                ))}

                {/* ══ 气泡 ══ 气泡是「穿在角色身上」的，跟作用域无关 ——
                    所以这一页不按作用域分岔，两边就是同一块，也不重复给两遍入口。 */}
                {active === 'bubble' && (
                    <div className="space-y-2">
                        <button
                            onClick={onOpenThemeMaker}
                            className="w-full rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3.5 text-left transition-all active:scale-[0.99]"
                        >
                            <div className="text-[12px] font-bold text-primary">打开气泡工坊 →</div>
                            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                                颜色、圆角、贴图、装饰都在这里捏；做好的气泡也在这里挑来穿上。
                            </div>
                        </button>
                        <button
                            onClick={onOpenBubblePicker}
                            className="w-full rounded-2xl bg-slate-50 px-4 py-2.5 text-left transition-all active:scale-[0.99]"
                        >
                            <div className="text-[11px] font-bold text-slate-600">直接去「角色」页挑一套穿上 →</div>
                        </button>
                        <p className="pt-1 text-[10px] leading-relaxed text-slate-400">
                            撞车时谁说了算：<b className="text-amber-600">可视化设置 &lt; 气泡主题 &lt; 自定义 CSS</b>。
                        </p>
                    </div>
                )}

                {/* ══ 背景 ══ 两边同一套控件：底纹 + 背景图。
                    角色侧不再自己画一份上传框，避免两边长得不一样。 */}
                {active === 'background' && (isGlobal ? globalEditor('background') : (
                    <ChatAppearanceEditor
                        embedded
                        section="background"
                        scopeLabel="character"
                        theme={charAppearanceTheme}
                        updateTheme={onUpdateCharAppearance}
                        onOpenApp={onOpenApp}
                        onNotify={onNotify}
                        backgroundImage={chatBackground}
                        onUploadBackground={onUploadBackground}
                        onRemoveBackground={onRemoveBackground}
                    />
                ))}

                {/* ══ 代码 ══ 两边同样三份、同样顺序：白框 → 卡片 → 聊天弹窗。
                    角色那三份都叠在全局之上，冲突时角色赢（注入顺序在 Chat.tsx）。 */}
                {active === 'code' && (isGlobal ? globalEditor('code') : (
                    <div className="space-y-5">
                        <div>
                            <div className="text-[11px] font-bold text-slate-600">白框 · CSS</div>
                            <div className="mt-0.5 mb-2 text-[10px] leading-relaxed text-slate-400">
                                聊天界面各零件（<code>.sully-chat-*</code>）。↑ 上方就是实时预览。
                            </div>
                            <ChromeCssEditor value={chromeCss} onChange={onChangeChromeCss} />
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-slate-600">卡片 · CSS</div>
                            <div className="mt-0.5 mb-2 text-[10px] leading-relaxed text-slate-400">
                                ta 发来的彼方 / 通话 / 日程邀约等卡片（<code>.sully-chat-card</code>）。
                            </div>
                            {/* 跟「所有聊天」同一个编辑器（内置样式、卡片清单都在）。
                                预设库共用全局那一份 —— 预设是「一套写好的样式」，跟用在谁身上无关。 */}
                            <ChatCardCssEditor
                                value={charCardCss}
                                presets={theme.chatCardCssPresets || []}
                                onPatch={({ css, presets }) => { onChangeCharCardCss(css); onUpdateTheme({ chatCardCssPresets: presets }); }}
                                onNotify={onNotify}
                            />
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-slate-600">聊天弹窗 · CSS</div>
                            <div className="mt-0.5 mb-2 text-[10px] leading-relaxed text-slate-400">
                                在 ta 的聊天里点开的设置框 / 抽屉（<code>.sully-ui-*</code>）。
                            </div>
                            <CssSlotEditor
                                slotLabel="聊天弹窗"
                                hooks={DIALOG_HOOKS}
                                aiPrompt={DIALOG_CSS_AI_PROMPT}
                                builtins={BUILTIN_DIALOG_CSS_PRESETS}
                                exportName="sullyos-chat-dialogs.css"
                                scopeHint="这段 CSS 只在这个角色的聊天页生效。"
                                value={charDialogCss}
                                presets={theme.chatDialogCssPresets || []}
                                onPatch={({ css, presets }) => { onChangeCharDialogCss(css); onUpdateTheme({ chatDialogCssPresets: presets }); }}
                                onNotify={onNotify}
                            />
                        </div>
                        <p className="text-[10px] leading-relaxed text-slate-400">
                            这三份都<b>叠在「所有聊天」那三份之上</b>，冲突时这里赢。
                        </p>
                    </div>
                ))}

                {/* ══ 声音 ══ */}
                {active === 'sound' && (isGlobal ? globalEditor('sound') : (
                    <WhiteboxSoundEditor
                        sound={sound}
                        bound={soundBound}
                        onChangeSound={onChangeSound}
                        onChangeBound={onChangeSoundBound}
                        hint={<>🔔 只在 <b>ta 新发的消息成为最新一条</b> 时响一次。这里是<b>该角色专属</b>；不设则用「所有聊天」里的全局默认。</>}
                    />
                ))}
            </div>
            )}

            {/* 脱离 CSS 控制的救援键：只在「代码」页签的角色侧出现。portal 到 body 在聊天 DOM 之外，
                加 id 守护（#sully-safe-reset 特异性高于 *），连 *{display:none!important} 也盖不掉，
                保证刚粘进坏 CSS 当场崩掉时，这个还原键一定点得到。 */}
            {active === 'code' && !isGlobal && createPortal(
                <>
                    <style>{`#sully-safe-reset{position:fixed!important;top:calc(var(--safe-top) + 6px)!important;left:50%!important;transform:translateX(-50%)!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;display:flex!important;z-index:2147483647!important;}`}</style>
                    <button
                        id="sully-safe-reset"
                        onClick={onResetChromeCss}
                        style={{
                            position: 'fixed', top: 'calc(var(--safe-top) + 6px)', left: '50%', transform: 'translateX(-50%)',
                            zIndex: 2147483647, display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '5px 12px', borderRadius: '999px',
                            background: 'rgba(15,23,42,0.62)', color: '#fff', fontSize: '11px', fontWeight: 700,
                            border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
                        }}
                    >⟲ 还原此角色白框</button>
                </>,
                document.body,
            )}
        </div>
    );
};

export default ChatDecorSheet;
