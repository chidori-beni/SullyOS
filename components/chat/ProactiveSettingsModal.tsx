import { useUiLocale } from '../../context/UiLocaleContext';
import { formatNaturalLastCheck, formatNaturalReason } from '../../utils/naturalProactiveLocale';
import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import type { CharacterProfile, NaturalProactiveConfig, NaturalProactiveIntensity } from '../../types';
import { type AmsgNaturalLastCheck } from '../../utils/amsgFirePack';
import { ActiveMsgClient } from '../../utils/activeMsgClient';
import { useNaturalProfileDisplay } from '../../hooks/useNaturalProfileDisplay';
import type { ProfileTranslationApi } from '../../utils/naturalProfileTranslation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  char: CharacterProfile;
  isNaturalActive: boolean;
  onSave: (config: NaturalProactiveConfig, refreshProfile: boolean) => Promise<void>;
  onStop: () => Promise<void>;
  apiConfig?: ProfileTranslationApi;
}

const INTENSITIES: Array<{ value: NaturalProactiveIntensity; label: import('../../utils/uiLocale').UiMessageKey; hint: import('../../utils/uiLocale').UiMessageKey }> = [
  { value: 'low', label: 'natural.low', hint: 'natural.lowHint' },
  { value: 'normal', label: 'natural.normal', hint: 'natural.normalHint' },
  { value: 'high', label: 'natural.high', hint: 'natural.highHint' },
];

