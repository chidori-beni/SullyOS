import React, { useRef, useState } from 'react';
import type { CssPreset } from '../../utils/cssPresets';
import { removeCssPreset, renameCssPreset, upsertCssPreset } from '../../utils/cssPresets';
import type { GlobalCssBuiltinPreset, UiHookEntry } from '../../utils/globalCss';

/**
 * 一个「CSS 槽」的编辑器：一段 CSS + 一堆预设 + 一份 AI 提示词 + 一张类名速查。
 * 目前两处在用：聊天弹窗（装扮里）和顶部通知条（外观里）——名录/提示词/内置样式由外面传。
 *
 * 和卡片 CSS 编辑器同一套手感：一个大框 + 预设（存 / 切 / 重命名 / 删）+ 复制 AI 提示词。
 *
 * ⚠️ 只能有**一次** onPatch：OSContext 的 updateTheme 是 `{ ...theme, ...updates }`
 * 从闭包里那份 theme 合的，同一个事件里连调两次，第二次会拿旧 theme 抹掉第一次。
 */

export interface CssSlotPatch {
  css: string;
  presets: CssPreset[];
  presetId?: string;
}

type Props = {
  /** 这个槽叫什么（提示文案、预设默认名都用它） */
  slotLabel: string;
  hooks: ReadonlyArray<UiHookEntry>;
  aiPrompt: string;
  builtins: ReadonlyArray<GlobalCssBuiltinPreset>;
  /** 导出文件名 */
  exportName: string;
  /** 生效范围的一句话警示 */
  scopeHint: string;
  value: string;
  presets: CssPreset[];
  activePresetId?: string;
  onPatch: (patch: CssSlotPatch) => void;
  onNotify?: (message: string, kind: 'success' | 'error') => void;
};

const copyText = async (text: string): Promise<boolean> => {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 降级 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  } catch { return false; }
};

const CssSlotEditor: React.FC<Props> = ({ slotLabel, hooks, aiPrompt, builtins, exportName, scopeHint, value, presets, activePresetId, onPatch, onNotify }) => {
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
    onPatch({ css: preset.css, presets, presetId: preset.id });
    notify(`已套用「${preset.name}」`, 'success');
  };

  const handleSave = () => {
    const name = window.prompt(`给这套${slotLabel}样式起个名字：`, `${slotLabel}样式 ${presets.length + 1}`);
    if (name === null) return;
    const result = upsertCssPreset(presets, name, value, 'ui_css');
    if ('error' in result) { notify(result.error, 'error'); return; }
    onPatch({ css: value, presets: result.presets, presetId: result.preset.id });
    notify(`已保存「${result.preset.name}」`, 'success');
  };

  const commitRename = (id: string) => {
    const result = renameCssPreset(presets, id, renameDraft);
    if ('error' in result) { notify(result.error, 'error'); return; }
    onPatch({ css: value, presets: result.presets, presetId: activePresetId });
    setRenamingId(null); setRenameDraft('');
    notify('预设已重命名', 'success');
  };

  const handleDelete = (preset: CssPreset) => {
    if (!window.confirm(`删除「${preset.name}」这套${slotLabel}样式？`)) return;
    onPatch({
      css: value,
      presets: removeCssPreset(presets, preset.id),
      presetId: activePresetId === preset.id ? undefined : activePresetId,
    });
    notify('预设已删除', 'success');
  };

  const handleCopyPrompt = async () => {
    if (await copyText(aiPrompt)) {
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
      onPatch({ css, presets, presetId: undefined });
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
    anchor.href = url; anchor.download = exportName;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
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
            已带全部类名和「禁止毛玻璃 / 禁止无限动画」的规矩，直接说风格就行
          </span>
        </span>
      </button>

      <div>
        <div className="mb-1.5 text-[11px] font-bold text-slate-500">
          内置样式 <span className="font-normal text-slate-400">· 点一下套用</span>
        </div>
        <div className="space-y-1.5">
          {builtins.map(preset => (
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

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-500">我的预设</span>
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
                  preset.id === activePresetId ? 'border-primary/40 bg-primary/5' : 'border-slate-200 bg-white'
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
                    <button onClick={() => commitRename(preset.id)} className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-50">确定</button>
                    <button onClick={() => { setRenamingId(null); setRenameDraft(''); }} className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100">取消</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => applyPreset(preset)} className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-slate-700">{preset.name}</button>
                    <button
                      onClick={() => { setRenamingId(preset.id); setRenameDraft(preset.name); }}
                      aria-label={`重命名预设 ${preset.name}`}
                      className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >重命名</button>
                    <button
                      onClick={() => handleDelete(preset)}
                      aria-label={`删除预设 ${preset.name}`}
                      className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-50 hover:text-rose-500"
                    >删除</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-500">
            CSS 代码 <span className="font-normal text-slate-400">· {slotLabel}</span>
          </span>
          <div className="flex items-center gap-1">
            <input ref={fileRef} type="file" accept=".css,.txt,text/css,text/plain" className="hidden" onChange={handleImport} />
            <button onClick={() => fileRef.current?.click()} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50">导入</button>
            <button onClick={handleExport} disabled={!value.trim()} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${value.trim() ? 'text-indigo-500 hover:bg-indigo-50' : 'text-slate-300'}`}>导出</button>
            {value && (
              <button
                onClick={() => onPatch({ css: '', presets, presetId: undefined })}
                className="rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-50 hover:text-rose-500"
              >清空</button>
            )}
          </div>
        </div>
        <textarea
          value={value}
          onChange={(e) => onPatch({ css: e.target.value, presets, presetId: undefined })}
          placeholder={'/* 点上面「可可点点」套一套，或在这里直接写 / 粘贴 */\n.sully-ui-sheet{\n  background: #302C29 !important;\n}'}
          spellCheck={false}
          rows={8}
          className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-primary/50 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        />
        <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[10px] leading-relaxed text-amber-700">
          {scopeHint} 只用 <code className="font-mono">.sully-ui-*</code> 开头的选择器，
          别写 <code className="font-mono">body</code> / <code className="font-mono">*</code> / <code className="font-mono">div</code>。
          写坏了回这里点「清空」。
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/70">
        <button
          onClick={() => setCatalogOpen(open => !open)}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
          aria-expanded={catalogOpen}
        >
          <span className="text-[11px] font-bold text-slate-500">
            有哪些类名 <span className="font-normal text-slate-400">· {hooks.length} 个</span>
          </span>
          <span className="text-[10px] text-slate-400">{catalogOpen ? '收起' : '展开'}</span>
        </button>
        {catalogOpen && (
          <ul className="space-y-0.5 px-3 pb-3">
            {hooks.map(entry => (
              <li key={entry.hook} className="flex items-baseline gap-2 text-[10px] leading-relaxed">
                <code className="shrink-0 rounded bg-white px-1 font-mono text-slate-500">.{entry.hook}</code>
                <span className="min-w-0 text-slate-500">{entry.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CssSlotEditor;
