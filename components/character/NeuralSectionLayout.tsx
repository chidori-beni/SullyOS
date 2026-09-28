import React from 'react';
import { CaretRight, CaretUp, CaretDown } from '@phosphor-icons/react';
import { NEURAL_SECTIONS, NeuralSectionId } from '../../utils/neuralSectionOrder';

/**
 * 神经链接「设定」页可折叠卡片的标题行。
 * 整行标题是一个按钮（点了展开 / 收起）；右侧的操作按钮只在展开时出现，
 * 免得和折叠按钮叠在一起误触。
 */
export const SectionFoldHeader: React.FC<{
    title: React.ReactNode;
    titleClassName: string;
    open: boolean;
    onToggle: () => void;
    /** 收起时显示在标题下的一行摘要 */
    summary?: React.ReactNode;
    /** 展开时显示在标题下的说明 */
    description?: React.ReactNode;
    /** 展开时显示在右侧的操作按钮 */
    actions?: React.ReactNode;
}> = ({ title, titleClassName, open, onToggle, summary, description, actions }) => (
    <div className="flex items-start gap-2">
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-start gap-1.5 text-left active:opacity-70 transition-opacity"
        >
            <CaretRight size={12} weight="bold" className={`mt-0.5 shrink-0 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className="min-w-0 flex-1">
                <span className={`${titleClassName} uppercase tracking-widest flex items-center gap-1`}>{title}</span>
                {open
                    ? description && <span className="block text-[11px] text-slate-400 mt-1 leading-relaxed normal-case tracking-normal">{description}</span>
                    : summary && <span className="block text-[10px] text-slate-400 mt-0.5 truncate normal-case tracking-normal">{summary}</span>}
            </span>
        </button>
        {open && actions && <div className="flex shrink-0 gap-1.5">{actions}</div>}
    </div>
);

/** 调整模块顺序的面板：每行一个模块 + 上下箭头。手机上拖拽容易误触滚动，所以用按钮。 */
export const SectionOrderPanel: React.FC<{
    order: NeuralSectionId[];
    onMove: (id: NeuralSectionId, delta: -1 | 1) => void;
    onReset: () => void;
    onClose: () => void;
}> = ({ order, onMove, onReset, onClose }) => {
    const labelOf = (id: NeuralSectionId) => NEURAL_SECTIONS.find(s => s.id === id)?.label || id;
    return (
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-primary/20 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-[10px] font-bold text-primary uppercase tracking-widest">调整模块顺序</div>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">所有角色共用这一套顺序，只影响界面，不影响角色。</p>
                </div>
                <button type="button" onClick={onReset} className="shrink-0 text-[10px] text-slate-400 px-2.5 py-1 rounded-lg border border-slate-200 active:scale-95 transition-transform">恢复默认</button>
            </div>
            <div className="space-y-1.5">
                {order.map((id, i) => (
                    <div key={id} className="flex items-center gap-2 bg-slate-50 rounded-2xl pl-4 pr-1.5 py-1.5">
                        <span className="w-4 shrink-0 text-[10px] font-mono text-slate-300">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-xs font-bold text-slate-700">{labelOf(id)}</span>
                        <button
                            type="button"
                            onClick={() => onMove(id, -1)}
                            disabled={i === 0}
                            aria-label={`上移：${labelOf(id)}`}
                            className="w-8 h-8 rounded-xl bg-white text-slate-500 shadow-sm flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform"
                        ><CaretUp size={14} weight="bold" /></button>
                        <button
                            type="button"
                            onClick={() => onMove(id, 1)}
                            disabled={i === order.length - 1}
                            aria-label={`下移：${labelOf(id)}`}
                            className="w-8 h-8 rounded-xl bg-white text-slate-500 shadow-sm flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform"
                        ><CaretDown size={14} weight="bold" /></button>
                    </div>
                ))}
            </div>
            <button type="button" onClick={onClose} className="w-full py-2.5 bg-primary text-white text-xs font-bold rounded-2xl active:scale-95 transition-transform">完成</button>
        </div>
    );
};
