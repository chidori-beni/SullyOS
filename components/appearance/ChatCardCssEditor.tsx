import React, { useRef, useState } from 'react';
import type { ChatCardCssPreset } from '../../types';
import {
    BUILTIN_CARD_CSS_PRESETS,
    CHAT_CARD_CATALOG,
    CHAT_CARD_CSS_AI_PROMPT,
    removeChatCardCssPreset,
    renameChatCardCssPreset,
    upsertChatCardCssPreset,
} from '../../utils/chatCardCss';

/**
 * 「装扮 → 所有聊天 → 卡片 · CSS」编辑器。
 *
 * 和白框 CSS 编辑器（components/chat/ChromeCssEditor.tsx）刻意保持同一套手感：
 * 一个大框管全部卡片，靠 data-card 在 CSS 里分辨是哪张，配「复制 AI 提示词」把写 CSS
 * 这件事外包出去。不做「每类卡片一个小框」——那样面板要滚三十多格，存一套预设也要
 * 存三十多份，分享给别人时必漏。
 *
 * 预设存在 osTheme.chatCardCssPresets 里（跟着备份导出走），
 * 保存 / 重命名 / 删除的判定在 utils/chatCardCss.ts，和日程卡皮肤预设同一套规矩。
 */

type Props = {
    value: string;
    onChange: (css: string) => void;
    presets: ChatCardCssPreset[];
    activePresetId?: string;
    onChangePresets: (presets: ChatCardCssPreset[], activePresetId?: string) => void;
    /** 失败提示走宿主的 toast（外观 App / 装扮抽屉各有一份）。 */
    onNotify?: (message: string, kind: 'success' | 'error') => void;
};

const copyText = async (text: string): Promise<boolean> => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 降级到 execCommand */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch { return false; }
};

