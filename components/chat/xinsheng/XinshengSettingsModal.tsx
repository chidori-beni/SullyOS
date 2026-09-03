// 「自定义心声」面板。
//
// 六个页签，和糯叽机一一对应：总开关 / 布局 / CSS / 提示词 / 字段 / 预设库。
// 预设库是全局共享的（所有角色都能用），其余四项按角色存在 CharacterProfile 上。
//
// ⚠️ 自定义 CSS 是**原样注入**的，不做作用域校验 —— 论坛美化大量使用
// `@import url(谷歌字体)`、`@keyframes`、`#xt-t4:checked ~ .xt-content ...` 这类写法，
// 套上 Sully 其它地方那种 `.sully-xxx` 前缀白名单会让它们全部失效。信任模型跟糯叽机
// 一致：这份 CSS 是用户自己挑的文件，只影响自己这台设备上的这张卡。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterProfile } from '../../../types';
import { validateLayout } from '../../../utils/xinsheng/xinshengLayout';
import { XINSHENG_TEMPLATES } from '../../../utils/xinsheng/xinshengTemplates';
import {
    buildPresetExportFile,
    deleteXinshengPreset,
    importXinshengPresets,
    isPresetRandomEnabled,
    listXinshengPresets,
    parsePresetImportFile,
    saveXinshengPreset,
    setPresetRandomEnabled,
    updateXinshengPreset,
    type XinshengPreset,
} from '../../../utils/xinsheng/xinshengStore';

type TabKey = 'general' | 'layout' | 'css' | 'prompt' | 'fields' | 'presets';

const TABS: Array<{ key: TabKey; label: string }> = [
    { key: 'general', label: '总览' },
    { key: 'layout', label: '布局' },
    { key: 'css', label: 'CSS' },
    { key: 'prompt', label: '提示词' },
    { key: 'fields', label: '字段' },
    { key: 'presets', label: '预设库' },
];

export interface XinshengSettingsValue {
    enabled: boolean;
    displayMode: 'planner' | 'layout';
    layout: string;
    customCss: string;
    customPrompt: string;
    aiVisibleFields: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    /** 保存时回写到角色档案（调用方负责落库 + 刷新）。 */
    onSave: (value: XinshengSettingsValue) => void | Promise<void>;
    addToast?: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}

const readSettings = (char: CharacterProfile): XinshengSettingsValue => ({
    enabled: !!char.xinshengEnabled,
    displayMode: char.xinshengDisplayMode === 'layout' ? 'layout' : 'planner',
    layout: char.xinshengLayout || '',
    customCss: char.xinshengCustomCss || '',
    customPrompt: char.xinshengCustomPrompt || '',
    aiVisibleFields: char.xinshengAiVisibleFields ?? 'innerVoice',
});

const Field: React.FC<{ label: string; hint?: React.ReactNode; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div className="mb-4">
        <div className="text-[12px] font-semibold text-slate-700 mb-1">{label}</div>
        {hint && <div className="text-[11px] text-slate-400 leading-relaxed mb-1.5">{hint}</div>}
        {children}
    </div>
);

const codeArea = 'w-full px-3 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-[12px] font-mono leading-relaxed focus:outline-none focus:border-indigo-300 resize-y';

