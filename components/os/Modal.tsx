
import React from 'react';
import { useUiLocale } from '../../context/UiLocaleContext';

/**
 * 全 App 共用的居中弹窗底座（30 个文件在用）。
 *
 * 这里的 .sully-ui-* 类名是「全局弹窗 CSS」的钩子，名录见 utils/globalCss.ts。
 * 改结构时别把它们弄丢 —— 有守卫测试盯着，但丢了等于用户那份 CSS 一半失效。
 */

interface ModalProps {
    isOpen: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, title, onClose, children, footer }) => {
    const { t } = useUiLocale();
    if (!isOpen) return null;

    // 本 fork：避开刘海/横条的留白用类名而不是行内 style——行内样式会盖过用户给 .sully-ui-layer 写的美化 CSS
    return (
        <div className="sully-ui-layer fixed inset-0 z-[100] flex items-center justify-center p-6 pt-[calc(var(--safe-top,0px)+1rem)] pb-[calc(var(--safe-bottom,0px)+1rem)] max-h-[var(--visual-viewport-height,100dvh)] animate-fade-in">
            <div className="sully-ui-overlay absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="sully-ui-modal relative w-full max-w-sm max-h-full flex flex-col min-h-0 bg-white text-slate-800 rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up">
                <div className="sully-ui-head px-6 pt-6 pb-2 shrink-0">
                    <h3 className="sully-ui-title text-lg font-bold text-slate-800 text-center">{title}</h3>
                </div>
                <div className="sully-ui-body min-w-0 px-6 py-4 min-h-0 max-h-[60vh] overflow-y-auto overflow-x-hidden overscroll-contain no-scrollbar">
                    {children}
                </div>
                {footer ? (
                    <div className="sully-ui-foot px-6 pb-6 flex gap-3 shrink-0">
                        {footer}
                    </div>
                ) : (
                    <div className="sully-ui-foot px-6 pb-6 shrink-0">
                        <button 
                            onClick={onClose}
                            className="sully-ui-btn-ghost w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
                        >
                            {t('common.close')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
