import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowCounterClockwise,
    Check,
    Copy,
    GearSix,
    X,
} from '@phosphor-icons/react';
import type { ScheduleCardAppearance, ScheduleCardSkinPreset } from '../../types';
import { useOS } from '../../context/OSContext';
import {
    MONO_DOT_SCHEDULE_CSS,
    PLUSH_BEAR_SCHEDULE_CSS,
    SCHEDULE_CARD_PRESETS,
    SCHEDULE_CSS_SCOPE_HINT,
    SCHEDULE_CSS_SCOPE_REGEX,
    applyScheduleSkinPreset,
    removeScheduleSkinPreset,
    renameScheduleSkinPreset,
    resolveScheduleCardPalette,
    upsertScheduleSkinPreset,
} from '../../utils/scheduleAppearance';
import {
    runCssRenderabilityCheck,
    validateScopedCss,
} from '../../utils/scopedCss';

const CSS_TEMPLATES = [
    {
        name: '轻松熊奶油',
        code: PLUSH_BEAR_SCHEDULE_CSS,
    },
    {
        name: '黑白波点',
        code: MONO_DOT_SCHEDULE_CSS,
    },
    {
        name: '柔光玻璃',
        code: `.sully-schedule-root{
  backdrop-filter:blur(18px) saturate(1.25)!important;
  box-shadow:0 18px 50px rgba(43,25,68,.22),inset 0 1px 0 rgba(255,255,255,.22)!important;
}
.sully-schedule-item-current{
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--schedule-accent) 30%,transparent)!important;
}`,
    },
    {
        name: '纸胶带',
        code: `.sully-schedule-root{border-radius:18px!important;box-shadow:0 12px 28px rgba(86,62,42,.16)!important;}
.sully-schedule-header::after{
  content:"";position:absolute;top:-7px;left:50%;width:72px;height:18px;
  transform:translateX(-50%) rotate(-2deg);background:rgba(255,244,197,.68);
  box-shadow:0 2px 4px rgba(91,72,51,.08);
}
.sully-schedule-activity{font-family:"Songti SC",serif!important;letter-spacing:.04em!important;}`,
    },
    {
        name: '夜光边框',
        code: `.sully-schedule-root{
  border:1px solid color-mix(in srgb,var(--schedule-accent) 58%,transparent)!important;
  box-shadow:0 0 28px color-mix(in srgb,var(--schedule-accent) 24%,transparent),inset 0 0 20px rgba(255,255,255,.035)!important;
}
.sully-schedule-time,.sully-schedule-activity{
  text-shadow:0 0 10px color-mix(in srgb,var(--schedule-accent) 38%,transparent)!important;
}`,
    },
];

// 这份提示词是「不用再让 AI 读一遍仓库」的入口：结构、钩子、坑和硬性约束都写在里面，
// 复制出去配一张桌面截图就能让任何 AI 直接产出可用的 CSS。改动卡片结构时记得同步这里。
const AI_PROMPT = `你是 CSS 设计师，请为 SullyOS（一个手机 OS 风格的 React 应用）的「日程卡片」写一段自定义 CSS。
我会把你输出的 CSS 原样粘进应用里的输入框，所以必须严格守下面的规则。

【卡片长什么样】
同一套 CSS 会同时作用在三种卡上：
1. 桌面宽卡（.sully-schedule-widget）：一行小标题 DAILY SCHEDULE + 时间，中间是 72px 角色头像、
   NOW/IDLE 徽标、当前活动标题和一行描述，底部是一排时间点组成的时间线。
2. 桌面方图卡（同样是 .sully-schedule-widget，正方形）：角色图铺满做底，文字压在下方。
3. 完整日程卡（.sully-schedule-card）：头部大标题 Schedule + 日期，中间一张角色看板图，
   下面是一整天的日程列表，每条一格。

【硬性规则】
1. 每一条选择器都必须以 .sully-schedule- 开头，否则应用会判定越界并拒绝保存。
   写子元素要用后代选择器，例如 .sully-schedule-header span{...}，不能写 .sully-schedule-root ~ div 之外的裸选择器。
2. 卡片大量颜色是 JS 内联算出来的，普通规则盖不住，凡是改颜色/背景/边框都要加 !important。
3. 不要用 backdrop-filter、blur()、大面积 filter、无限 animation。手机上会持续重绘、机身发烫。
   要质感请用静态渐变、点阵背景（repeating/radial-gradient）、细边框和淡阴影。
4. 直接输出完整 CSS，不要 markdown 代码围栏，不要解释文字。

【可用钩子】
.sully-schedule-root 所有日程卡根节点 / .sully-schedule-card 完整卡 / .sully-schedule-widget 桌面卡 /
.sully-schedule-header 头部 / .sully-schedule-cover 看板图 / .sully-schedule-list 列表 /
.sully-schedule-item 单条日程 / .sully-schedule-item-current 当前那条 / .sully-schedule-time 时间 /
.sully-schedule-activity 活动标题 / .sully-schedule-description 描述 / .sully-schedule-timeline 底部时间线 /
.sully-schedule-settings 右上角齿轮。

【可用变量】（在 .sully-schedule-root 上重新定义，能顺带影响一部分子元素）
--schedule-bg 背景、--schedule-base 纯色底、--schedule-text 文字、--schedule-accent 强调色、
--schedule-accent-soft 强调色淡版、--schedule-line 描边。

【没有专用钩子的元素怎么定位】
这些节点没给 class 钩子，但带 Tailwind 类名，可以用「作用域类 + 属性选择器」抓：
- 角色头像框：.sully-schedule-widget div[class*="rounded-2xl"]
- NOW / IDLE 徽标：.sully-schedule-widget span[class*="rounded-full"]
- 右侧展开按钮：.sully-schedule-widget div[class*="w-8"]
- 头部那条分隔线：.sully-schedule-header div[class*="h-px"]
- 角落光晕 / 左侧竖条 / 模糊底图（想去掉就 display:none）：
  .sully-schedule-root div[class*="-top-12"]、div[class*="w-[3px]"]、div[class*="opacity-25"]

【我要的风格】
（用几句话描述，或者直接附一张桌面截图，例如：奶白色底、暖棕色字、圆角、细描边、
小圆点纹理、日系毛绒玩具风，克制不花哨）：______`;

