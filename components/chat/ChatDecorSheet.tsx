import React, { useRef } from 'react';
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

/** 'global' 不是角色页签，是「所有聊天」作用域本身（内容由 ChatAppearanceEditor 自己分页）。 */
export type ChatDecorTab = 'fine-tune' | 'background' | 'bubble' | 'chrome' | 'sound' | 'global';

const CHAR_TABS: ReadonlyArray<{ id: ChatDecorTab; label: string }> = [
    { id: 'fine-tune', label: '微调' },
    { id: 'background', label: '背景' },
    { id: 'bubble', label: '气泡' },
    { id: 'chrome', label: '白框' },
    { id: 'sound', label: '提示音' },
];

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

const TAB_HINTS: Record<ChatDecorTab, string> = {
    'fine-tune': '头像、字号、间距这些细节。不改就跟随「所有聊天」里的全局设置。',
    background: '这个角色聊天页的背景图，只对 ta 生效。',
    bubble: '气泡的颜色、圆角、贴图在「气泡工坊」里做，做好后回来给 ta 穿上。',
    chrome: '手写 CSS 深度魔改顶栏 / 输入栏 / 任意零件。↑ 上方聊天界面即实时预览。',
    sound: 'ta 新发的消息成为最新一条时响一次。不设则用全局默认提示音。',
    global: '这里改的是全部私聊的打底样式，↑ 上方就是真效果。单个角色的定制在「这个角色」里。',
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
    const globalScope = tab === 'global';

    return (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/5" onClick={onClose}>
            <div
                className={`w-full ${globalScope ? 'max-h-[78vh]' : 'max-h-[68vh]'} overflow-y-auto rounded-t-3xl border-t border-white/60 bg-white/95 p-5 shadow-[0_-12px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
                style={{ paddingBottom: 'calc(1.25rem + var(--safe-bottom))' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800">装扮 · {globalScope ? '所有聊天' : charName}</div>
                        <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{TAB_HINTS[tab]}</div>
                    </div>
                    <button onClick={onClose} className="shrink-0 px-2 text-xl leading-none text-slate-400 hover:text-slate-600">{'×'}</button>
                </div>

                {/* 作用域：先分清「只动这个角色」还是「动所有私聊的打底」——这是聊天装扮里
                    最容易搞混的一层，以前它靠「一个在聊天里、一个在外观 App 里」来区分，
                    现在两边都在这个抽屉，就得把它明写成一个开关。 */}
                <div className="mb-3 flex gap-1 rounded-2xl bg-slate-100 p-1">
                    {([['char', '这个角色'], ['global', '所有聊天']] as const).map(([scope, label]) => {
                        const active = scope === 'global' ? globalScope : !globalScope;
                        return (
                            <button
                                key={scope}
                                onClick={() => onChangeTab(scope === 'global' ? 'global' : 'fine-tune')}
                                aria-pressed={active}
                                className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition-all active:scale-[0.98] ${
                                    active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'
                                }`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                {/* 角色作用域的五个页签。「所有聊天」那边不用这排——它自己内部就有分页。 */}
                {!globalScope && (
                <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 no-scrollbar">
                    {CHAR_TABS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onChangeTab(item.id)}
                            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 ${
                                tab === item.id ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                )}

                {globalScope && (
                    <ChatAppearanceEditor
                        embedded
                        theme={theme}
                        updateTheme={onUpdateTheme}
                        onResetAllChrome={onResetAllChrome}
                        onOpenApp={onOpenApp}
                        onNotify={onNotify}
                    />
                )}

                {tab === 'fine-tune' && (
                    <>
                        <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <div className="min-w-0 pr-3">
                                <div className="text-[11px] font-bold text-slate-700">{fineTuneCustomized ? '为 TA 单独定制中' : '跟随全局设置（默认）'}</div>
                                <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                                    {fineTuneCustomized
                                        ? '只有你改过的项目覆盖全局，其余仍跟随「所有聊天」里的全局设置。关掉开关回到跟随全局，定制内容保留。'
                                        : '当前用的是「所有聊天」里的全局设置。打开开关即可为这个角色单独定制。'}
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
                                    切到悬浮小窗（收起抽屉，边看整屏聊天边调）
                                </button>
                                <button
                                    onClick={onClearFineTune}
                                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-bold text-slate-500 transition-all hover:bg-slate-100 active:scale-[0.99]">
                                    清除定制，回到跟随全局
                                </button>
                            </>
                        )}
                        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                            只影响私聊界面，群聊不受影响。手写过「白框」自定义 CSS 的话不用担心：<b>自定义 CSS 优先级更高</b>，永远盖得过这里的设置。
                        </p>
                    </>
                )}

                {tab === 'background' && (
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
                            背景图原来在「设置」弹窗里，现在归到装扮这边。想改所有聊天共用的底纹 / 网格 / 渐变，切到上面的「所有聊天」→「聊天壳」。
                        </p>
                    </>
                )}

                {tab === 'bubble' && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                            <div className="min-w-0 pr-3">
                                <div className="text-[11px] font-bold text-slate-700">给 TA 换一套气泡</div>
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

                {tab === 'chrome' && (
                    <ChromeCssEditor value={chromeCss} onChange={onChangeChromeCss} />
                )}

                {tab === 'sound' && (
                    <WhiteboxSoundEditor
                        sound={sound}
                        bound={soundBound}
                        onChangeSound={onChangeSound}
                        onChangeBound={onChangeSoundBound}
                        hint={<>🔔 只在 <b>ta 新发的消息成为最新一条</b> 时响一次。这里是<b>该角色专属</b>；不设则用「所有聊天」里的全局默认提示音。</>}
                    />
                )}
            </div>

            {/* 脱离 CSS 控制的救援键：只在「白框」页签打开时出现（平时不显示，不丑）。portal 到 body
                在聊天 DOM 之外 + id 守护(#sully-safe-reset 特异性高于 *)，连 *{display:none!important} 也盖不掉，
                保证你刚粘进坏 CSS 当场崩掉时，这个还原键一定点得到。 */}
            {tab === 'chrome' && createPortal(
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
