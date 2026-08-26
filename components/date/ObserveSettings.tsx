import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../../context/OSContext';
import { CharacterProfile, DateObservation, DateObserveConfig, DateObserveStyleId, DateCssPreset } from '../../types';
import { OBSERVE_DIMENSIONS } from '../../utils/datePrompts';
import ObserveHUD, { OBSERVE_STYLES } from './ObserveHUD';

/**
 * 见面设置里的「观测协议 OBSERVE」配置块（默认折叠）：
 *   - 总开关
 *   - HUD 样式选择（全息 / 水墨 / 霓虹 / 水晶 / 终端），带实时预览
 *   - 四个默认维度（时间/地点/状态/细节）：启用开关、HUD 显示标签、生成提示
 *   - 追加自定义维度（最多 6 个）：标签 + 生成提示 + 启用 + 删除
 *   - 一键重置（样式 + 全部字段自定义 + 自定义维度回默认）
 *
 * 所有改动即时写回 char.dateObserve，下一条回复 / 下次渲染生效。
 */

interface ObserveSettingsProps {
    char: CharacterProfile;
}

// 预览用的示例观测（不发请求，纯展示样式）
const SAMPLE: DateObservation = {
    time: '傍晚六点过，天刚擦黑',
    place: '便利店门口的塑料凳上',
    state: '有点疲惫，但见到你眼神亮了一下',
    detail: '指尖无意识地敲着关东煮的纸杯',
};

const MAX_CUSTOM = 6;
const genId = () => 'obs_' + Math.random().toString(36).slice(2, 9);

type FieldDraft = Record<string, { label: string; hint: string }>;

const buildFieldDraft = (char: CharacterProfile): FieldDraft => {
    const f = char.dateObserve?.fields || {};
    const d: FieldDraft = {};
    for (const dim of OBSERVE_DIMENSIONS) d[dim.key] = { label: f[dim.key]?.label || '', hint: f[dim.key]?.hint || '' };
    return d;
};
const buildCustomDraft = (char: CharacterProfile): FieldDraft => {
    const d: FieldDraft = {};
    for (const c of char.dateObserve?.custom || []) d[c.id] = { label: c.label || '', hint: c.hint || '' };
    return d;
};