const ProactiveSettingsModal: React.FC<Props> = ({ isOpen, onClose, char, isNaturalActive, onSave, onStop, apiConfig }) => {
  const { t: uiT, locale } = useUiLocale();
  const [enabled, setEnabled] = useState(char.naturalProactiveConfig?.enabled ?? false);
  const [intensity, setIntensity] = useState<NaturalProactiveIntensity>(char.naturalProactiveConfig?.intensity ?? 'normal');
  const [bias, setBias] = useState(char.naturalProactiveConfig?.bias ?? 0);
  const [busy, setBusy] = useState(false);
  const [lastCheck, setLastCheck] = useState<AmsgNaturalLastCheck | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEnabled(char.naturalProactiveConfig?.enabled ?? false);
    setIntensity(char.naturalProactiveConfig?.intensity ?? 'normal');
    setBias(char.naturalProactiveConfig?.bias ?? 0);
  }, [isOpen, char.id, char.naturalProactiveConfig]);

  // 云端上一次「要不要联系」的结果。读不到就整段不显示——这是一句锦上添花的说明，
  // 不该让面板打不开，更不该在没连 Worker 时报错。
  useEffect(() => {
    if (!isOpen || !isNaturalActive) { setLastCheck(null); return; }
    let alive = true;
    void (async () => {
      const value = await ActiveMsgClient.readNaturalLastCheck(char.id).catch(() => null);
      if (alive) setLastCheck(value);
    })();
    return () => { alive = false; };
  }, [isOpen, isNaturalActive, char.id]);

  const save = async (refreshProfile = false) => {
    setBusy(true);
    try {
      await onSave({ enabled, intensity, bias, profile: char.naturalProactiveConfig?.profile }, refreshProfile);
      onClose();
    } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try { await onStop(); setEnabled(false); onClose(); } finally { setBusy(false); }
  };

  const profile = char.naturalProactiveConfig?.profile;
  const display = useNaturalProfileDisplay(isOpen && enabled, locale, char.id, profile, apiConfig);
  return <Modal isOpen={isOpen} title={uiT('natural.title')} onClose={onClose} footer={<>
    <button disabled={busy} onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl disabled:opacity-50">{uiT('natural.cancel')}</button>
    {isNaturalActive && <button disabled={busy} onClick={() => void stop()} className="sully-ui-btn-danger flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl disabled:opacity-50">{uiT('natural.stop')}</button>}
    <button disabled={busy} onClick={() => void save(false)} className="flex-1 py-3 bg-violet-500 text-white font-bold rounded-2xl shadow-lg disabled:opacity-50">{busy ? uiT('natural.busy') : enabled ? uiT('natural.enable') : uiT('natural.save')}</button>
  </>}>
    <div className="space-y-5">
      <p className="text-xs text-slate-400 leading-relaxed">{uiT('natural.intro', { name: char.name })}</p>
      <div className="flex items-center justify-between">
        <div><div className="text-sm font-bold text-slate-700">{uiT('natural.allow')}</div><div className="text-[11px] text-slate-400 mt-1">{uiT('natural.promise')}</div></div>
        <button onClick={() => setEnabled(!enabled)} className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-violet-500' : 'bg-slate-200'}`}><span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${enabled ? 'translate-x-5' : ''}`} /></button>
      </div>
      {isNaturalActive && <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 rounded-xl border border-violet-100"><span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" /><span className="text-xs text-violet-600 font-medium">{uiT('natural.active')}</span></div>}
      {/* 「他为什么没说话」——不写出来的话，「不想说」和「坏了」在界面上长得一模一样。 */}
      {isNaturalActive && lastCheck && <div className="px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
        <div className="text-[11px] text-slate-500 leading-relaxed">{formatNaturalLastCheck(uiT, lastCheck, (ms) => new Date(ms).toLocaleString(locale))}</div>
        <div className="text-[10px] text-slate-400 mt-1.5">{uiT('natural.score', { score: lastCheck.score.toFixed(2), threshold: lastCheck.threshold.toFixed(2), reasons: lastCheck.reasons.length ? `（${lastCheck.reasons.map(reason => formatNaturalReason(uiT, reason)).join('、')}）` : '' })}</div>
      </div>}
      {enabled && <>
        <div><label className="text-sm font-bold text-slate-700 block mb-2">{uiT('natural.intensity')}</label><div className="grid grid-cols-3 gap-2">{INTENSITIES.map((item) => <button key={item.value} onClick={() => setIntensity(item.value)} className={`py-2 px-2 rounded-xl text-xs font-bold ${intensity === item.value ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{uiT(item.label)}</button>)}</div><p className="text-[11px] text-slate-400 mt-2">{INTENSITIES.find((item) => item.value === intensity) && uiT(INTENSITIES.find((item) => item.value === intensity)!.hint)}</p></div>
        <div><div className="flex justify-between text-sm font-bold text-slate-700 mb-2"><span>{uiT('natural.bias')}</span><span className="text-violet-500">{bias > 0 ? '+' : ''}{bias}</span></div><input type="range" min={-20} max={20} step={5} value={bias} onChange={(e) => setBias(Number(e.target.value))} className="w-full accent-violet-500" /><div className="flex justify-between text-[10px] text-slate-400"><span>{uiT('natural.less')}</span><span>{uiT('natural.zero')}</span><span>{uiT('natural.more')}</span></div></div>
        <div className="rounded-2xl bg-slate-50 p-3 border border-slate-100"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold text-slate-600">{profile ? uiT('natural.profile', { name: display.text?.archetype ?? profile.archetype }) : uiT('natural.first')}</div><p className="text-[11px] text-slate-400 leading-relaxed mt-1">{display.text?.summary ?? uiT('natural.fallback')}</p>{profile?.derivedAt && <p className="text-[10px] text-slate-300 mt-1">{uiT('natural.understood', { time: new Date(profile.derivedAt).toLocaleString(locale) })}</p>}</div>{profile && <button disabled={busy} onClick={() => void save(true)} className="shrink-0 text-[11px] font-bold text-violet-500 px-2 py-1.5 bg-white rounded-lg border border-violet-100">{uiT('natural.refresh')}</button>}</div></div>
        {display.loading && <p role="status" className="text-[11px] text-slate-400">{uiT('natural.translationLoading')}</p>}
        {display.missingApi && <p className="text-[11px] text-amber-500">{uiT('natural.translationApi')}</p>}
        {display.error && <div className="text-[11px] text-amber-600"><p role="status">{uiT('natural.translationError', { message: display.error })}</p><button type="button" onClick={display.retry} disabled={display.loading} className="mt-1 underline">{uiT('natural.translationRetry')}</button></div>}
        <p className="text-[11px] text-amber-500 leading-relaxed">{uiT('natural.note')}</p>
      </>}
    </div>
  </Modal>;
};

export default React.memo(ProactiveSettingsModal);
