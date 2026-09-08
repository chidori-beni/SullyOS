import React from 'react';
import { CornersIn } from '@phosphor-icons/react';

interface WorldbookTextFullscreenEditorProps {
    isOpen: boolean;
    title: string;
    value: string;
    onChange: (value: string) => void;
    onExit: () => void;
    onSave: () => void;
    saveDisabled?: boolean;
    placeholder?: string;
    children?: React.ReactNode;
}

/**
 * 世界书正文共用的全屏编辑壳。
 * 只持有父组件传入的受控 value，不复制草稿，也不直接碰持久化层。
 */
const WorldbookTextFullscreenEditor: React.FC<WorldbookTextFullscreenEditorProps> = ({
    isOpen,
    title,
    value,
    onChange,
    onExit,
    onSave,
    saveDisabled = false,
    placeholder,
    children,
}) => {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[160] flex flex-col overflow-hidden bg-[#f5f6fa] font-sans text-slate-700"
            style={{ height: '100dvh', paddingBottom: 'var(--safe-bottom)' }}
            role="dialog"
            aria-modal="true"
            aria-label={`${title}全屏编辑`}
        >
            <div
                className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/70 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-xl"
                style={{ paddingTop: 'max(0.75rem, var(--safe-top))' }}
            >
                <button
                    type="button"
                    onClick={onExit}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 active:scale-95 transition-all"
                    aria-label="退出全屏编辑"
                >
                    <CornersIn size={16} weight="bold" />
                    退出全屏
                </button>
                <div className="min-w-0 text-center">
                    <div className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-400">Worldbook</div>
                    <div className="truncate text-sm font-bold text-slate-800">{title}</div>
                </div>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saveDisabled}
                    className="shrink-0 rounded-xl bg-indigo-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-600 active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                >
                    保存
                </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4">
                {children}
                <textarea
                    autoFocus
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    placeholder={placeholder}
                    aria-label={`${title}正文`}
                    className="min-h-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-white p-4 font-mono text-sm leading-relaxed text-slate-700 outline-none shadow-sm transition-all focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                />
            </div>
        </div>
    );
};

export default WorldbookTextFullscreenEditor;
