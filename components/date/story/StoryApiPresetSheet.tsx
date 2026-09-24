import React, { useEffect } from 'react';
import { Check, Plugs, X } from '@phosphor-icons/react';
import type { APIConfig, ApiPreset } from '../../../types';
import { useOS } from '../../../context/OSContext';

/**
 * 剧情专用 API 选择。
 *
 * 预设就是「设置 → API」里存的那一份；这里选的只记在剧情这边，
 * 主 API、聊天、见面陪伴都不受影响。选「跟随主 API」就回到原来的行为。
 */
interface Props {
    apiPresets: ApiPreset[];
    mainApi: Pick<APIConfig, 'model'>;
    selectedId: string | null;
    onSelect: (presetId: string | null) => void;
    onClose: () => void;
}

const StoryApiPresetSheet: React.FC<Props> = ({ apiPresets, mainApi, selectedId, onSelect, onClose }) => {
    const { registerBackHandler } = useOS();
    useEffect(() => registerBackHandler(() => { onClose(); return true; }), [onClose, registerBackHandler]);

    const row = (key: string, active: boolean, title: string, sub: string, onClick: () => void) => (
        <button key={key} type='button' onClick={onClick} className={`w-full py-3.5 flex items-center gap-3 text-left ${active ? 'text-violet-700' : ''}`}>
            <span className='min-w-0 flex-1'>
                <strong className={`block truncate text-xs ${active ? 'text-violet-700' : 'text-slate-700'}`}>{title}</strong>
                <span className='block mt-0.5 truncate text-[10px] text-slate-400'>{sub}</span>
            </span>
            {active && <span className='shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-violet-600'><Check size={12} weight='bold' />使用中</span>}
        </button>
    );

    return <div className='fixed inset-0 z-[170] flex items-end justify-center' style={{ backgroundColor: 'rgba(2, 6, 23, .35)' }} onClick={onClose} role='presentation' data-testid='story-api-preset-sheet'>
        <div className='story-safe-sheet w-full max-h-[75%] flex flex-col sm:max-w-sm rounded-t-[28px] bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()} role='dialog' aria-modal='true' aria-label='剧情专用 API'>
            <div className='shrink-0 flex items-start gap-4'>
                <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5 text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'><Plugs size={12} weight='fill' />Story API</div>
                    <h2 className='mt-1 text-lg font-semibold'>剧情用哪个 API</h2>
                    <p className='mt-1 text-[10px] leading-5 text-slate-500'>只在剧情里生效，私聊、见面陪伴和设置里的主 API 都不变。正在生成的这一轮不受影响，下一轮开始用新的。</p>
                </div>
                <button type='button' onClick={onClose} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' aria-label='关闭'><X size={17} /></button>
            </div>
            <div className='mt-4 min-h-0 overflow-y-auto overscroll-contain border-t border-slate-200 divide-y divide-slate-200'>
                {row('__main__', !selectedId, '跟随主 API', mainApi.model ? `现在是 ${mainApi.model}` : '设置里当前用的那个', () => onSelect(null))}
                {apiPresets.map(preset => row(preset.id, preset.id === selectedId, preset.name, preset.config.model || '未填模型', () => onSelect(preset.id)))}
                {apiPresets.length === 0 && <div className='py-6 text-center text-[11px] leading-5 text-slate-400'>还没有保存过 API 预设。<br />去「设置 → API」存一条，这里就会出现。</div>}
            </div>
        </div>
    </div>;
};

export default StoryApiPresetSheet;
