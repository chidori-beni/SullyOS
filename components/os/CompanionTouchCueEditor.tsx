import React from 'react';
import { Sparkle } from '@phosphor-icons/react';
import {
  AVATAR_CAMERAS,
  AVATAR_EMOTIONS,
  AVATAR_FACES,
  AVATAR_GESTURES,
  type AvatarPerformanceCue,
  type AvatarPerformanceDirection,
} from '../../utils/avatarPerformance';
import {
  canSplitPerformanceCues,
  cueDirectionForPhase,
  cueSplitPoints,
  cueTextAt,
  cueWindowMs,
  mergePerformanceCueIntoPrevious,
  patchCueDirection,
  recommendedHoldMs,
  splitPerformanceCueAt,
} from '../../utils/companionPerformanceCueEdit';
import type { AvatarTouchModelAction } from '../../utils/avatarTouch';

/**
 * 触摸台词的逐拍动作编排器。
 *
 * 和开机台词共用 `companionPerformanceCueEdit` 里的纯逻辑，但**不提供眼睛/身体
 * 的精调滑杆**：那几个是开机演出「锁头定格」才需要的，触摸是即时反应，
 * 姿势由触摸力度和落点决定，手调反而会被 applyAvatarTouchForce 覆盖掉。
 */

interface CompanionTouchCueEditorProps {
  cues: AvatarPerformanceCue[];
  /** cue.at 的基准串：译文 || 中文原文，必须与动作导演算 at 时用的一致。 */
  baseText: string;
  /** 整条台词的预计时长；有语音时应传实测值。 */
  durationMs: number;
  fallbackDirection: AvatarPerformanceDirection;
  modelActions: AvatarTouchModelAction[];
  emotionLabels: Record<string, string>;
  gestureLabels: Record<string, string>;
  cameraLabels: Record<string, string>;
  faceLabels: Record<string, string>;
  live2dActive: boolean;
  disabled?: boolean;
  generating?: boolean;
  accentColor: string;
  testId?: string;
  /** 选中位置由父层持有：预演会卸载抽屉，内部 state 会连同 DOM 一起丢掉。 */
  position: { index: number; phase: 'start' | 'end' };
  onPositionChange: (position: { index: number; phase: 'start' | 'end' }) => void;
  onChange: (cues: AvatarPerformanceCue[]) => void;
  onGenerate: () => void;
  onPreview: () => void;
}

