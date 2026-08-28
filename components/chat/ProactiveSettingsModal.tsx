import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import type { CharacterProfile, NaturalProactiveConfig, NaturalProactiveIntensity } from '../../types';
import { type AmsgNaturalLastCheck, describeNaturalLastCheck } from '../../utils/amsgFirePack';
import { ActiveMsgClient } from '../../utils/activeMsgClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  char: CharacterProfile;
  isNaturalActive: boolean;
  onSave: (config: NaturalProactiveConfig, refreshProfile: boolean) => Promise<void>;
  onStop: () => Promise<void>;
}

const INTENSITIES: Array<{ value: NaturalProactiveIntensity; label: string; hint: string }> = [
  { value: 'low', label: '克制', hint: '通常隔 30～60 分钟才重新考虑一次' },
  { value: 'normal', label: '自然', hint: '通常隔 15～30 分钟，主要服从角色人设与当下关系' },
  { value: 'high', label: '热络', hint: '通常隔 8～20 分钟，更容易把一闪而过的念头发给你' },
];

const ProactiveSettingsModal: React.FC<Props> = ({ isOpen, onClose, char, isNaturalActive, onSave, onStop }) => {
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
  return <Modal isOpen={isOpen} title="自然主动" onClose={onClose} footer={<>
    <button disabled={busy} onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl disabled:opacity-50">取消</button>
    {isNaturalActive && <button disabled={busy} onClick={() => void stop()} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl disabled:opacity-50">停止</button>}
    <button disabled={busy} onClick={() => void save(false)} className="flex-1 py-3 bg-violet-500 text-white font-bold rounded-2xl shadow-lg disabled:opacity-50">{busy ? '准备中…' : enabled ? '开启' : '保存'}</button>
  </>}>
    <div className="space-y-5">
      <p className="text-xs text-slate-400 leading-relaxed">没有固定发送间隔。{char.name} 会根据自己的人设、多久没聊天、有没有未完话题、现在是否适合打扰，以及你有没有回复，决定此刻要不要联系你。</p>
      <div className="flex items-center justify-between">
        <div><div className="text-sm font-bold text-slate-700">允许自然主动联系</div><div className="text-[11px] text-slate-400 mt-1">主动消息 2.0 仍用于提醒、约定和具体承诺</div></div>
        <button onClick={() => setEnabled(!enabled)} className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-violet-500' : 'bg-slate-200'}`}><span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${enabled ? 'translate-x-5' : ''}`} /></button>
      </div>
      {isNaturalActive && <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 rounded-xl border border-violet-100"><span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" /><span className="text-xs text-violet-600 font-medium">自然主动正在云端观察中</span></div>}
      {/* 「他为什么没说话」——不写出来的话，「不想说」和「坏了」在界面上长得一模一样。 */}
      {isNaturalActive && lastCheck && <div className="px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
        <div className="text-[11px] text-slate-500 leading-relaxed">{describeNaturalLastCheck(lastCheck, (ms) => new Date(ms).toLocaleString())}</div>
        <div className="text-[10px] text-slate-400 mt-1.5">当时想联系的程度 {lastCheck.score.toFixed(2)}，需要达到 {lastCheck.threshold.toFixed(2)}{lastCheck.reasons.length ? `（${lastCheck.reasons.join('、')}）` : ''}</div>
      </div>}
      {enabled && <>
        <div><label className="text-sm font-bold text-slate-700 block mb-2">总体热络程度</label><div className="grid grid-cols-3 gap-2">{INTENSITIES.map((item) => <button key={item.value} onClick={() => setIntensity(item.value)} className={`py-2 px-2 rounded-xl text-xs font-bold ${intensity === item.value ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{item.label}</button>)}</div><p className="text-[11px] text-slate-400 mt-2">{INTENSITIES.find((item) => item.value === intensity)?.hint}</p></div>
        <div><div className="flex justify-between text-sm font-bold text-slate-700 mb-2"><span>对人设的轻微修正</span><span className="text-violet-500">{bias > 0 ? '+' : ''}{bias}</span></div><input type="range" min={-20} max={20} step={5} value={bias} onChange={(e) => setBias(Number(e.target.value))} className="w-full accent-violet-500" /><div className="flex justify-between text-[10px] text-slate-400"><span>更少打扰</span><span>0 = 完全按人设</span><span>更常想起你</span></div></div>
        <div className="rounded-2xl bg-slate-50 p-3 border border-slate-100"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold text-slate-600">{profile ? `联络画像：${profile.archetype}` : '首次开启会阅读角色人设'}</div><p className="text-[11px] text-slate-400 leading-relaxed mt-1">{profile?.summary ?? '只读取一次并保存画像，不会每次检查都烧一遍模型。'}</p>{profile?.derivedAt && <p className="text-[10px] text-slate-300 mt-1">上次理解：{new Date(profile.derivedAt).toLocaleString()}</p>}</div>{profile && <button disabled={busy} onClick={() => void save(true)} className="shrink-0 text-[11px] font-bold text-violet-500 px-2 py-1.5 bg-white rounded-lg border border-violet-100">重新理解</button>}</div></div>
        <p className="text-[11px] text-amber-500 leading-relaxed">这些是“重新考虑”的频率，不是到了时间一定发送；连续没有收到你的回复会明显压低他的联系冲动，但只要再隔久一点，他仍然会重新想起你——真正停下只有连续 20 条未回复这一种情况，你回一句就立刻恢复。深夜默认更克制。开启需要已经部署并连接“主动消息 2.0”的云端 Worker。</p>
      </>}
    </div>
  </Modal>;
};

export default React.memo(ProactiveSettingsModal);
