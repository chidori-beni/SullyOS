import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import type { CharacterProfile } from '../../types';
import {
    clearSlimBackup,
    collectSlimTargets,
    readSlimBackup,
    restoreCharImageSlim,
    runCharImageSlim,
    totalSlimChars,
} from '../../utils/charImageSlim';

/** base64 字符数 → 大致的 MB（给人看，不求精确）。 */
const toMb = (chars: number) => (chars * 0.75 / 1024 / 1024).toFixed(1);

/**
 * 见面设置里的「立绘瘦身」卡片（2026-11-21）。
 * 立绘和见面背景以原图塞在角色档案里，档案一大，打电话 / 收消息时手机内存吃紧。
 * 这里一键重新压一遍，原图另存、可以还原。逻辑全在 utils/charImageSlim.ts。
 */
const DateImageSlimCard: React.FC<{ char: CharacterProfile }> = ({ char }) => {
    const { updateCharacter, addToast } = useOS();
    const targets = useMemo(() => collectSlimTargets(char), [char.sprites, char.dateSkinSets, char.dateBackground]);
    const totalChars = useMemo(() => totalSlimChars(targets), [targets]);
    const [backupCount, setBackupCount] = useState(0);
    const [busy, setBusy] = useState<'' | 'slim' | 'restore'>('');
    const [progress, setProgress] = useState('');

    useEffect(() => {
        let alive = true;
        readSlimBackup(char.id).then(list => { if (alive) setBackupCount(list.length); });
        return () => { alive = false; };
    }, [char.id, busy]);

    const handleSlim = async () => {
        if (busy) return;
        if (!window.confirm(`把 ${char.name} 的 ${targets.length} 张立绘 / 背景重新压缩一遍？\n\n原图会另外存一份，随时可以点「还原原图」换回来。`)) return;
        setBusy('slim');
        try {
            const result = await runCharImageSlim(char, (done, total, label) => {
                setProgress(label ? `正在处理 ${done + 1}/${total}：${label}` : '');
            });
            if (result.changed > 0) {
                updateCharacter(char.id, result.patch);
                addToast(`压缩了 ${result.changed} 张：约 ${toMb(result.beforeChars)} MB → ${toMb(result.afterChars)} MB`, 'success');
            } else {
                addToast(result.failed > 0 ? `有 ${result.failed} 张读不出来，其它已经够小，没有改动` : '这些图已经够小了，没有改动', 'info');
            }
        } catch (error: any) {
            addToast(`压缩失败：${error?.message || error}`, 'error');
        } finally {
            setProgress('');
            setBusy('');
        }
    };

    const handleRestore = async () => {
        if (busy) return;
        if (!window.confirm(`把 ${char.name} 的立绘 / 背景换回压缩前的原图？`)) return;
        setBusy('restore');
        try {
            const result = await restoreCharImageSlim(char);
            if (result.restored > 0) {
                updateCharacter(char.id, result.patch);
                await clearSlimBackup(char.id);
                addToast(`已还原 ${result.restored} 张原图${result.missing ? `（${result.missing} 张找不到）` : ''}`, 'success');
            } else {
                addToast('没找到可以还原的原图', 'info');
            }
        } catch (error: any) {
            addToast(`还原失败：${error?.message || error}`, 'error');
        } finally {
            setBusy('');
        }
    };

    if (targets.length === 0 && backupCount === 0) return null;

    return (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-700">立绘瘦身</h3>
                <span className="text-[11px] text-slate-400">{targets.length} 张 · 约 {toMb(totalChars)} MB</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                立绘和见面背景是原图存在角色里的，太大会让打电话、收消息时手机内存吃紧。压缩后手机上看不出区别，原图另存一份可以还原。
            </p>
            {progress && <p className="text-[11px] text-primary mt-2">{progress}</p>}
            <div className="flex gap-2 mt-3">
                <button
                    type="button"
                    disabled={!!busy || targets.length === 0}
                    onClick={handleSlim}
                    className="flex-1 py-2 rounded-xl bg-primary text-white text-xs font-semibold disabled:opacity-50"
                >
                    {busy === 'slim' ? '压缩中…' : '压缩立绘和背景'}
                </button>
                {backupCount > 0 && (
                    <button
                        type="button"
                        disabled={!!busy}
                        onClick={handleRestore}
                        className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold disabled:opacity-50"
                    >
                        {busy === 'restore' ? '还原中…' : `还原原图（${backupCount}）`}
                    </button>
                )}
            </div>
        </div>
    );
};

export default DateImageSlimCard;
