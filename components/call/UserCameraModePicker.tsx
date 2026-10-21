import { useUiLocale } from '../../context/UiLocaleContext';
import { formatCallDetailText } from '../../utils/callDetailLocale';
import React, { useEffect, useRef } from 'react';

export type UserCameraMode = 'off' | 'fake' | 'emotion' | 'snapshot';

interface UserCameraModePickerProps {
  mode: UserCameraMode;
  busy?: boolean;
  hasFakeImage: boolean;
  accentColor: string;
  lightTheme?: boolean;
  onSelect: (mode: UserCameraMode) => void;
  onChooseFakeImage: () => void;
  onRemoveFakeImage: () => void;
  onClose: () => void;
}

const MODES: Array<{
  id: UserCameraMode;
  index: string;
  title: string;
  tag: string;
  description: string;
}> = [
  { id: 'off', index: '0', title: '关闭', tag: 'DEFAULT', description: '不打开摄像头，也不添加任何视觉上下文' },
  { id: 'fake', index: '1', title: '假摄像头', tag: 'STILL', description: '放一张自己的图片，只让通话截图更好看' },
  { id: 'emotion', index: '2', title: '本地情绪', tag: 'LOCAL', description: '本机识别表情，只提交一小段情绪文字' },
  { id: 'snapshot', index: '3', title: '每轮快照', tag: 'VISION', description: '发送时取一帧；记录只保留最近 3 轮，旧图显示 [图片]' },
];

const UserCameraModePicker: React.FC<UserCameraModePickerProps> = ({
  mode,
  busy = false,
  hasFakeImage,
  accentColor,
  lightTheme = false,
  onSelect,
  onChooseFakeImage,
  onRemoveFakeImage,
  onClose,
}) => {
  const { t: uiT } = useUiLocale();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  return (
    <div className="absolute inset-0 z-[180] flex items-end bg-black/66 backdrop-blur-sm" data-testid="user-camera-mode-picker">
      <button type="button" aria-label={uiT('call.detail.label062')} className="absolute inset-0" disabled={busy} onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-camera-mode-title"
        tabIndex={-1}
        className={`relative w-full overflow-hidden rounded-t-[2rem] border-t outline-none ${lightTheme ? 'border-[#4d4760]/12 bg-[#f7f4fc] text-[#2d2838]' : 'border-white/12 bg-[#100b1c] text-white'}`}
        style={{ paddingBottom: 'max(1rem, var(--safe-bottom))' }}
        onClick={event => event.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-current opacity-15" />
        <div className="px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[9px] font-semibold tracking-[0.24em] opacity-40">USER CAMERA / PRIVACY</span>
              <h2 id="user-camera-mode-title" className="mt-1 text-[18px] font-semibold">{uiT('call.detail.label063')}</h2>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="rounded-full border border-current/10 px-3 py-1.5 text-[11px] opacity-55 transition active:scale-95">{uiT('call.detail.label064')}</button>
          </div>
          <p className="mt-2 text-[11px] leading-5 opacity-48">{uiT('call.detail.label065')}</p>
        </div>

        <div className="border-y border-current/10">
          {MODES.map(option => {
            const active = mode === option.id;
            const fakeNeedsImage = option.id === 'fake' && !hasFakeImage;
            return (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => fakeNeedsImage ? onChooseFakeImage() : onSelect(option.id)}
                className="grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-current/8 px-5 py-3.5 text-left transition last:border-b-0 active:bg-current/[0.04] disabled:opacity-45"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full border text-[12px] font-semibold"
                  style={active ? { borderColor: `${accentColor}aa`, background: `${accentColor}20`, color: accentColor } : { borderColor: 'currentColor', opacity: 0.35 }}
                >
                  {option.index}
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[14px] font-medium">{formatCallDetailText(uiT, option.title)}</span>
                    <span className="text-[8px] tracking-[0.18em] opacity-35">{option.tag}</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 opacity-48">{fakeNeedsImage ? uiT('call.detail.label066') : option.description}</span>
                </span>
                <span className="min-w-[3rem] text-right text-[10px] font-medium" style={{ color: active ? accentColor : undefined, opacity: active ? 1 : 0.34 }}>
                  {busy && option.id !== 'off' ? uiT('call.detail.label067') : active ? uiT('call.detail.label068') : fakeNeedsImage ? uiT('call.detail.label069') : uiT('call.detail.label070')}
                </span>
              </button>
            );
          })}
        </div>

        {hasFakeImage && (
          <div className="flex items-center justify-end gap-4 px-5 pt-3 text-[10px]">
            <button type="button" onClick={onChooseFakeImage} className="opacity-55 transition active:opacity-35">{uiT('call.detail.label071')}</button>
            <button type="button" onClick={onRemoveFakeImage} className="text-rose-400/75 transition active:opacity-45">{uiT('call.detail.label072')}</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserCameraModePicker;