function defaultDraft(current?: ScheduleCardAppearance): ScheduleCardAppearance {
    return {
        preset: current?.preset || 'original',
        background: current?.background || '#21192b',
        textColor: current?.textColor || '#f8f3ff',
        accentColor: current?.accentColor || '#c9a7ff',
        customCss: current?.customCss || '',
        skinPresetId: current?.skinPresetId,
        skinPresets: current?.skinPresets || [],
    };
}

export const ScheduleCustomCssStyle: React.FC = () => {
    const { theme } = useOS();
    const css = theme.scheduleCardAppearance?.customCss || '';
    const validation = useMemo(
        () => validateScopedCss(css, SCHEDULE_CSS_SCOPE_REGEX, SCHEDULE_CSS_SCOPE_HINT),
        [css],
    );
    if (!css.trim() || !validation.isValid) return null;
    return <style>{css}</style>;
};

const ScheduleAppearanceButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { theme, updateTheme, addToast } = useOS();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<ScheduleCardAppearance>(() =>
        defaultDraft(theme.scheduleCardAppearance)
    );
    const [copied, setCopied] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');

    useEffect(() => {
        if (!open) return;
        setDraft(defaultDraft(theme.scheduleCardAppearance));
    }, [open, theme.scheduleCardAppearance]);

    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [open]);

    /** 手动改配色或 CSS 后就不再算「正在用某个预设」，避免列表上的对勾骗人。 */
    const editDraft = (patch: Partial<ScheduleCardAppearance>) =>
        setDraft(current => ({ ...current, ...patch, skinPresetId: undefined }));

    const validation = useMemo(
        () => validateScopedCss(
            draft.customCss || '',
            SCHEDULE_CSS_SCOPE_REGEX,
            SCHEDULE_CSS_SCOPE_HINT,
        ),
        [draft.customCss],
    );
    const preview = resolveScheduleCardPalette(draft, theme.hue, theme.contentColor || '#ffffff');

    const stop: React.MouseEventHandler = event => {
        event.preventDefault();
        event.stopPropagation();
    };

    const save = async () => {
        const renderability = runCssRenderabilityCheck(draft.customCss || '', validation);
        if (!renderability.ok) {
            addToast(renderability.message, 'error');
            return;
        }
        await updateTheme({ scheduleCardAppearance: { ...draft } });
        addToast('日程卡片样式已同步', 'success');
        setOpen(false);
    };

    const reset = async () => {
        // 只还原当前皮肤，保存过的预设留着，否则一次「还原」就把用户攒的皮肤全清了。
        const keptPresets = draft.skinPresets || [];
        await updateTheme({
            scheduleCardAppearance: keptPresets.length
                ? { preset: 'original', customCss: '', skinPresets: keptPresets }
                : undefined,
        });
        addToast('已还原原版日程卡片', 'success');
        setOpen(false);
    };

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(AI_PROMPT);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            addToast('复制失败，请手动选择文本', 'error');
        }
    };

    const savePreset = async () => {
        const renderability = runCssRenderabilityCheck(draft.customCss || '', validation);
        if (!renderability.ok) {
            addToast(renderability.message, 'error');
            return;
        }
        const result = upsertScheduleSkinPreset(draft.skinPresets, presetName, draft);
        if ('error' in result) {
            addToast(result.error, 'error');
            return;
        }
        const next: ScheduleCardAppearance = {
            ...draft,
            skinPresets: result.presets,
            skinPresetId: result.preset.id,
        };
        setDraft(next);
        setPresetName('');
        await updateTheme({ scheduleCardAppearance: next });
        addToast(`已保存预设「${result.preset.name}」`, 'success');
    };

    const applyPreset = async (preset: ScheduleCardSkinPreset) => {
        const next = applyScheduleSkinPreset(draft, preset);
        setDraft(next);
        await updateTheme({ scheduleCardAppearance: next });
        addToast(`已切换到「${preset.name}」`, 'success');
    };

    const startRename = (preset: ScheduleCardSkinPreset) => {
        setRenamingId(preset.id);
        setRenameDraft(preset.name);
    };

    const commitRename = async () => {
        if (!renamingId) return;
        const result = renameScheduleSkinPreset(draft.skinPresets, renamingId, renameDraft);
        if ('error' in result) {
            addToast(result.error, 'error');
            return;
        }
        const next: ScheduleCardAppearance = { ...draft, skinPresets: result.presets };
        setDraft(next);
        setRenamingId(null);
        setRenameDraft('');
        await updateTheme({ scheduleCardAppearance: next });
        addToast('预设已重命名', 'success');
    };

    const deletePreset = async (preset: ScheduleCardSkinPreset) => {
        const next: ScheduleCardAppearance = {
            ...draft,
            skinPresets: removeScheduleSkinPreset(draft.skinPresets, preset.id),
            skinPresetId: draft.skinPresetId === preset.id ? undefined : draft.skinPresetId,
        };
        setDraft(next);
        if (renamingId === preset.id) setRenamingId(null);
        await updateTheme({ scheduleCardAppearance: next });
        addToast(`已删除预设「${preset.name}」`, 'success');
    };

    const panel = open ? createPortal(
        <div
            className="fixed inset-0 z-[1900] flex items-end justify-center bg-black/45 backdrop-blur-sm"
            onMouseDown={event => {
                if (event.target === event.currentTarget) setOpen(false);
            }}
            onClick={event => event.stopPropagation()}
        >
            <div
                className="w-full max-w-[620px] max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-[#fbfafc] text-slate-800 shadow-2xl"
                style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[#fbfafc]/95 backdrop-blur border-b border-slate-200/70">
                    <div>
                        <div className="text-[10px] font-bold tracking-[.2em] uppercase text-violet-400">Schedule skin</div>
                        <h2 className="text-base font-black mt-0.5">日程卡片美化</h2>
                    </div>
                    <button
                        className="w-9 h-9 rounded-full grid place-items-center bg-slate-100 text-slate-500"
                        onClick={() => setOpen(false)}
                        aria-label="关闭日程卡片设置"
                    >
                        <X size={17} />
                    </button>
                </div>

                <div className="p-5 space-y-7">
                    <section>
                        <div className="mb-3">
                            <h3 className="text-sm font-bold">配色</h3>
                            <p className="text-[11px] text-slate-400 mt-1">桌面、房间和聊天里的日程卡会一起变化。</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                            {SCHEDULE_CARD_PRESETS.map(preset => {
                                const selected = (draft.preset || 'original') === preset.id;
                                const palette = resolveScheduleCardPalette(
                                    { ...draft, preset: preset.id },
                                    theme.hue,
                                    theme.contentColor || '#ffffff',
                                );
                                return (
                                    <button
                                        key={preset.id}
                                        className={`relative overflow-hidden rounded-2xl p-3 text-left min-h-[82px] transition-transform active:scale-[.98] ${
                                            selected ? 'ring-2 ring-violet-400 ring-offset-2' : ''
                                        }`}
                                        style={{ background: palette.background, color: palette.text }}
                                        onClick={() => editDraft({ preset: preset.id })}
                                    >
                                        <span className="block text-sm font-black" style={{ color: palette.accent }}>{preset.name}</span>
                                        <span className="block text-[10px] mt-1 opacity-60">{preset.description}</span>
                                        <span className="absolute right-3 bottom-3 flex gap-1">
                                            <i className="w-3 h-3 rounded-full border border-black/10" style={{ background: palette.text }} />
                                            <i className="w-3 h-3 rounded-full border border-black/10" style={{ background: palette.accent }} />
                                        </span>
                                        {selected && <Check size={15} weight="bold" className="absolute right-3 top-3" />}
                                    </button>
                                );
                            })}
                            <button
                                className={`rounded-2xl min-h-[82px] p-3 text-left border-2 border-dashed ${
                                    draft.preset === 'custom'
                                        ? 'border-violet-400 bg-violet-50'
                                        : 'border-slate-200 bg-white'
                                }`}
                                onClick={() => editDraft({ preset: 'custom' })}
                            >
                                <span className="block text-sm font-black text-slate-700">自定义配色</span>
                                <span className="block text-[10px] text-slate-400 mt-1">背景 · 文字 · 强调色</span>
                            </button>
                        </div>
                    </section>

                    {draft.preset === 'custom' && (
                        <section className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div
                                className="h-20 rounded-xl mb-4 p-3 flex flex-col justify-between"
                                style={{ background: preview.background, color: preview.text }}
                            >
                                <span className="text-[9px] uppercase tracking-[.2em] opacity-55">Daily schedule</span>
                                <b style={{ color: preview.accent }}>08:30 · 今天的日程</b>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {([
                                    ['background', '背景', draft.background || '#21192b'],
                                    ['textColor', '文字', draft.textColor || '#f8f3ff'],
                                    ['accentColor', '强调', draft.accentColor || '#c9a7ff'],
                                ] as const).map(([key, label, value]) => (
                                    <label key={key} className="text-[11px] text-slate-500">
                                        <span className="block mb-1.5">{label}</span>
                                        <span className="flex items-center gap-2 rounded-xl border border-slate-200 p-2">
                                            <input
                                                type="color"
                                                value={value}
                                                onChange={event => editDraft({ [key]: event.target.value })}
                                                className="w-7 h-7 rounded border-0 bg-transparent p-0"
                                            />
                                            <span className="font-mono text-[9px]">{value}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </section>
                    )}

                    <section>
                        <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <h3 className="text-sm font-bold">自定义 CSS</h3>
                                <p className="text-[11px] text-slate-400 mt-1">类似白框美化，只作用于日程卡。</p>
                            </div>
                            <button
                                onClick={copyPrompt}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-50 text-violet-600 text-[11px] font-bold"
                            >
                                {copied ? <Check size={13} /> : <Copy size={13} />}
                                {copied ? '已复制' : '复制 AI 提示词'}
                            </button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
                            {CSS_TEMPLATES.map(template => (
                                <button
                                    key={template.name}
                                    className="shrink-0 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-600"
                                    onClick={() => editDraft({ customCss: template.code })}
                                >
                                    {template.name}
                                </button>
                            ))}
                            <button
                                className="shrink-0 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-400"
                                onClick={() => editDraft({ customCss: '' })}
                            >
                                清空 CSS
                            </button>
                        </div>
                        <textarea
                            value={draft.customCss || ''}
                            onChange={event => editDraft({ customCss: event.target.value })}
                            rows={11}
                            spellCheck={false}
                            className="w-full resize-y rounded-2xl border border-slate-200 bg-[#17141d] p-4 font-mono text-[11px] leading-5 text-violet-100 outline-none focus:border-violet-400"
                            placeholder=".sully-schedule-root {&#10;  border-radius: 20px !important;&#10;}"
                        />
                        {!validation.isValid && (
                            <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-600">
                                {validation.errors[0]}
                            </div>
                        )}
                        <details className="mt-3 text-[11px] text-slate-500">
                            <summary className="cursor-pointer font-bold">查看可用 CSS 钩子</summary>
                            <p className="mt-2 leading-5">
                                root、card、widget、header、cover、list、item、item-current、time、
                                activity、description、timeline、settings，均以 <code>.sully-schedule-</code> 开头。
                                内联颜色需要用 <code>!important</code> 覆盖。
                            </p>
                        </details>
                    </section>

                    <section>
                        <div className="mb-3">
                            <h3 className="text-sm font-bold">我的预设</h3>
                            <p className="text-[11px] text-slate-400 mt-1">配色和 CSS 一起存成一套；存好后点名字切换，右侧可重命名 / 删除。</p>
                        </div>
                        <div className="flex gap-2">
                            <input
                                value={presetName}
                                onChange={event => setPresetName(event.target.value)}
                                onKeyDown={event => { if (event.key === 'Enter') void savePreset(); }}
                                placeholder="例：轻松熊奶油"
                                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400"
                            />
                            <button
                                type="button"
                                onClick={() => void savePreset()}
                                className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40"
                                disabled={!validation.isValid}
                            >
                                保存为预设
                            </button>
                        </div>
                        {(draft.skinPresets?.length || 0) > 0 ? (
                            <div className="mt-3 space-y-2">
                                {(draft.skinPresets || []).map(preset => {
                                    const active = draft.skinPresetId === preset.id;
                                    const swatch = resolveScheduleCardPalette(
                                        {
                                            preset: preset.preset,
                                            background: preset.background,
                                            textColor: preset.textColor,
                                            accentColor: preset.accentColor,
                                        },
                                        theme.hue,
                                        theme.contentColor || '#ffffff',
                                    );
                                    return (
                                        <div
                                            key={preset.id}
                                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                                                active ? 'border-violet-300 bg-violet-50' : 'border-slate-100 bg-slate-50'
                                            }`}
                                        >
                                            <span
                                                className="h-6 w-6 shrink-0 rounded-lg border border-black/10"
                                                style={{ background: swatch.background }}
                                            />
                                            {renamingId === preset.id ? (
                                                <>
                                                    <input
                                                        autoFocus
                                                        value={renameDraft}
                                                        onChange={event => setRenameDraft(event.target.value)}
                                                        onKeyDown={event => {
                                                            if (event.key === 'Enter') void commitRename();
                                                            if (event.key === 'Escape') setRenamingId(null);
                                                        }}
                                                        className="min-w-0 flex-1 rounded-lg border border-violet-300 bg-white px-2 py-1 text-xs outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => void commitRename()}
                                                        className="shrink-0 rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-bold text-white"
                                                    >
                                                        完成
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setRenamingId(null)}
                                                        className="shrink-0 px-1 text-[10px] font-bold text-slate-400"
                                                    >
                                                        取消
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => void applyPreset(preset)}
                                                        className={`min-w-0 flex-1 truncate text-left text-xs font-bold ${
                                                            active ? 'text-violet-600' : 'text-slate-600'
                                                        }`}
                                                    >
                                                        {active ? '✓ ' : ''}{preset.name}
                                                        <span className="ml-1.5 font-normal text-[10px] text-slate-400">
                                                            {preset.css.trim() ? '配色 + CSS' : '仅配色'}
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => startRename(preset)}
                                                        aria-label={`重命名预设 ${preset.name}`}
                                                        className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-400"
                                                    >
                                                        重命名
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void deletePreset(preset)}
                                                        aria-label={`删除预设 ${preset.name}`}
                                                        className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold text-rose-400"
                                                    >
                                                        删除
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="mt-3 text-[11px] text-slate-400">
                                还没有预设。调好一套样子后在上面取个名字点「保存为预设」，
                                这里就会出现一行，点名字一键切换，右侧可以重命名或删除。
                            </p>
                        )}
                    </section>
                </div>

                <div className="sticky bottom-0 flex gap-2 px-5 pt-3 pb-1 bg-[#fbfafc]/95 backdrop-blur border-t border-slate-200/70">
                    <button
                        className="h-12 px-4 rounded-2xl bg-slate-100 text-slate-500 font-bold text-xs flex items-center gap-2"
                        onClick={reset}
                    >
                        <ArrowCounterClockwise size={15} />
                        还原
                    </button>
                    <button
                        className="h-12 flex-1 rounded-2xl bg-slate-900 text-white font-bold text-sm disabled:opacity-40"
                        disabled={!validation.isValid}
                        onClick={save}
                    >
                        保存并同步
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <>
            <button
                type="button"
                className={`sully-schedule-settings grid place-items-center rounded-full border transition-all active:scale-90 ${
                    compact ? 'w-7 h-7' : 'w-8 h-8'
                }`}
                style={{
                    color: 'var(--schedule-text)',
                    background: 'color-mix(in srgb, var(--schedule-text) 10%, transparent)',
                    borderColor: 'var(--schedule-line)',
                }}
                onPointerDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={event => {
                    stop(event);
                    setOpen(true);
                }}
                aria-label="日程卡片设置"
                title="日程卡片设置"
            >
                <GearSix size={compact ? 13 : 15} weight="bold" />
            </button>
            {panel}
        </>
    );
};

export default ScheduleAppearanceButton;
