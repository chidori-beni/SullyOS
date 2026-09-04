import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppID, ChatFineTuneFields, OSTheme } from '../../types';
import { WhiteboxSound } from '../../utils/whiteboxSound';
import { ChatAppearanceEditor } from '../appearance/ChatAppearanceEditor';
import ChatFineTunePanel from './ChatFineTunePanel';
import ChromeCssEditor from './ChromeCssEditor';
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

    /** 背景 */
    chatBackground?: string;
    onUploadBackground: (file: File) => void;
    onRemoveBackground: () => void;

    /** 气泡 */
    onOpenBubblePicker: () => void;
    onOpenThemeMaker: () => void;

    /** 白框 */
    chromeCss: string;
    onChangeChromeCss: (css: string) => void;
    onResetChromeCss: () => void;

    /** 提示音 */
    sound: WhiteboxSound | null;
    soundBound: boolean;
    onChangeSound: (sound: WhiteboxSound | null) => void;
    onChangeSoundBound: (bound: boolean) => void;

    /** 「所有聊天」作用域：原外观 App 那一页，整套全局聊天装扮 */
    theme: OSTheme;
    onUpdateTheme: (updates: Partial<OSTheme>) => void;
    onResetAllChrome: () => void;
    onOpenApp: (appId: AppID) => void;
    /** 卡片 CSS 的保存 / 重命名 / 删除结果走聊天页的 toast。 */
    onNotify?: (message: string, kind: 'success' | 'error') => void;
};

/** 提示语按 (作用域 × 页签) 给，两边说的不是一回事。 */
const TAB_HINTS: Record<DecorTabId, { char: string; global: string }> = {
    style: {
        char: '头像、字号、间距这些细节。不改就跟随「所有聊天」。',
        global: '全部私聊的打底：聊天壳、顶栏、气泡与头像、输入栏。',
    },
    bubble: {
        char: '给 ta 穿一套气泡；想做新的去气泡工坊。',
        global: '气泡是穿在角色身上的，没有全局默认——去「这个角色」给每人挑一套。',
    },
    background: {
        char: '只对 ta 生效的背景图。',
        global: '所有私聊共用的底纹 / 网格 / 渐变。',
    },
    code: {
        char: '手写 CSS 魔改这个角色的顶栏 / 输入栏 / 任意零件。',
        global: '三份手写 CSS：聊天弹窗、消息卡片，以及坏 CSS 的救援键。',
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
    onOpenBubblePicker,
    onOpenThemeMaker,
    chromeCss,
    onChangeChromeCss,
    onResetChromeCss,
    sound,
    soundBound,
    onChangeSound,
    onChangeSoundBound,
    theme,
    onUpdateTheme,
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
                className="sully-ui-sheet sully-ui-plain w-full max-h-[74vh] overflow-y-auto rounded-t-3xl border-t border-white/60 bg-white/95 p-5 shadow-[0_-12px_40px_rgba(15,23,42,0.18)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                                <ChatFineTunePanel value={fineTuneValue} onChange={onChangeFineTune} />
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

                {/* ══ 气泡 ══ 两边给同样的两个入口，只是措辞不同 */}
                {active === 'bubble' && (
                    <div className="space-y-2">
                        {isGlobal && (
                            <div className="mb-2 rounded-2xl border border-dashed border-slate-200 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
                                气泡是<b className="text-slate-500">穿在每个角色身上</b>的，没有全局默认。下面两个入口和「{charName}」里是同一个。
                            </div>
                        )}
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <div className="min-w-0 pr-3">
                                <div className="text-[11px] font-bold text-slate-700">换一套气泡</div>
                                <div className="mt-0.5 text-[10px] text-slate-400">在「角色」页选内置或你做过的气泡，点一下就穿上。</div>
                            </div>
                            <button onClick={onOpenBubblePicker} className="shrink-0 rounded-xl bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-all active:scale-95">
                                去选气泡 →
                            </button>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <div className="min-w-0 pr-3">
                                <div className="text-[11px] font-bold text-slate-700">做一套新气泡</div>
                                <div className="mt-0.5 text-[10px] text-slate-400">颜色、圆角、贴图、装饰都在气泡工坊里捏。</div>
                            </div>
                            <button onClick={onOpenThemeMaker} className="shrink-0 rounded-xl bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-all active:scale-95">
                                去气泡工坊 →
                            </button>
                        </div>
                        <p className="pt-1 text-[10px] leading-relaxed text-slate-400">
                            撞车时谁说了算：<b className="text-amber-600">可视化设置 &lt; 气泡主题 &lt; 自定义 CSS</b>。
                        </p>
                    </div>
                )}

                {/* ══ 背景 ══ */}
                {active === 'background' && (isGlobal ? globalEditor('background') : (
                    <>
                        <div
                            onClick={() => bgInputRef.current?.click()}
                            className="relative flex h-32 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-100 hover:border-primary/50"
                        >
                            {chatBackground
                                ? <img src={chatBackground} className="h-full w-full object-cover opacity-60" alt="聊天背景" />
                                : <span className="text-xs text-slate-400">点击上传图片 (原画质)</span>}
                            {chatBackground && <span className="absolute z-10 rounded bg-white/80 px-2 py-1 text-xs">更换</span>}
                        </div>
                        <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && onUploadBackground(e.target.files[0])} />
                        {chatBackground && (
                            <button onClick={onRemoveBackground} className="mt-2 text-[10px] font-bold text-red-400">移除背景</button>
                        )}
                        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                            只对 ta 生效。想改所有聊天共用的底纹，切到上面的「所有聊天」。
                        </p>
                    </>
                ))}

                {/* ══ 代码 ══ 三份手写 CSS 从三个地方收到这一处 */}
                {active === 'code' && (isGlobal ? globalEditor('code') : (
                    <>
                        <div className="mb-2">
                            <div className="text-[11px] font-bold text-slate-600">白框 · CSS</div>
                            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                                这个角色专属，作用于 <code>.sully-chat-*</code> 各零件。↑ 上方聊天界面就是实时预览。
                                卡片和弹窗那两份是全局的，在「所有聊天」里。
                            </div>
                        </div>
                        <ChromeCssEditor value={chromeCss} onChange={onChangeChromeCss} />
                    </>
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