const ChatCardCssEditor: React.FC<Props> = ({
    value, onChange, presets, activePresetId, onChangePresets, onNotify,
}) => {
    const [copied, setCopied] = useState(false);
    const [catalogOpen, setCatalogOpen] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const notify = (message: string, kind: 'success' | 'error') => {
        if (onNotify) onNotify(message, kind);
        else if (kind === 'error') window.alert(message);
    };

    const applyPreset = (preset: { name: string; css: string; id?: string }) => {
        onChange(preset.css);
        onChangePresets(presets, preset.id);
        notify(`已套用「${preset.name}」`, 'success');
    };

    const handleSave = () => {
        const name = window.prompt('给这套卡片样式起个名字：', `卡片样式 ${presets.length + 1}`);
        if (name === null) return;
        const result = upsertChatCardCssPreset(presets, name, value);
        if ('error' in result) { notify(result.error, 'error'); return; }
        onChangePresets(result.presets, result.preset.id);
        notify(`已保存「${result.preset.name}」`, 'success');
    };

    const commitRename = (id: string) => {
        const result = renameChatCardCssPreset(presets, id, renameDraft);
        if ('error' in result) { notify(result.error, 'error'); return; }
        onChangePresets(result.presets, activePresetId);
        setRenamingId(null);
        setRenameDraft('');
        notify('预设已重命名', 'success');
    };

    const handleDelete = (preset: ChatCardCssPreset) => {
        if (!window.confirm(`删除「${preset.name}」这套卡片样式？`)) return;
        onChangePresets(
            removeChatCardCssPreset(presets, preset.id),
            activePresetId === preset.id ? undefined : activePresetId,
        );
        notify('预设已删除', 'success');
    };

    const handleCopyPrompt = async () => {
        if (await copyText(CHAT_CARD_CSS_AI_PROMPT)) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } else {
            notify('复制失败，请手动选中提示词复制。', 'error');
        }
    };

    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            // 去掉某些编辑器保存 CSS 时带上的 BOM，否则第一条规则会被当成非法字符丢掉
            const css = (await file.text()).replace(/^﻿/, '');
            if (!css.trim()) { notify('文件内容是空的。', 'error'); return; }
            onChange(css);
            onChangePresets(presets, undefined);
        } catch {
            notify('导入失败，请确认文件可以正常读取。', 'error');
        } finally {
            event.target.value = '';
        }
    };

    const handleExport = () => {
        if (!value.trim()) { notify('当前没有可导出的 CSS。', 'error'); return; }
        const blob = new Blob([value], { type: 'text/css;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'sullyos-chat-cards.css';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-3">
            {/* 复制提示词 —— 不会写 CSS 的用户走这条路 */}
            <button
                onClick={handleCopyPrompt}
                className="flex w-full items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-3 py-2.5 text-left transition active:scale-[.99]"
            >
                <span className="text-lg leading-none">{copied ? '✅' : '📋'}</span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-bold text-indigo-600">
                        {copied ? '已复制，去粘给 AI 吧' : '复制 AI 提示词'}
                    </span>
                    <span className="block text-[10px] leading-snug text-indigo-400">
                        发给任何 AI，说出你想要的风格（提示词里已带全部卡片名录），把它给的 CSS 粘回下面
                    </span>
                </span>
            </button>

            {/* 内置样式 */}
            <div>
                <div className="mb-1.5 text-[11px] font-bold text-slate-500">
                    内置样式 <span className="font-normal text-slate-400">· 点一下套用</span>
                </div>
                <div className="space-y-1.5">
                    {BUILTIN_CARD_CSS_PRESETS.map(preset => (
                        <button
                            key={preset.name}
                            onClick={() => applyPreset(preset)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 active:scale-[.99]"
                        >
                            <div className="text-[12px] font-bold text-slate-700">{preset.name}</div>
                            <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{preset.desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* 我的预设：保存 / 切换 / 重命名 / 删除 */}
            <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-500">
                        我的预设 <span className="font-normal text-slate-400">· 所有聊天通用</span>
                    </span>
                    <button
                        onClick={handleSave}
                        disabled={!value.trim()}
                        className={`rounded-lg px-2 py-1 text-[10px] font-bold ${value.trim() ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-300'}`}
                    >
                        ＋ 存当前
                    </button>
                </div>
                {presets.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-[10px] leading-relaxed text-slate-400">
                        调好一套之后点「＋ 存当前」，这里就会出现一行；点名字一键切换，右侧可以重命名或删除。
                    </p>
                ) : (
                    <div className="space-y-1">
                        {presets.map(preset => (
                            <div
                                key={preset.id}
                                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 ${
                                    preset.id === activePresetId
                                        ? 'border-primary/40 bg-primary/5'
                                        : 'border-slate-200 bg-white'
                                }`}
                            >
                                {renamingId === preset.id ? (
                                    <>
                                        <input
                                            autoFocus
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(preset.id); }}
                                            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-primary/50"
                                            aria-label="预设新名字"
                                        />
                                        <button
                                            onClick={() => commitRename(preset.id)}
                                            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-50"
                                        >
                                            确定
                                        </button>
                                        <button
                                            onClick={() => { setRenamingId(null); setRenameDraft(''); }}
                                            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100"
                                        >
                                            取消
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => applyPreset(preset)}
                                            className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-slate-700"
                                        >
                                            {preset.name}
                                        </button>
                                        <button
                                            onClick={() => { setRenamingId(preset.id); setRenameDraft(preset.name); }}
                                            aria-label={`重命名预设 ${preset.name}`}
                                            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                        >
                                            重命名
                                        </button>
                                        <button
                                            onClick={() => handleDelete(preset)}
                                            aria-label={`删除预设 ${preset.name}`}
                                            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-50 hover:text-rose-500"
                                        >
                                            删除
                                        </button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* CSS 代码区 */}
            <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-500">
                        CSS 代码 <span className="font-normal text-slate-400">· 可手改 / 粘贴</span>
                    </span>
                    <div className="flex items-center gap-1">
                        <input ref={fileRef} type="file" accept=".css,.txt,text/css,text/plain" className="hidden" onChange={handleImport} />
                        <button onClick={() => fileRef.current?.click()} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50">导入</button>
                        <button onClick={handleExport} disabled={!value.trim()} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${value.trim() ? 'text-indigo-500 hover:bg-indigo-50' : 'text-slate-300'}`}>导出</button>
                        {value && (
                            <button
                                onClick={() => { onChange(''); onChangePresets(presets, undefined); }}
                                className="rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-50 hover:text-rose-500"
                            >
                                清空
                            </button>
                        )}
                    </div>
                </div>
                <textarea
                    value={value}
                    // 手改之后就不再属于任何预设：留着高亮会让人以为「还在用浅色卡片那套」，
                    // 下次点回同一套时又发现内容对不上。
                    onChange={(e) => { onChange(e.target.value); onChangePresets(presets, undefined); }}
                    placeholder={'/* 点上面任一套，或在这里直接写 / 粘贴 CSS */\n.sully-chat-card[data-card="vr_card"] div[class*="overflow-hidden"][class*="rounded-"]{\n  background: #f6f3ff !important;\n}'}
                    spellCheck={false}
                    rows={8}
                    className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-primary/50 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                />
                <div className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                    每张卡片外层都是 <code className="rounded bg-slate-100 px-1 text-slate-500">.sully-chat-card[data-card="种类"]</code>，
                    覆盖颜色一律要加 <code className="rounded bg-slate-100 px-1 text-slate-500">!important</code>。
                </div>
            </div>

            {/* 卡片名录：不用记，展开对着抄 data-card 的值 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70">
                <button
                    onClick={() => setCatalogOpen(open => !open)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    aria-expanded={catalogOpen}
                >
                    <span className="text-[11px] font-bold text-slate-500">
                        有哪些卡片 <span className="font-normal text-slate-400">· {CHAT_CARD_CATALOG.length} 种</span>
                    </span>
                    <span className="text-[10px] text-slate-400">{catalogOpen ? '收起' : '展开'}</span>
                </button>
                {catalogOpen && (
                    <ul className="space-y-0.5 px-3 pb-3">
                        {CHAT_CARD_CATALOG.map(entry => (
                            <li key={`${entry.card}/${entry.sub || ''}`} className="flex items-baseline gap-2 text-[10px] leading-relaxed">
                                <code className="shrink-0 rounded bg-white px-1 font-mono text-slate-500">
                                    {entry.card}{entry.sub ? ` / ${entry.sub}` : ''}
                                </code>
                                <span className="min-w-0 text-slate-500">
                                    {entry.label}
                                    <span className="text-slate-400">（{entry.from}）</span>
                                    {entry.tone === 'dark' && <span className="ml-1 font-bold text-indigo-400">深色底</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default ChatCardCssEditor;
