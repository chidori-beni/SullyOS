import React from 'react';
import { Check } from '@phosphor-icons/react';
import type { APIConfig, ApiPreset } from '../../types';
import { findActivePresetId } from '../../utils/apiPresetSwitch';

/**
 * 通话中快捷切换主 API 预设。
 *
 * 预设是全 App 通用的那一份（设置 → API 里存的），点一下走 commitApiConfig，
 * 和设置页、聊天设置里的切换是同一条路：立即生效、云端凭据一起换。
 * 正在生成的这一轮不受影响，下一句开始走新 API。
 */
interface Props {
  apiPresets: ApiPreset[];
  apiConfig: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
  accentColor: string;
  lightTheme: boolean;
  onApply: (preset: ApiPreset) => void;
  onClose: () => void;
}

const CallApiPresetSheet: React.FC<Props> = ({ apiPresets, apiConfig, accentColor, lightTheme, onApply, onClose }) => {
  const activeId = findActivePresetId(apiPresets, apiConfig);
  return (
    <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end" onClick={onClose} data-testid="call-api-preset-sheet">
      <div className={`w-full border-t border-white/10 rounded-t-3xl p-5 space-y-3 ${lightTheme ? 'bg-[#f6f4fc]' : 'bg-[#120c22]'}`}
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom, 0px))' }}
        onClick={e => e.stopPropagation()}>
        <div className="text-sm text-white/80 font-medium">切换 API</div>
        <p className="text-xs text-white/40">
          {activeId
            ? '点一下立即生效，下一句就用新的 API；和设置里的是同一份预设。'
            : `当前用的是手填配置${apiConfig.model ? `（${apiConfig.model}）` : ''}，不在预设里。点一条即可切过去。`}
        </p>
        {apiPresets.length === 0 ? (
          <div className="rounded-2xl border border-white/10 px-4 py-5 text-center text-xs text-white/45">
            还没有保存过 API 预设。<br />挂断后去「设置 → API」存一条，这里就会出现。
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-y-auto space-y-2 pt-1">
            {apiPresets.map(preset => {
              const active = preset.id === activeId;
              return (
                <button key={preset.id} type="button"
                  onClick={() => onApply(preset)}
                  className="w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.98]"
                  style={active
                    ? { borderColor: `${accentColor}99`, background: `${accentColor}26`, boxShadow: `0 0 14px ${accentColor}33` }
                    : { borderColor: 'rgba(255,255,255,.1)', background: lightTheme ? 'rgba(38,34,57,0.05)' : 'rgba(255,255,255,.04)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-white/85">{preset.name}</div>
                    <div className="mt-0.5 truncate text-[10px] text-white/40">{preset.config.model || '未填模型'}</div>
                  </div>
                  {active && (
                    <span className="flex shrink-0 items-center gap-1 text-[10px]" style={{ color: accentColor }}>
                      <Check size={12} weight="bold" /> 使用中
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CallApiPresetSheet;
