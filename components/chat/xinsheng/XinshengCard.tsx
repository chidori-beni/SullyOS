// 默认心声卡（displayMode = 'planner'）。
//
// 糯叽机那边这是一张写死的蓝灰「手账本」，带丝带书签和四个页签，其中两页读的是
// 糯叽机自己的资料/日程数据。这里按 Sully 的观感重画成一张玻璃拟态卡，
// **字段和语义完全照旧**：innerVoice / statusText / temperature / emotionLevel / moodDelta，
// 外加「自定义字段」区 —— 自定义提示词多吐的字段会自动列在那里（糯叽机的承诺之一，
// 不然改了提示词却还没写布局模板的人会以为字段丢了）。
//
// 想要论坛上那些花哨外观的，切到 'layout' 模式用 XinshengLayoutRenderer。

import React from 'react';
import type { XinshengEntry } from '../../../utils/xinsheng/xinshengData';

/** 默认卡认领的字段；其余一律进「自定义字段」区。 */
const BUILTIN_KEYS = new Set([
    'innerVoice', 'statusText', 'temperature', 'emotionLevel', 'moodDelta',
    'weather', 'location', 'activity', 'raw',
]);

interface Props {
    entry: XinshengEntry;
    charName?: string;
    charAvatar?: string;
}

const moodDeltaColor = (delta: string | null): string => {
    if (!delta) return 'text-slate-400';
    if (delta.startsWith('+') && delta !== '+0') return 'text-emerald-500';
    if (delta.startsWith('-')) return 'text-rose-400';
    return 'text-slate-400';
};

export const XinshengCard: React.FC<Props> = ({ entry, charName, charAvatar }) => {
    const level = Math.max(0, Math.min(100, Number(entry.emotionLevel) || 0));
    const extras = Object.entries(entry)
        // `_favorited` / `_at` 是我们自己挂的内部字段，不是角色说的话
        .filter(([k, v]) => !BUILTIN_KEYS.has(k) && !k.startsWith('_') && v != null && v !== '');

    return (
        <div className="w-full rounded-[2rem] bg-white/95 backdrop-blur-xl shadow-2xl border border-white/60 overflow-hidden">
            {/* 头部：头像 + 名字 + 情绪指数 */}
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
                {charAvatar
                    ? <img src={charAvatar} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow" />
                    : <div className="w-12 h-12 rounded-full bg-slate-200" />}
                <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold text-slate-800 truncate">{charName || '心声'}</div>
                    <div className="text-[10px] tracking-[0.2em] text-slate-400 uppercase">Inner Voice</div>
                </div>
                <div className="text-right shrink-0">
                    <div className="text-[22px] font-bold text-indigo-500 leading-none">{level}</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">情绪</div>
                </div>
            </div>

            {/* 内心独白 */}
            {entry.innerVoice && (
                <div className="px-6 pb-4">
                    <div className="text-[9px] tracking-[0.18em] text-slate-400 uppercase mb-1.5">内心独白</div>
                    <div className="relative px-4 py-3 rounded-2xl bg-indigo-50/70 border-l-[3px] border-indigo-300 text-[14px] leading-[1.75] text-slate-700">
                        {entry.innerVoice}
                    </div>
                </div>
            )}

            {/* 细微观察 */}
            {entry.statusText && (
                <div className="px-6 pb-4">
                    <div className="text-[9px] tracking-[0.18em] text-slate-400 uppercase mb-1.5">此刻</div>
                    <div className="px-4 py-2.5 rounded-2xl bg-slate-50 text-[13px] leading-relaxed text-slate-500">
                        {entry.statusText}
                    </div>
                </div>
            )}

            {/* 三项读数 */}
            <div className="px-6 pb-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-slate-50 py-3 text-center">
                    <div className="text-[15px] font-bold text-slate-700">{entry.temperature}</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">体温</div>
                </div>
                <div className="rounded-2xl bg-slate-50 py-3 px-3">
                    <div className="text-[15px] font-bold text-slate-700 text-center">{level}</div>
                    <div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-400 transition-[width] duration-500" style={{ width: `${level}%` }} />
                    </div>
                    <div className="text-[9px] text-slate-400 mt-1 text-center">情绪</div>
                </div>
                <div className="rounded-2xl bg-slate-50 py-3 text-center">
                    <div className={`text-[15px] font-bold ${moodDeltaColor(entry.moodDelta)}`}>{entry.moodDelta ?? '—'}</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">本轮波动</div>
                </div>
            </div>

            {/* 位置 / 活动 / 天气：有才显示 */}
            {(entry.location || entry.activity || entry.weather) && (
                <div className="px-6 pb-4 flex flex-wrap gap-1.5">
                    {entry.location && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-[11px] text-slate-500">📍 {entry.location}</span>}
                    {entry.activity && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-[11px] text-slate-500">{entry.activity}</span>}
                    {entry.weather && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-[11px] text-slate-500">{entry.weather}</span>}
                </div>
            )}

            {/* 自定义字段：自定义提示词多吐的字段都摊在这里 */}
            {extras.length > 0 && (
                <div className="px-6 pb-5">
                    <div className="text-[9px] tracking-[0.18em] text-slate-400 uppercase mb-1.5">自定义字段</div>
                    <div className="rounded-2xl bg-slate-50 divide-y divide-slate-100">
                        {extras.map(([k, v]) => (
                            <div key={k} className="flex items-start gap-3 px-3.5 py-2">
                                <span className="text-[11px] font-mono text-slate-400 shrink-0 pt-0.5">{k}</span>
                                <span className="text-[12px] text-slate-600 leading-relaxed break-all flex-1 text-right">
                                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default XinshengCard;
