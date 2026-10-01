import React, { useEffect, useState } from 'react';
import { useFirstUseGuideStep } from '../../utils/firstUseGuide';

// Section identity must not depend on translated display text.
// Actions remain outside the fold toggle button.
const SettingsSection: React.FC<{
    icon: React.ReactNode;
    title: string;
    badge?: React.ReactNode;
    actions?: React.ReactNode;
    sectionProps?: Record<string, any>;
    children: React.ReactNode;
}> = ({ icon, title, badge, actions, sectionProps, children }) => {
    const guideStep = useFirstUseGuideStep();
    const isApiSection = sectionProps?.['data-guide'] === 'api';
    const [open, setOpen] = useState(() => isApiSection && guideStep === 0);
    useEffect(() => {
        const reveal = () => { if (isApiSection && guideStep === 0) setOpen(true); };
        reveal();
        window.addEventListener('sully:guide-navigate', reveal);
        return () => window.removeEventListener('sully:guide-navigate', reveal);
    }, [guideStep, isApiSection]);
    return (
        <section {...sectionProps} className="bg-[#fffefe] rounded-3xl p-5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] border border-slate-200/80">
            <div className={`flex items-center justify-between gap-2 ${open ? 'mb-4' : ''}`}>
                <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {icon}
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">{title}</h2>
                    {badge}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-3 h-3 text-slate-300 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                </button>
                {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>
            {open && children}
        </section>
    );
};

export default SettingsSection;
