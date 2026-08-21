/**
 * ImageGenSettings.tsx —— 角色生图（NovelAI）的设置面板。
 *
 * 单独成文件而不是塞进 apps/Settings.tsx：那份已经 4000+ 行、上游一个月改 120 次，
 * 每加一块功能都往里堆，以后合并上游会很疼。
 *
 * 配置存 localStorage（见 utils/novelaiImage.ts），面板只管收集和自检。
 * 「测试生图」会真的画一张——这是唯一能同时证明「地址 + Token + 模型 + 参数」都对的办法。
 */

import React, { useState } from 'react';
import {
    getImageGenConfig,
    setImageGenConfig,
    isImageGenReady,
    pingRelay,
    generateImageDataUrl,
    calcSkipCfgAboveSigma,
    parseSize,
    SIZE_PRESETS,
    MODEL_PRESETS,
    SAMPLER_PRESETS,
    NOISE_SCHEDULES,
    PRESET_FIELDS,
    type ImageGenConfig,
    type ImageGenPreset,
} from '../../utils/novelaiImage';
import type { CharacterProfile } from '../../types';

const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-400 bg-white';
const label = 'text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1';
const hint = 'text-[10px] text-slate-400 mt-1 pl-1 leading-relaxed';

interface Props {
    addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    characters: CharacterProfile[];
}

