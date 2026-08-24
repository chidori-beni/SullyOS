import React, { useState } from 'react';
import { Moon, X } from '@phosphor-icons/react';

/**
 * 「陪睡」定时挂断预设。0 = 不自动挂断。
 * 照搬糯叽机那份：关闭 / 30 分 / 1 小时 / 2 小时 / 8 小时，外加自定义分钟数。
 */
const AUTO_HANGUP_PRESETS: { mins: number; label: string }[] = [
  { mins: 0, label: '不自动挂断' },
  { mins: 30, label: '30 分钟' },
  { mins: 60, label: '1 小时' },
  { mins: 120, label: '2 小时' },
  { mins: 480, label: '8 小时' },
];

interface SleepCompanionSheetProps {
  charName: string;
  sleepMode: boolean;
  autoHangupMinutes: number;
  accentColor: string;
  lightTheme: boolean;
  onChangeAutoHangup: (minutes: number) => void;
  onToggleSleep: () => void;
  onClose: () => void;
}

const SleepCompanionSheet: React.FC<SleepCompanionSheetProps> = ({
  charName,
  sleepMode,
  autoHangupMinutes,
  accentColor,
  lightTheme,
  onChangeAutoHangup,
  onToggleSleep,
  onClose,
}) => {
  // 自定义分钟数：值不在预设列表里时，一开始就展开自定义输入框，而不是显得"哪个都没选中"。
  const isPreset = AUTO_HANGUP_PRESETS.some(p => p.mins === autoHangupMinutes);
  const [customOpen, setCustomOpen] = useState(!isPreset && autoHangupMinutes > 0);
  const [customValue, setCustomValue] = useState(!isPreset && autoHangupMinutes > 0 ? String(autoHangupMinutes) : '');

  const pillStyle = (active: boolean) => ({
    padding: '7px 14px',
    borderRadius: '999px',
    border: '1px solid',
    borderColor: active ? `${accentColor}88` : lightTheme ? 'rgba(38,34,57,.12)' : 'rgba(255,255,255,.14)',
    background: active ? `${accentColor}20` : lightTheme ? 'rgba(38,34,57,.03)' : 'rgba(255,255,255,.04)',
    color: active ? accentColor : lightTheme ? 'rgba(38,34,57,.7)' : 'rgba(255,255,255,.68)',
    fontSize: '12px',
    fontWeight: 600 as const,
    cursor: 'pointer',
    transition: 'all .2s',
  });

  return (
    <div
      className="absolute inset-0 z-[85] flex items-end bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sleep-companion-title"
      onClick={onClose}
    >
      <section
        className={`w-full rounded-t-[1.75rem] border-t px-5 pt-4 shadow-2xl ${lightTheme ? 'border-[#262239]/10 bg-[#f7f5fb]' : 'border-white/12 bg-[#120c22]'}`}
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom, 0px))', maxHeight: '80%', overflowY: 'auto' }}
        onClick={event => event.stopPropagation()}
      >
        <div className={`mx-auto mb-4 h-1 w-10 rounded-full ${lightTheme ? 'bg-[#262239]/15' : 'bg-white/15'}`} aria-hidden />
        <header className="flex items-center justify-between gap-3">
          <h2 id="sleep-companion-title" className={`flex items-center gap-1.5 text-lg font-semibold ${lightTheme ? 'text-[#262239]' : 'text-white/90'}`}>
            <Moon size={18} weight="fill" style={{ color: accentColor }} /> 陪睡 · 哄睡
          </h2>
          <button
            type="button"
            onClick={onToggleSleep}
            className="shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition active:scale-95"
            style={sleepMode
              ? { background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`, boxShadow: `0 0 16px ${accentColor}55` }
              : { background: lightTheme ? 'rgba(38,34,57,.12)' : 'rgba(255,255,255,.14)', color: lightTheme ? '#262239' : '#fff' }}
          >
            {sleepMode ? '陪睡中' : '开始陪睡'}
          </button>
        </header>
        <p className={`mt-3 text-[12px] leading-relaxed ${lightTheme ? 'text-[#262239]/60' : 'text-white/55'}`}>
          开启后你可以全程安静，安心睡觉。{charName}会先用一大段轻声细语哄你入睡（讲故事、念诗、絮语），
          之后自己也睡去；深夜偶尔会冒出一两句梦话彩蛋。整夜通常只调用 1～3 次，不会一直生成。
          随时可以手动挂断结束这通电话。
        </p>

        <div className="mt-5">
          <div className={`text-[13px] font-semibold ${lightTheme ? 'text-[#262239]/85' : 'text-white/80'}`}>⏰ 定时挂断</div>
          <p className={`mt-1 mb-2.5 text-[11px] leading-5 ${lightTheme ? 'text-[#262239]/50' : 'text-white/40'}`}>
            开始陪睡后维持这个时长，到点自动挂断结束通话。
          </p>
          <div className="flex flex-wrap gap-2">
            {AUTO_HANGUP_PRESETS.map(preset => (
              <button
                key={preset.mins}
                type="button"
                onClick={() => { setCustomOpen(false); onChangeAutoHangup(preset.mins); }}
                style={pillStyle(!customOpen && autoHangupMinutes === preset.mins)}
              >
                {preset.label}
              </button>
            ))}
            <button type="button" onClick={() => setCustomOpen(v => !v)} style={pillStyle(customOpen)}>
              自定义
            </button>
          </div>
          {customOpen && (
            <div className="mt-2.5 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={customValue}
                onChange={event => {
                  const raw = event.target.value;
                  setCustomValue(raw);
                  const mins = Math.max(0, Math.floor(Number(raw) || 0));
                  if (mins > 0) onChangeAutoHangup(mins);
                }}
                placeholder="分钟数"
                className={`w-28 rounded-xl border px-3 py-2 text-[13px] outline-none ${lightTheme ? 'border-[#262239]/12 bg-white text-[#262239]' : 'border-white/14 bg-white/[0.06] text-white'}`}
              />
              <span className={`text-[12px] ${lightTheme ? 'text-[#262239]/55' : 'text-white/50'}`}>分钟</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border py-2.5 text-[12px] transition active:scale-[.98] ${lightTheme ? 'border-[#262239]/12 text-[#262239]/60' : 'border-white/12 text-white/55'}`}
        >
          <X size={13} weight="bold" /> 关闭
        </button>
      </section>
    </div>
  );
};

export default SleepCompanionSheet;