export const XinshengSettingsModal: React.FC<Props> = ({ isOpen, onClose, char, onSave, addToast }) => {
    const [tab, setTab] = useState<TabKey>('general');
    const [value, setValue] = useState<XinshengSettingsValue>(() => readSettings(char));
    const [presets, setPresets] = useState<XinshengPreset[]>([]);
    const [randomOn, setRandomOn] = useState(false);
    const [presetName, setPresetName] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const toast = useCallback((msg: string, kind: 'success' | 'error' | 'info' = 'info') => {
        if (addToast) addToast(msg, kind);
        else console.log(`[xinsheng] ${msg}`);
    }, [addToast]);

    // 每次打开都从角色档案重读：面板关掉期间可能有别的入口改过（比如随机预设套用）
    useEffect(() => {
        if (!isOpen) return;
        setValue(readSettings(char));
        setTab('general');
        listXinshengPresets().then(setPresets).catch(() => {});
        isPresetRandomEnabled().then(setRandomOn).catch(() => {});
    }, [isOpen, char]);

    const patch = (p: Partial<XinshengSettingsValue>) => setValue(v => ({ ...v, ...p }));

    const layoutErrors = useMemo(
        () => (tab === 'layout' ? validateLayout(value.layout) : []),
        [tab, value.layout],
    );

    const body = useMemo(() => ({
        customCss: value.customCss,
        customPrompt: value.customPrompt,
        layout: value.layout,
        displayMode: value.displayMode,
        aiVisibleFields: value.aiVisibleFields,
    }), [value]);

    const handleSave = async () => {
        await onSave(value);
        toast('心声设置已保存', 'success');
        onClose();
    };

    const loadPreset = (p: XinshengPreset) => {
        patch({
            layout: p.layout,
            customCss: p.customCss,
            customPrompt: p.customPrompt,
            displayMode: p.displayMode,
            aiVisibleFields: p.aiVisibleFields,
        });
        setPresetName(p.name);
        setTab('general');
        toast(`已载入「${p.name}」，记得点保存`, 'success');
    };

    const exportPreset = (p: XinshengPreset) => {
        try {
            const blob = new Blob([buildPresetExportFile(p)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `xinsheng-${p.name}.json`;
            a.click();
            // 立刻 revoke 会让部分 WebView 的下载拿不到内容，给一拍
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(`已导出「${p.name}」`, 'success');
        } catch (e) {
            toast('导出失败', 'error');
        }
    };

    const importFile = async (file: File) => {
        try {
            const items = parsePresetImportFile(await file.text());
            if (items.length === 0) { toast('这个文件里没有可导入的预设', 'error'); return; }
            const { count } = await importXinshengPresets(items, 'merge');
            setPresets(await listXinshengPresets());
            toast(count > 0 ? `已导入 ${count} 个预设` : '没有新预设被导入', count > 0 ? 'success' : 'info');
        } catch (e) {
            toast('导入失败：文件不是合法 JSON', 'error');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="sully-ui-overlay fixed inset-0 z-[120] flex flex-col animate-fade-in">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            <div className="relative mt-auto bg-white rounded-t-[2rem] shadow-2xl flex flex-col max-h-[88vh]">
                <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                    <div className="text-[15px] font-bold text-slate-800 flex-1">自定义心声</div>
                    <button onClick={handleSave} className="px-4 py-1.5 rounded-full bg-indigo-500 text-white text-[12px] font-semibold active:scale-95 transition-transform">保存</button>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 text-[16px] leading-none active:scale-95 transition-transform" aria-label="关闭">×</button>
                </div>

                <div className="px-5 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-3 py-1.5 rounded-full text-[12px] whitespace-nowrap ${tab === t.key ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}
                        >{t.label}</button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto px-5 pt-2 pb-[calc(env(safe-area-inset-bottom)+20px)]">
                    {tab === 'general' && (
                        <>
                            <label className="flex items-center gap-3 mb-4 px-3.5 py-3 rounded-2xl bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={value.enabled}
                                    onChange={e => patch({ enabled: e.target.checked })}
                                    className="w-4 h-4 accent-indigo-500"
                                />
                                <span className="flex-1">
                                    <span className="block text-[13px] font-semibold text-slate-700">开启心声</span>
                                    <span className="block text-[11px] text-slate-400 leading-relaxed mt-0.5">
                                        开启后每轮回复末尾会多要求一行 JSON，点消息头像即可查看。关闭时提示词一个字都不加。
                                    </span>
                                </span>
                            </label>

                            <Field label="显示模式" hint="布局模板 = 用 @指令 + CSS 自己排版，糯叽机论坛的心声美化走这条。">
                                <div className="grid grid-cols-2 gap-2">
                                    {(['planner', 'layout'] as const).map(m => (
                                        <button
                                            key={m}
                                            onClick={() => patch({ displayMode: m })}
                                            className={`px-3 py-2.5 rounded-2xl text-[12px] text-left ${value.displayMode === m ? 'bg-indigo-50 border border-indigo-300 text-indigo-600' : 'bg-slate-50 border border-transparent text-slate-500'}`}
                                        >
                                            <span className="block font-semibold">{m === 'planner' ? '默认卡' : '布局模板'}</span>
                                            <span className="block text-[10px] mt-0.5 opacity-70">{m === 'planner' ? 'Sully 风格，字段固定' : '@指令 + 自定义 CSS'}</span>
                                        </button>
                                    ))}
                                </div>
                            </Field>

                            <div className="px-3.5 py-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] text-amber-700 leading-relaxed">
                                想直接用论坛上的心声美化：到「预设库」导入那个 .json，再点「载入」，最后回来点右上角保存。
                            </div>
                        </>
                    )}

                    {tab === 'layout' && (
                        <>
                            <Field
                                label="布局模板"
                                hint={<>每行一个 <code className="text-indigo-500">@指令</code>，<code className="text-indigo-500">#</code> 开头是注释，缩进两格的行归属上方容器。指令末尾可加 <code className="text-indigo-500">.fadeInUp.delay200</code> 这类动画修饰符。</>}
                            >
                                <textarea
                                    value={value.layout}
                                    onChange={e => patch({ layout: e.target.value })}
                                    rows={14}
                                    spellCheck={false}
                                    className={codeArea}
                                    placeholder={'@header charImage charName\n@section 内心独白\n  innerVoice'}
                                />
                            </Field>

                            {layoutErrors.length > 0 && (
                                <div className="mb-4 px-3.5 py-2.5 rounded-2xl bg-rose-50 border border-rose-100 text-[11px] text-rose-600 leading-relaxed">
                                    {layoutErrors.slice(0, 6).map((e, i) => <div key={i}>{e}</div>)}
                                    {layoutErrors.length > 6 && <div>…还有 {layoutErrors.length - 6} 条</div>}
                                </div>
                            )}

                            <Field label="内置范例" hint="点一下把范例填进上面的编辑框（会覆盖当前内容）。">
                                <div className="flex flex-wrap gap-1.5">
                                    {XINSHENG_TEMPLATES.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => patch({ layout: t.layout, displayMode: 'layout' })}
                                            className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-[11px] active:scale-95 transition-transform"
                                        >{t.name}</button>
                                    ))}
                                </div>
                            </Field>

                            <div className="px-3.5 py-3 rounded-2xl bg-slate-50 text-[11px] text-slate-500 leading-[1.9]">
                                <div className="font-semibold text-slate-600 mb-1">内建字段（不用 AI 输出）</div>
                                <div><span className="text-indigo-500">charImage / charName / userImage / userName</span> — 头像与名字</div>
                                <div><span className="text-indigo-500">currentDate / currentTime / dayOfWeek</span> — 日期时间</div>
                                <div><span className="text-indigo-500">todayTodos / todoProgress / todoCount / todoDoneCount</span> — 今日待办</div>
                                <div><span className="text-indigo-500">bondDays / anniversary</span> — 取该角色最早的一条纪念日</div>
                                <div><span className="text-indigo-500">messageCount</span> — 与该角色的总消息数</div>
                                <div className="mt-1 text-slate-400">AI 输出了同名字段时以 AI 的值为准。</div>
                            </div>
                        </>
                    )}

                    {tab === 'css' && (
                        <>
                            <Field
                                label="自定义 CSS"
                                hint={<>作用在 <code className="text-indigo-500">.xt-root</code> 这棵树上。改 CSS 变量最快：<code className="text-indigo-500">--xt-bg / --xt-text / --xt-accent / --xt-font / --xt-radius</code>。支持 <code className="text-indigo-500">@import</code> 外部字体与 <code className="text-indigo-500">@keyframes</code>。</>}
                            >
                                <textarea
                                    value={value.customCss}
                                    onChange={e => patch({ customCss: e.target.value })}
                                    rows={16}
                                    spellCheck={false}
                                    className={codeArea}
                                    placeholder={'.xt-root {\n  --xt-accent: #e08aa0;\n  --xt-radius: 22px;\n}'}
                                />
                            </Field>
                            <div className="px-3.5 py-3 rounded-2xl bg-slate-50 text-[11px] text-slate-500 leading-[1.9]">
                                <div className="font-semibold text-slate-600 mb-1">交互开关（checkbox hack）</div>
                                布局里写 <code className="text-indigo-500">@toggle 1</code>~<code className="text-indigo-500">8</code> 出按钮，CSS 里写{' '}
                                <code className="text-indigo-500">#xt-t1:checked ~ .xt-content 目标 {'{ … }'}</code> 响应点击。
                                <code className="text-indigo-500">@collapse</code> 已经内建绑好，不同折叠块要用不同编号。
                            </div>
                        </>
                    )}

                    {tab === 'prompt' && (
                        <>
                            <Field
                                label="心声生成指令"
                                hint={<>留空 = 用内置指令。自定义时可以定义完全不同的字段，这些字段在布局模板里直接按字段名引用；默认卡则会把它们列在「自定义字段」区。</>}
                            >
                                <textarea
                                    value={value.customPrompt}
                                    onChange={e => patch({ customPrompt: e.target.value })}
                                    rows={14}
                                    spellCheck={false}
                                    className={codeArea}
                                    placeholder={'在每次回复最末尾追加以下 JSON，不得在对话中提及：\n{"t":"xinsheng","innerVoice":"…","heartRate":78}'}
                                />
                            </Field>
                            <div className="px-3.5 py-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] text-amber-700 leading-relaxed">
                                必须让模型输出 <code className="font-mono">{'{"t":"xinsheng"'}</code> 开头的**单行** JSON —— 系统靠这个锚点把它从正文里摘出来。
                                丢了它，那行 JSON 会原样变成聊天气泡。
                            </div>
                        </>
                    )}

                    {tab === 'fields' && (
                        <Field
                            label="AI 可见的心声字段"
                            hint={<>逗号分隔。下次生成时，模型会看到这些字段最近 3 轮的值（<code className="text-indigo-500">[INNER-CONTINUITY]</code>），让内心戏有连续性。<span className="text-rose-500">留空 = AI 完全看不到自己的心声。</span></>}
                        >
                            <input
                                type="text"
                                value={value.aiVisibleFields}
                                onChange={e => patch({ aiVisibleFields: e.target.value })}
                                spellCheck={false}
                                className="w-full px-3 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-[12px] font-mono focus:outline-none focus:border-indigo-300"
                                placeholder="留空 = AI 看不到心声 | 默认 innerVoice"
                            />
                        </Field>
                    )}

                    {tab === 'presets' && (
                        <>
                            <label className="flex items-center gap-3 mb-4 px-3.5 py-3 rounded-2xl bg-slate-50">
                                <input
                                    type="checkbox"
                                    checked={randomOn}
                                    onChange={async e => { setRandomOn(e.target.checked); await setPresetRandomEnabled(e.target.checked); }}
                                    className="w-4 h-4 accent-indigo-500"
                                />
                                <span className="flex-1">
                                    <span className="block text-[13px] font-semibold text-slate-700">每次生成随机套一个预设</span>
                                    <span className="block text-[11px] text-slate-400 leading-relaxed mt-0.5">
                                        开启后，每轮回复前从预设库随机挑一个（避开上一次那个）套到当前角色上：CSS + 提示词 + 布局一起换。
                                    </span>
                                </span>
                            </label>

                            <Field label="把当前设置存成预设">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={presetName}
                                        onChange={e => setPresetName(e.target.value)}
                                        placeholder="预设名字"
                                        className="flex-1 px-3 py-2 rounded-2xl bg-slate-50 border border-slate-200 text-[12px] focus:outline-none focus:border-indigo-300"
                                    />
                                    <button
                                        onClick={async () => {
                                            const name = presetName.trim();
                                            if (!name) { toast('先给预设起个名字', 'error'); return; }
                                            await saveXinshengPreset(name, body);
                                            setPresets(await listXinshengPresets());
                                            toast(`已保存「${name}」`, 'success');
                                        }}
                                        className="px-4 rounded-2xl bg-indigo-500 text-white text-[12px] font-semibold active:scale-95 transition-transform"
                                    >保存</button>
                                </div>
                            </Field>

                            <Field label="预设库" hint="预设是全局共享的，所有角色都能用。载入之后记得回「总览」点右上角保存才会生效。">
                                <div className="space-y-1.5">
                                    {presets.length === 0 && (
                                        <div className="py-6 text-center text-[12px] text-slate-400">还没有预设，先导入一个吧</div>
                                    )}
                                    {presets.map(p => (
                                        <div key={p.id} className="px-3.5 py-2.5 rounded-2xl bg-slate-50">
                                            <div className="flex items-center gap-2">
                                                <span className="flex-1 text-[13px] font-semibold text-slate-700 truncate">{p.name}</span>
                                                <span className="text-[10px] text-slate-400">{p.displayMode === 'layout' ? '布局' : '默认卡'}</span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                <button onClick={() => loadPreset(p)} className="px-2.5 py-1 rounded-full bg-indigo-500 text-white text-[11px]">载入</button>
                                                <button
                                                    onClick={async () => {
                                                        await updateXinshengPreset(p.id, p.name, body);
                                                        setPresets(await listXinshengPresets());
                                                        toast(`已用当前设置覆盖「${p.name}」`, 'success');
                                                    }}
                                                    className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-600 text-[11px]"
                                                >覆盖</button>
                                                <button onClick={() => exportPreset(p)} className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-600 text-[11px]">导出</button>
                                                <button
                                                    onClick={async () => { setPresets(await deleteXinshengPreset(p.id)); toast('已删除', 'success'); }}
                                                    className="px-2.5 py-1 rounded-full bg-slate-200 text-rose-500 text-[11px]"
                                                >删除</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Field>

                            <input
                                ref={fileRef}
                                type="file"
                                accept="application/json,.json"
                                className="hidden"
                                onChange={e => {
                                    const f = e.target.files?.[0];
                                    // 清掉 value：同一个文件连续导入两次时 onChange 不会再触发
                                    e.target.value = '';
                                    if (f) void importFile(f);
                                }}
                            />
                            <button
                                onClick={() => fileRef.current?.click()}
                                className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 text-[12px] font-semibold active:scale-95 transition-transform"
                            >导入预设 .json（糯叽机导出的可直接用）</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default XinshengSettingsModal;