export const ImageGenSettings: React.FC<Props> = ({ addToast, characters }) => {
    const [cfg, setCfg] = useState<ImageGenConfig>(() => getImageGenConfig());
    const [busy, setBusy] = useState<'' | 'ping' | 'draw'>('');
    const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [preview, setPreview] = useState('');
    const [presetName, setPresetName] = useState('');
    const [charId, setCharId] = useState(() => characters[0]?.id || '');

    // 改动任何一个「属于预设」的字段，就把当前预设标记清掉——
    // 否则界面会一直高亮着某套预设，而实际参数早已不是那一套了。
    const patch = (next: Partial<ImageGenConfig>) => setCfg(prev => {
        const touchedPresetField = PRESET_FIELDS.some(k => k in next);
        return { ...prev, ...next, ...(touchedPresetField ? { activePresetId: '' } : {}) };
    });
    const save = (next: Partial<ImageGenConfig> = {}) => {
        const merged = setImageGenConfig({ ...cfg, ...next });
        setCfg(merged);
        return merged;
    };

    const handleSave = () => {
        if (cfg.enabled && !isImageGenReady({ ...cfg, enabled: true })) {
            addToast('开启前请先填好中转站地址、Token 和模型', 'error');
            return;
        }
        save();
        addToast(cfg.enabled ? '生图已开启' : '生图已保存（当前关闭）', 'success');
    };

    const handlePing = async () => {
        setBusy('ping'); setResult(null); setPreview('');
        const r = await pingRelay(cfg.relayUrl);
        setResult({ ok: r.ok, msg: r.message });
        setBusy('');
    };

    const handleDraw = async () => {
        const merged = save();
        if (!isImageGenReady({ ...merged, enabled: true })) {
            addToast('先把中转站地址、Token、模型填齐', 'error');
            return;
        }
        setBusy('draw'); setResult(null); setPreview('');
        try {
            const look = (merged.characterAppearance[charId] || '').trim();
            // 有外观提示词就拿它试——顺便验证「画他自己像不像」，比画个陌生人有用。
            const prompt = look || '1girl, silver hair, red eyes, upper body, looking at viewer';
            const url = await generateImageDataUrl(prompt, { ...merged, enabled: true });
            setPreview(url);
            setResult({ ok: true, msg: look ? '成功！这就是他现在会被画成的样子。' : '成功！这条路整条都是通的。' });
        } catch (e: any) {
            // NovelAI 的原话原样显示——改写成「生成失败」等于把唯一的线索扔了。
            setResult({ ok: false, msg: e?.message || String(e) });
        }
        setBusy('');
    };

    // ── 预设 ──
    const applyPreset = (id: string) => {
        const p = cfg.presets.find(x => x.id === id);
        if (!p) return;
        const next: any = { activePresetId: p.id };
        PRESET_FIELDS.forEach(k => { next[k] = (p as any)[k]; });
        save(next);
        // 报一下画质词，让人一眼看出「确实换过来了」——这是最能说明差别的一栏。
        const tail = p.qualityTags.trim();
        addToast(`已套用「${p.name}」${tail ? '：' + tail.slice(0, 24) + (tail.length > 24 ? '…' : '') : '（画质词为空）'}`, 'success');
    };
    const savePreset = () => {
        const name = presetName.trim();
        if (!name) { addToast('先给这套预设起个名字', 'error'); return; }
        const item: ImageGenPreset = { id: `p_${Date.now()}`, name } as ImageGenPreset;
        PRESET_FIELDS.forEach(k => { (item as any)[k] = (cfg as any)[k]; });
        // 同名就覆盖，省得存出一堆「新预设 1/2/3」
        const rest = cfg.presets.filter(p => p.name !== name);
        save({ presets: [...rest, item], activePresetId: item.id });
        setPresetName('');
        addToast(`预设「${name}」已保存`, 'success');
    };
    const deletePreset = (id: string) => save({ presets: cfg.presets.filter(p => p.id !== id) });

    const { width, height } = parseSize(cfg.size);
    const sigma = calcSkipCfgAboveSigma(width, height, cfg.model);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-700">让角色自己发图</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">想给你看什么的时候，用 NovelAI 现画一张</div>
                </div>
                <input type="checkbox" checked={cfg.enabled}
                    onChange={e => patch({ enabled: e.target.checked })}
                    className="w-11 h-6 shrink-0 accent-violet-500 cursor-pointer" />
            </div>

            {/* ── 连接 ── */}
            <div>
                <label className={label}>中转站地址</label>
                <input className={field} value={cfg.relayUrl} autoComplete="off"
                    placeholder="https://xxx.你的名字.workers.dev"
                    onChange={e => patch({ relayUrl: e.target.value })} />
            </div>
            <div>
                <label className={label}>NovelAI 持久 Token</label>
                <input className={field} type="password" value={cfg.token} autoComplete="off"
                    placeholder="pst-..." onChange={e => patch({ token: e.target.value })} />
                <p className={hint}>NovelAI 网站 → Account → Get Persistent API Token。只存在这台设备上。</p>
            </div>

            {/* ── 角色外观 ── */}
            <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-3 space-y-2">
                <div className="text-[11px] font-bold text-violet-700">这个角色长什么样</div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                    他用 <code className="font-mono">[[SEND_SELFIE]]</code> 画自己时，这段会自动拼在最前面。
                    <b>让主模型每次自己回忆长相，画出来一定飘</b>——固定写死在这里最稳。
                </p>
                <select className={field} value={charId} onChange={e => setCharId(e.target.value)}>
                    {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <textarea
                    className={`${field} min-h-[4.5rem] resize-y font-mono text-[11px]`}
                    placeholder="1boy, silver hair, red eyes, mole under eye, skull necklace, black jacket"
                    value={cfg.characterAppearance[charId] || ''}
                    onChange={e => patch({
                        characterAppearance: { ...cfg.characterAppearance, [charId]: e.target.value },
                    })}
                />
                <p className="text-[10px] text-slate-400 leading-relaxed">
                    只写<b>长相和标志性穿着</b>（发色瞳色发型痣配饰）。动作、场景、表情让他自己写。
                </p>
            </div>

            {/* ── 画风预设 ── */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
                <div className="text-[11px] font-bold text-slate-600">画风预设</div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                    把下面整套参数（画质词、负面词、尺寸、步数、Scale、采样器、Variety+）存成一套，随时切换。
                </p>
                {cfg.presets.length > 0 && (
                    <div className="space-y-1.5">
                        {cfg.presets.map(p => (
                            <div key={p.id} className="flex items-center gap-2">
                                <button type="button" onClick={() => applyPreset(p.id)}
                                    className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold text-left active:scale-95 transition-transform border ${
                                        cfg.activePresetId === p.id
                                            ? 'bg-violet-100 border-violet-300 text-violet-700'
                                            : 'bg-white border-slate-200 text-slate-600'
                                    }`}>
                                    {cfg.activePresetId === p.id ? '● ' : ''}{p.name}
                                    <span className="ml-2 text-[10px] font-normal text-slate-400">{p.size} · {p.steps}步</span>
                                    {p.qualityTags.trim() && (
                                        <span className="block mt-0.5 text-[10px] font-normal text-slate-400 font-mono truncate">
                                            {p.qualityTags.trim()}
                                        </span>
                                    )}
                                </button>
                                <button type="button" onClick={() => deletePreset(p.id)}
                                    className="px-2.5 py-2 rounded-xl text-[10px] font-bold text-rose-400 bg-white border border-slate-200">删</button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <input className={field} value={presetName} placeholder="给当前这套起个名字"
                        onChange={e => setPresetName(e.target.value)} />
                    <button type="button" onClick={savePreset}
                        className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-slate-200 text-slate-600 active:scale-95 transition-transform">存为预设</button>
                </div>
            </div>

            {/* ── 生成参数 ── */}
            <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                    <label className={label}>模型</label>
                    <select className={field} value={cfg.model} onChange={e => patch({ model: e.target.value })}>
                        {MODEL_PRESETS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div>
                    <label className={label}>尺寸</label>
                    <select className={field} value={cfg.size} onChange={e => patch({ size: e.target.value })}>
                        {SIZE_PRESETS.map(sz => <option key={sz} value={sz}>{sz}</option>)}
                    </select>
                </div>
                <div>
                    <label className={label}>采样器</label>
                    <select className={field} value={cfg.sampler} onChange={e => patch({ sampler: e.target.value })}>
                        {SAMPLER_PRESETS.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                </div>
                <div>
                    <label className={label}>步数</label>
                    <input className={field} type="number" value={cfg.steps}
                        onChange={e => patch({ steps: parseInt(e.target.value, 10) || 28 })} />
                </div>
                <div>
                    <label className={label}>Scale</label>
                    <input className={field} type="number" step="0.5" value={cfg.scale}
                        onChange={e => patch({ scale: parseFloat(e.target.value) || 5 })} />
                </div>
                <div>
                    <label className={label}>噪声调度</label>
                    <select className={field} value={cfg.noiseSchedule} onChange={e => patch({ noiseSchedule: e.target.value })}>
                        {NOISE_SCHEDULES.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                </div>
                <div>
                    <label className={label}>种子（0=每次随机）</label>
                    <input className={field} type="number" value={cfg.seed}
                        onChange={e => patch({ seed: parseInt(e.target.value, 10) || 0 })} />
                </div>
            </div>

            <label className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={cfg.varietyPlus}
                    onChange={e => patch({ varietyPlus: e.target.checked })}
                    className="w-4 h-4 accent-violet-500" />
                <span className="min-w-0">
                    <span className="text-xs font-bold text-slate-600">Variety+</span>
                    <span className="block text-[10px] text-slate-400 leading-relaxed">
                        构图更多样，对应官网那个开关。当前尺寸下会把 skip_cfg_above_sigma 设成 {sigma.toFixed(1)}
                    </span>
                </span>
            </label>

            <label className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={cfg.officialQualityTags}
                    onChange={e => patch({ officialQualityTags: e.target.checked })}
                    className="w-4 h-4 accent-violet-500" />
                <span className="min-w-0">
                    <span className="text-xs font-bold text-slate-600">NovelAI 官方画质词</span>
                    <span className="block text-[10px] text-slate-400 leading-relaxed">
                        官网的 Quality Tags 开关。开着时 NovelAI 自己会追加官方那串，你下面就<b>不用再写一遍</b>
                    </span>
                </span>
            </label>

            <div>
                <label className={label}>
                    画质词 / 画师串（每张追加）
                    {cfg.activePresetId
                        ? <span className="ml-2 normal-case tracking-normal text-violet-500">
                            来自预设「{cfg.presets.find(p => p.id === cfg.activePresetId)?.name}」
                          </span>
                        : cfg.presets.length > 0
                            ? <span className="ml-2 normal-case tracking-normal text-slate-400">手动改动中</span>
                            : null}
                </label>
                <textarea className={`${field} min-h-[4rem] resize-y font-mono text-[11px]`}
                    value={cfg.qualityTags}
                    placeholder="artist:xxx, artist:yyy, best quality …（论坛上抄来的画师串就贴这里）"
                    onChange={e => patch({ qualityTags: e.target.value })} />
                <p className={hint}>
                    换预设时这一栏会跟着变，看它就知道换没换成功。
                </p>
            </div>

            <div>
                <label className={label}>负面提示词</label>
                <textarea className={`${field} min-h-[3.5rem] resize-y`} value={cfg.negativePrompt}
                    onChange={e => patch({ negativePrompt: e.target.value })} />
            </div>

            {/* ── 存储 ── */}
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className={label}>存进 App 时缩到</label>
                    <select className={field} value={String(cfg.storeMaxWidth)}
                        onChange={e => patch({ storeMaxWidth: parseInt(e.target.value, 10) })}>
                        <option value="0">原尺寸（不缩）</option>
                        <option value="1024">1024 宽</option>
                        <option value="832">832 宽</option>
                        <option value="640">640 宽</option>
                    </select>
                </div>
                <div>
                    <label className={label}>存图质量</label>
                    <input className={field} type="number" step="0.05" min="0.3" max="1" value={cfg.storeQuality}
                        onChange={e => patch({ storeQuality: parseFloat(e.target.value) || 0.9 })} />
                </div>
            </div>
            <p className={hint}>
                原尺寸最清楚但最占地方。<b>之前这里写死 832，所以你画 1024 存下来变成了 832</b>——现在默认不缩了。
            </p>

            <details className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                <summary className="text-[11px] font-bold text-slate-500 cursor-pointer">高级 · 覆盖生成参数</summary>
                <p className="text-[10px] text-slate-400 mt-2 mb-1.5 leading-relaxed">
                    上面每一项最后都会变成一段发给 NovelAI 的 JSON。这里填的会<b>盖掉</b>算出来的值——
                    只在你想用界面上没有的参数时才需要（比如某个新采样器）。写错了会被忽略，不影响生图。
                </p>
                <textarea className={`${field} min-h-[5rem] font-mono text-[11px] resize-y`}
                    placeholder='{"cfg_rescale": 0.2}'
                    value={cfg.extraParams} onChange={e => patch({ extraParams: e.target.value })} />
            </details>

            <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={handlePing} disabled={!!busy}
                    className="py-2.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 active:scale-95 transition-transform disabled:opacity-50">
                    {busy === 'ping' ? '测试中…' : '测中转站'}
                </button>
                <button type="button" onClick={handleDraw} disabled={!!busy}
                    className="py-2.5 rounded-xl text-xs font-bold bg-violet-100 text-violet-600 active:scale-95 transition-transform disabled:opacity-50">
                    {busy === 'draw' ? '画着呢…' : '测试生图'}
                </button>
                <button type="button" onClick={handleSave} disabled={!!busy}
                    className="py-2.5 rounded-xl text-xs font-bold bg-violet-500 text-white active:scale-95 transition-transform disabled:opacity-50">
                    保存
                </button>
            </div>
            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                「测中转站」不花额度；「测试生图」会真画一张，花几个 Anlas。
            </p>

            {result && (
                <div className={`rounded-xl px-3 py-2.5 text-[11px] leading-relaxed border ${
                    result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                    <div className="font-bold mb-0.5">{result.ok ? '✓ 通了' : '✗ 没成'}</div>
                    <div className="whitespace-pre-wrap break-words font-mono text-[10px]">{result.msg}</div>
                </div>
            )}

            {preview && (
                <img src={preview} alt="测试生成的图"
                    className="w-full max-w-[240px] mx-auto rounded-xl border border-slate-200" />
            )}
        </div>
    );
};

export default ImageGenSettings;