const ObserveSettings: React.FC<ObserveSettingsProps> = ({ char }) => {
    const { updateCharacter, addToast } = useOS();
    const cssFileInputRef = useRef<HTMLInputElement>(null);
    const enabled = !!char.dateObserve?.enabled;
    const style = char.dateObserve?.style || 'hologram';
    const fields = char.dateObserve?.fields || {};
    const customs = char.dateObserve?.custom || [];
    const cssDraft = char.dateObserve?.customCss || '';
    const cssPresets = char.dateObserve?.cssPresets || [];

    const [open, setOpen] = useState(false); // 默认折叠
    const [draft, setDraft] = useState<FieldDraft>(() => buildFieldDraft(char));
    const [customDraft, setCustomDraft] = useState<FieldDraft>(() => buildCustomDraft(char));
    const [observeCssDraft, setObserveCssDraft] = useState(cssDraft);
    const [observePresetName, setObservePresetName] = useState('');
    useEffect(() => { setDraft(buildFieldDraft(char)); setCustomDraft(buildCustomDraft(char)); }, [char.id]);
    useEffect(() => { setObserveCssDraft(char.dateObserve?.customCss || ''); }, [char.id, char.dateObserve?.customCss]);

    const patchObserve = (patch: Partial<DateObserveConfig>) =>
        updateCharacter(char.id, { dateObserve: { ...char.dateObserve, ...patch } });

    const makeCssPresetId = () => `obs_css_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const saveObserveCss = () => {
        patchObserve({ customCss: observeCssDraft.trim() || undefined, cssPresetId: undefined });
        addToast(observeCssDraft.trim() ? '观测面板 CSS 已保存并应用' : '观测面板 CSS 已清空', 'success');
    };

    const importObserveCss = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const css = await file.text();
        const themeName = file.name.replace(/\.(css|txt)$/i, '');
        setObserveCssDraft(css);
        patchObserve({ customCss: css, cssThemeName: themeName, cssPresetId: undefined });
        addToast(`已导入观测面板 CSS：${file.name}`, 'success');
        e.target.value = '';
    };

    const exportObserveCss = () => {
        const blob = new Blob([observeCssDraft], { type: 'text/css;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${char.name}_OBSERVE面板.css`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const saveObservePreset = () => {
        const name = observePresetName.trim();
        const css = observeCssDraft.trim();
        if (!name) { addToast('请先填写预设名称', 'error'); return; }
        if (!css) { addToast('请先填写或导入 CSS', 'error'); return; }
        const existing = cssPresets.find(p => p.name === name);
        const preset: DateCssPreset = {
            id: existing?.id || makeCssPresetId(),
            name,
            css,
            updatedAt: Date.now(),
        };
        const next = existing ? cssPresets.map(p => p.id === existing.id ? preset : p) : [...cssPresets, preset];
        patchObserve({ cssPresets: next, customCss: css, cssThemeName: name, cssPresetId: preset.id });
        setObservePresetName('');
        addToast(existing ? `已更新观测预设「${name}」` : `已保存观测预设「${name}」`, 'success');
    };

    const applyObservePreset = (preset: DateCssPreset) => {
        setObserveCssDraft(preset.css);
        patchObserve({ customCss: preset.css, cssThemeName: preset.name, cssPresetId: preset.id });
        addToast(`已切换观测预设「${preset.name}」`, 'success');
    };

    const deleteObservePreset = (preset: DateCssPreset) => {
        patchObserve({
            cssPresets: cssPresets.filter(p => p.id !== preset.id),
            ...(char.dateObserve?.cssPresetId === preset.id ? { cssPresetId: undefined } : {}),
        });
        addToast(`已删除观测预设「${preset.name}」`, 'success');
    };

    // —— 默认维度 ——
    const patchField = (key: keyof DateObservation, partial: Record<string, unknown>) =>
        patchObserve({ fields: { ...fields, [key]: { ...(fields[key] || {}), ...partial } } });
    const commitField = (key: keyof DateObservation, which: 'label' | 'hint') => {
        const v = (draft[key]?.[which] || '').trim();
        if (v === (fields[key]?.[which] || '')) return;
        patchField(key, { [which]: v || undefined });
    };

    // —— 自定义维度 ——
    const addCustom = () => {
        if (customs.length >= MAX_CUSTOM) { addToast(`最多 ${MAX_CUSTOM} 个自定义维度`, 'info'); return; }
        const id = genId();
        patchObserve({ custom: [...customs, { id, label: '', hint: '', enabled: true }] });
        setCustomDraft(d => ({ ...d, [id]: { label: '', hint: '' } }));
    };
    const delCustom = (id: string) => patchObserve({ custom: customs.filter(c => c.id !== id) });
    const toggleCustom = (id: string, on: boolean) => patchObserve({ custom: customs.map(c => c.id === id ? { ...c, enabled: on } : c) });
    const commitCustom = (id: string, which: 'label' | 'hint') => {
        const cur = customs.find(c => c.id === id);
        if (!cur) return;
        const v = (customDraft[id]?.[which] || '').trim();
        if (v === (cur[which] || '')) return;
        patchObserve({ custom: customs.map(c => c.id === id ? { ...c, [which]: which === 'label' ? v : (v || undefined) } : c) });
    };

    const resetAll = () => {
        updateCharacter(char.id, {
            dateObserve: {
                enabled: char.dateObserve?.enabled,
                style: undefined,
                customCss: undefined,
                cssThemeName: undefined,
                cssPresetId: undefined,
                cssPresets,
                fields: undefined,
                custom: undefined,
            },
        });
        setObserveCssDraft('');
        setDraft(buildFieldDraft({ ...char, dateObserve: { enabled } }));
        setCustomDraft({});
        addToast('观测样式、CSS 与提示词已重置为默认（已保留预设）', 'success');
    };

    // 预览：默认四维用示例文案，自定义维度塞占位内容，让样式预览也能看到追加的格子
    const previewObs: DateObservation = {
        ...SAMPLE,
        extra: Object.fromEntries(
            customs.filter(c => c.enabled !== false && (c.label || '').trim()).map(c => [c.id, '此处显示生成的内容']),
        ),
    };

    return (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3.5">
                <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 min-w-0 text-left active:opacity-70">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 text-slate-300 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" /></svg>
                    <div className="min-w-0">
                        <h3 className="text-xs font-bold text-slate-400 uppercase">观测协议 · OBSERVE</h3>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed truncate">每条回复附上 {char.name} 此刻的状态，渲染成可独立查看的观测面板。{enabled ? '已开启。' : '已关闭。'}</p>
                    </div>
                </button>
                <button
                    onClick={() => patchObserve({ enabled: !enabled })}
                    className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${enabled ? 'bg-primary' : 'bg-slate-200'}`}
                >
                    <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
                </button>
            </div>

            {open && (
                !enabled ? (
                    <p className="px-4 pb-4 -mt-1 text-[11px] text-slate-400">先打开右上角开关，即可选择面板样式、自定义每格生成什么、追加观察维度。</p>
                ) : (
                <div className="px-4 pb-4 space-y-4">
                    {/* ── 样式选择 ── */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-[11px] font-bold text-slate-500">面板样式</h4>
                            <button onClick={resetAll} className="text-[10px] font-bold text-primary/80 hover:text-primary px-2 py-0.5 rounded-full bg-primary/5 active:scale-95 transition-transform">一键重置</button>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5">
                            {OBSERVE_STYLES.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => patchObserve({ style: s.id as DateObserveStyleId })}
                                    title={s.desc}
                                    className={`flex flex-col items-center gap-1 py-2 rounded-xl border transition-all active:scale-95 ${style === s.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-slate-200 hover:border-slate-300'}`}
                                >
                                    <span className="w-7 h-7 rounded-lg shadow-inner" style={{ background: s.swatch }} />
                                    <span className={`text-[10px] font-bold ${style === s.id ? 'text-primary' : 'text-slate-500'}`}>{s.name}</span>
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{OBSERVE_STYLES.find(s => s.id === style)?.desc}</p>
                    </div>

                    {/* ── 实时预览 ── */}
                    <div>
                        <h4 className="text-[11px] font-bold text-slate-500 mb-2">预览</h4>
                        <div className="rounded-xl p-4 flex justify-center" style={{ background: style === 'ink' ? '#e9e0cd' : 'radial-gradient(circle at 30% 20%, #1e2433, #0a0d16)' }}>
                            <div className="w-full max-w-[260px]">
                                <ObserveHUD observation={previewObs} variant="card" charName={char.name} config={char.dateObserve} />
                            </div>
                        </div>
                    </div>

                    {/* ── 面板 CSS 编辑 / 预设 ── */}
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <h4 className="text-[11px] font-bold text-slate-500">面板 CSS 美化</h4>
                            {char.dateObserve?.cssThemeName && <span className="max-w-[12rem] truncate text-[10px] text-primary">当前：{char.dateObserve.cssThemeName}</span>}
                        </div>
                        <p className="text-[10px] text-slate-400 mb-2.5 leading-snug">可手动粘贴或导入 CSS。请用 <code className="rounded bg-slate-100 px-1">.sully-observe-panel</code>、<code className="rounded bg-slate-100 px-1">.sully-observe-header</code>、<code className="rounded bg-slate-100 px-1">.sully-observe-row</code>、<code className="rounded bg-slate-100 px-1">.sully-observe-value</code> 等选择器；主题的内联底色/边框需要在 CSS 中加 <code className="rounded bg-slate-100 px-1">!important</code> 才能覆盖。</p>
                        <textarea
                            value={observeCssDraft}
                            onChange={e => setObserveCssDraft(e.target.value)}
                            spellCheck={false}
                            placeholder={'.sully-observe-panel {\n  border-radius: 24px !important;\n  background: #10131c !important;\n}\n.sully-observe-value { font-size: 14px; }'}
                            className="h-44 w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-200 outline-none focus:border-primary"
                        />
                        <input ref={cssFileInputRef} type="file" accept=".css,.txt,text/css,text/plain" className="hidden" onChange={importObserveCss} />
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => cssFileInputRef.current?.click()} className="rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-600">导入 CSS</button>
                            <button type="button" onClick={exportObserveCss} disabled={!observeCssDraft.trim()} className="rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-600 disabled:opacity-40">导出 CSS</button>
                            <button type="button" onClick={saveObserveCss} className="rounded-xl bg-primary py-2.5 text-xs font-bold text-white">保存应用</button>
                        </div>
                        <div className="mt-4 border-t border-slate-100 pt-3">
                            <div className="flex gap-2">
                                <input
                                    value={observePresetName}
                                    onChange={e => setObservePresetName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveObservePreset(); }}
                                    placeholder="预设名称（如 霓虹观测）"
                                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-primary"
                                />
                                <button type="button" onClick={saveObservePreset} className="shrink-0 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-white">保存为预设</button>
                            </div>
                            {cssPresets.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">已保存预设 · 点击即可切换</div>
                                    {cssPresets.map(preset => (
                                        <div key={preset.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                            <button type="button" onClick={() => applyObservePreset(preset)} className={`min-w-0 flex-1 truncate text-left text-xs font-bold ${char.dateObserve?.cssPresetId === preset.id ? 'text-primary' : 'text-slate-600'}`}>
                                                {char.dateObserve?.cssPresetId === preset.id ? '✓ ' : ''}{preset.name}
                                            </button>
                                            <button type="button" onClick={() => deleteObservePreset(preset)} aria-label={`删除观测预设 ${preset.name}`} className="shrink-0 px-1 text-sm text-slate-300 hover:text-rose-400">×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button type="button" onClick={() => { setObserveCssDraft(''); patchObserve({ customCss: undefined, cssThemeName: undefined, cssPresetId: undefined }); addToast('已清空观测面板 CSS', 'success'); }} className="mt-2 w-full py-2 text-[11px] font-bold text-rose-400">清空当前 CSS（保留预设）</button>
                    </div>

                    {/* ── 每个维度的提示词与标签自定义 ── */}
                    <div>
                        <h4 className="text-[11px] font-bold text-slate-500 mb-1">每个部分生成什么（自定义提示词）</h4>
                        <p className="text-[10px] text-slate-400 mb-2.5 leading-snug">「显示标签」只改面板上的字样；「生成提示」决定这一格让 AI 写什么。留空即用默认。关掉的维度不会生成、面板上也不显示。</p>
                        <div className="space-y-2.5">
                            {OBSERVE_DIMENSIONS.map(dim => {
                                const on = fields[dim.key]?.enabled !== false;
                                const defHint = dim.hint.replace(/\{name\}/g, char.name);
                                return (
                                    <div key={dim.key} className={`rounded-xl border p-2.5 transition-opacity ${on ? 'border-slate-200 bg-slate-50/60' : 'border-slate-100 bg-slate-50/30 opacity-60'}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><span className="text-slate-400">{dim.glyph}</span>{dim.label}</span>
                                            <button
                                                onClick={() => patchField(dim.key, { enabled: !on })}
                                                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${on ? 'bg-primary' : 'bg-slate-300'}`}
                                            >
                                                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
                                            </button>
                                        </div>
                                        {on && (
                                            <div className="space-y-1.5">
                                                <input
                                                    value={draft[dim.key]?.label || ''}
                                                    onChange={e => setDraft(d => ({ ...d, [dim.key]: { ...d[dim.key], label: e.target.value } }))}
                                                    onBlur={() => commitField(dim.key, 'label')}
                                                    placeholder={`显示标签（默认「${dim.label}」）`}
                                                    className="w-full text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-primary focus:outline-none bg-white"
                                                />
                                                <textarea
                                                    value={draft[dim.key]?.hint || ''}
                                                    onChange={e => setDraft(d => ({ ...d, [dim.key]: { ...d[dim.key], hint: e.target.value } }))}
                                                    onBlur={() => commitField(dim.key, 'hint')}
                                                    placeholder={`生成提示（默认：${defHint}）`}
                                                    rows={2}
                                                    className="w-full text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-primary focus:outline-none bg-white leading-relaxed resize-none"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── 追加自定义维度 ── */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <h4 className="text-[11px] font-bold text-slate-500">追加维度</h4>
                            <button
                                onClick={addCustom}
                                disabled={customs.length >= MAX_CUSTOM}
                                className="text-[10px] font-bold text-primary px-2.5 py-1 rounded-full bg-primary/5 hover:bg-primary/10 disabled:opacity-40 active:scale-95 transition-all"
                            >+ 添加（{customs.length}/{MAX_CUSTOM}）</button>
                        </div>
                        <p className="text-[10px] text-slate-400 mb-2.5 leading-snug">在四个默认维度之外，自己开观察项（如「穿着」「天气」「和你的距离」）。标签同时用于 AI 输出与面板显示。</p>
                        {customs.length === 0 ? (
                            <div className="text-[11px] text-slate-300 text-center py-3 border border-dashed border-slate-200 rounded-xl">还没有自定义维度，点「+ 添加」开一格</div>
                        ) : (
                            <div className="space-y-2.5">
                                {customs.map(c => {
                                    const on = c.enabled !== false;
                                    return (
                                        <div key={c.id} className={`rounded-xl border p-2.5 transition-opacity ${on ? 'border-slate-200 bg-slate-50/60' : 'border-slate-100 bg-slate-50/30 opacity-60'}`}>
                                            <div className="flex items-center gap-2 mb-2">
                                                <input
                                                    value={customDraft[c.id]?.label || ''}
                                                    onChange={e => setCustomDraft(d => ({ ...d, [c.id]: { ...d[c.id], label: e.target.value } }))}
                                                    onBlur={() => commitCustom(c.id, 'label')}
                                                    placeholder="维度名（如 穿着 / 天气）"
                                                    className="flex-1 min-w-0 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-primary focus:outline-none bg-white"
                                                />
                                                <button
                                                    onClick={() => toggleCustom(c.id, !on)}
                                                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${on ? 'bg-primary' : 'bg-slate-300'}`}
                                                >
                                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
                                                </button>
                                                <button onClick={() => delCustom(c.id)} title="删除" className="text-slate-300 hover:text-red-400 transition-colors shrink-0 p-0.5">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                                </button>
                                            </div>
                                            {on && (
                                                <textarea
                                                    value={customDraft[c.id]?.hint || ''}
                                                    onChange={e => setCustomDraft(d => ({ ...d, [c.id]: { ...d[c.id], hint: e.target.value } }))}
                                                    onBlur={() => commitCustom(c.id, 'hint')}
                                                    placeholder="生成提示：这一格让 AI 写什么（留空给个通用默认）"
                                                    rows={2}
                                                    className="w-full text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-primary focus:outline-none bg-white leading-relaxed resize-none"
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
                )
            )}
        </section>
    );
};

export default ObserveSettings;