const CompanionTouchCueEditor: React.FC<CompanionTouchCueEditorProps> = ({
  cues,
  baseText,
  durationMs,
  fallbackDirection,
  modelActions,
  emotionLabels,
  gestureLabels,
  cameraLabels,
  faceLabels,
  live2dActive,
  disabled = false,
  generating = false,
  accentColor,
  testId,
  position,
  onPositionChange,
  onChange,
  onGenerate,
  onPreview,
}) => {
  const phase = position.phase;
  const setIndex = (value: number) => onPositionChange({ index: value, phase });
  const setPhase = (value: 'start' | 'end') => onPositionChange({ index: position.index, phase: value });

  const selectedIndex = Math.min(position.index, Math.max(0, cues.length - 1));
  const selected = cues[selectedIndex];
  const editing = cueDirectionForPhase(selected, phase, fallbackDirection);
  const windowMs = cueWindowMs(cues, selectedIndex, durationMs);
  const recommended = recommendedHoldMs(windowMs);
  const splitPoints = cueSplitPoints(baseText, cues, selectedIndex);
  const canSplit = canSplitPerformanceCues(cues);
  const selectedFaces = editing.faces || [];

  const patch = (value: Partial<AvatarPerformanceDirection>) => {
    onChange(patchCueDirection(cues, selectedIndex, phase, value));
  };

  if (!cues.length) {
    return (
      <div className="mt-2" data-testid={testId}>
        <button
          type="button"
          disabled={disabled}
          onClick={onGenerate}
          className="flex w-full items-center justify-center gap-1.5 border border-white/14 bg-white/[0.035] py-2 text-[9px] font-medium text-white/78 transition active:scale-[.98] disabled:opacity-35"
        >
          <Sparkle size={12} style={{ color: accentColor }} />
          {generating ? '动作导演正在编排…' : '给这句编排逐拍动作'}
        </button>
        <div className="mt-1 text-[7px] leading-relaxed text-white/30">
          编排后这句话会像开机台词那样按语音时长分拍演出，每一拍可以有各自的表情和动作；不编排就整句用上面那一套姿势。
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-white/10 pt-2" data-testid={testId}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[8px] tracking-[0.1em] text-white/46">
        <span>逐拍动作</span>
        <span className="tracking-normal text-white/28">{cues.length} 拍</span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {cues.map((cue, cueIndex) => {
          const active = cueIndex === selectedIndex;
          return (
            <button
              key={`${cue.at}-${cueIndex}`}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => { setIndex(cueIndex); setPhase('start'); }}
              className="max-w-[132px] shrink-0 border px-2 py-1.5 text-left transition disabled:opacity-45"
              style={{
                borderColor: active ? `${accentColor}aa` : 'rgba(255,255,255,.12)',
                background: active ? `${accentColor}1e` : 'rgba(255,255,255,.025)',
                color: active ? accentColor : 'rgba(255,255,255,.56)',
              }}
            >
              <span className="block text-[7px] font-semibold">第 {cueIndex + 1} 拍 · {Math.round((cue.at || 0) * 100)}%</span>
              <span className="mt-0.5 block truncate text-[7px] opacity-70">
                {cueTextAt(baseText, cues, cueIndex) || `动作 ${cueIndex + 1}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1">
        {(['start', 'end'] as const).map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={phase === value}
            disabled={disabled}
            onClick={() => setPhase(value)}
            className="border px-2 py-1.5 text-[8px]"
            style={{
              borderColor: phase === value ? `${accentColor}aa` : 'rgba(255,255,255,.12)',
              color: phase === value ? accentColor : 'rgba(255,255,255,.5)',
            }}
          >{value === 'start' ? '1 · 起始动作' : '2 · 收尾动作'}</button>
        ))}
      </div>

      <label className="mt-2 block text-[8px] text-white/46">
        <span className="flex justify-between"><span>中段保持时长</span><span className="font-mono">{selected?.holdMs || 900}ms</span></span>
        <input
          type="range"
          min={120}
          max={5000}
          step={40}
          value={selected?.holdMs || 900}
          disabled={disabled}
          onChange={event => onChange(cues.map((cue, cueIndex) => (
            cueIndex === selectedIndex ? { ...cue, holdMs: Number(event.target.value) } : cue
          )))}
          className="mt-1 h-1 w-full"
          style={{ accentColor }}
        />
      </label>
      {windowMs > 0 && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="min-w-0 text-[7px] leading-relaxed text-white/34">
            本拍约 <span className="font-mono text-white/60">{windowMs}ms</span>
            {(selected?.holdMs || 900) > windowMs - 60 && (
              <span style={{ color: accentColor }}> · 超出窗口，播放时会被截到句尾</span>
            )}
          </span>
          <button
            type="button"
            disabled={disabled || !recommended}
            onClick={() => onChange(cues.map((cue, cueIndex) => (
              cueIndex === selectedIndex ? { ...cue, holdMs: recommended } : cue
            )))}
            className="shrink-0 border px-2 py-1 text-[7px] disabled:opacity-35"
            style={{ borderColor: `${accentColor}88`, color: accentColor }}
          >按本拍自动 {recommended || '—'}ms</button>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[8px] text-white/48">
          情绪{live2dActive ? '（Live2D 不改表情）' : ''}
          <select
            value={editing.emotion}
            disabled={disabled}
            onChange={event => patch({ emotion: event.target.value as AvatarPerformanceDirection['emotion'] })}
            className="mt-1 w-full border border-white/12 bg-[#151021] px-2 py-2 text-[9px] text-white/82"
          >
            {AVATAR_EMOTIONS.map(item => <option key={item} value={item}>{emotionLabels[item]}</option>)}
          </select>
        </label>
        <label className="text-[8px] text-white/48">
          主动作{live2dActive ? '（头 / 身体）' : ''}
          <select
            value={editing.gesture}
            disabled={disabled}
            onChange={event => patch({ gesture: event.target.value as AvatarPerformanceDirection['gesture'] })}
            className="mt-1 w-full border border-white/12 bg-[#151021] px-2 py-2 text-[9px] text-white/82"
          >
            {AVATAR_GESTURES.map(item => <option key={item} value={item}>{gestureLabels[item]}</option>)}
          </select>
        </label>
      </div>

      <label className="mt-2 block text-[8px] text-white/48">
        镜头（角色离屏幕的远近）
        <select
          value={editing.camera}
          disabled={disabled}
          onChange={event => patch({ camera: event.target.value as AvatarPerformanceDirection['camera'] })}
          className="mt-1 w-full border border-white/12 bg-[#151021] px-2 py-2 text-[9px] text-white/82"
        >
          {AVATAR_CAMERAS.map(item => <option key={item} value={item}>{cameraLabels[item]}</option>)}
        </select>
      </label>

      <div className="mt-2">
        <div className="text-[8px] text-white/48">
          微表情（最多 4 个{live2dActive ? '；Live2D 唯一改脸的一层' : ''}）
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {AVATAR_FACES.map(face => {
            const active = selectedFaces.includes(face);
            return (
              <button
                key={face}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => patch({
                  faces: active
                    ? selectedFaces.filter(item => item !== face)
                    : [...selectedFaces, face].slice(0, 4),
                })}
                className="border px-2 py-1 text-[8px] transition"
                style={{
                  borderColor: active ? `${accentColor}aa` : 'rgba(255,255,255,.12)',
                  background: active ? `${accentColor}1e` : 'rgba(255,255,255,.025)',
                  color: active ? accentColor : 'rgba(255,255,255,.54)',
                }}
              >{faceLabels[face]}</button>
            );
          })}
        </div>
      </div>

      {modelActions.length > 0 && (
        <label className="mt-2 block text-[8px] text-white/48">
          {live2dActive ? 'Live2D 模型专属动作' : '自定义表情'}
          <select
            value={editing.modelAction || ''}
            disabled={disabled}
            onChange={event => patch({
              modelAction: event.target.value || undefined,
              modelActions: event.target.value ? [event.target.value] : [],
            })}
            className="mt-1 w-full border border-white/12 bg-[#151021] px-2 py-2 text-[9px] text-white/82"
          >
            <option value="">不指定</option>
            {modelActions.map(action => <option key={action.id} value={action.id}>{action.name}</option>)}
          </select>
        </label>
      )}

      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="text-[8px] text-white/46">拆分这一拍</div>
        {splitPoints.length ? (
          <div className="mt-1.5 space-y-1">
            {splitPoints.map(point => (
              <button
                key={point.at}
                type="button"
                disabled={disabled || !canSplit}
                onClick={() => {
                  onChange(splitPerformanceCueAt(cues, selectedIndex, point.at));
                  setIndex(selectedIndex + 1);
                  setPhase('start');
                }}
                className="flex w-full items-center gap-1.5 border border-white/12 bg-white/[0.025] px-2 py-1.5 text-left text-[7px] leading-relaxed text-white/58 transition active:scale-[.99] disabled:opacity-35"
              >
                <span className="min-w-0 flex-1 truncate">{point.before}</span>
                <span className="shrink-0 font-semibold" style={{ color: accentColor }}>✂</span>
                <span className="min-w-0 flex-1 truncate">{point.after}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-[7px] leading-relaxed text-white/30">
            这一拍里没有逗号、顿号一类的停顿标点，没法再切。想拆就在上面的中文原文里那个位置加一个逗号。
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled || selectedIndex <= 0}
            onClick={() => {
              onChange(mergePerformanceCueIntoPrevious(cues, selectedIndex));
              setIndex(Math.max(0, selectedIndex - 1));
              setPhase('start');
            }}
            className="border border-white/12 px-2 py-1 text-[7px] text-white/58 disabled:opacity-30"
          >并回上一拍</button>
          <button
            type="button"
            disabled={disabled}
            onClick={onPreview}
            className="border px-2 py-1 text-[7px] disabled:opacity-35"
            style={{ borderColor: `${accentColor}88`, color: accentColor }}
          >预演这句</button>
          <button
            type="button"
            disabled={disabled}
            onClick={onGenerate}
            className="ml-auto border border-white/12 px-2 py-1 text-[7px] text-white/48 disabled:opacity-30"
          >{generating ? '编排中…' : '重新编排'}</button>
        </div>
      </div>
    </div>
  );
};

export default CompanionTouchCueEditor;
