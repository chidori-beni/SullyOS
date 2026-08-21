/**
 * ImageGenSettings.tsx —— 角色生图（NovelAI）的设置面板。
 *
 * 单独成文件而不是塞进 apps/Settings.tsx：那份已经 4000+ 行，
 * 每加一块功能都往里堆，改一处要重贴整份，代价越来越高。
 *
 * 配置存 localStorage（见 utils/novelaiImage.ts），面板只管收集和自检。
 * 「测试生图」会真的画一张——这是唯一能证明「地址 + Token + 模型 + 参数」四样都对的办法，
 * 花几个 Anlas 换一个确定答案，比在聊天里反复试便宜得多。
 */

import React, { useState } from 'react';
import {
    getImageGenConfig,
    setImageGenConfig,
    isImageGenReady,
    pingRelay,
    generateImageDataUrl,
    type ImageGenConfig,
} from '../../utils/novelaiImage';

const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-400 bg-white';
const label = 'text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1';

interface Props {
    addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const ImageGenSettings: React.FC<Props> = ({ addToast }) => {
    const [cfg, setCfg] = useState<ImageGenConfig>(() => getImageGenConfig());
    const [busy, setBusy] = useState<'' | 'ping' | 'draw'>('');
    const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
    const [preview, setPreview] = useState<string>('');

    const patch = (next: Partial<ImageGenConfig>) => setCfg(prev => ({ ...prev, ...next }));
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
            const url = await generateImageDataUrl(
                '1girl, silver hair, red eyes, upper body, looking at viewer',
                { ...merged, enabled: true },
            );
            setPreview(url);
            setResult({ ok: true, msg: '成功！这条路整条都是通的。' });
        } catch (e: any) {
            // NovelAI 的原话原样显示——改写成「生成失败」等于把唯一的线索扔了。
            setResult({ ok: false, msg: e?.message || String(e) });
        }
        setBusy('');
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-700">让角色自己发图</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                        角色想给你看什么的时候，用 NovelAI 现画一张
                    </div>
                </div>
                <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={e => patch({ enabled: e.target.checked })}
                    className="w-11 h-6 shrink-0 accent-violet-500 cursor-pointer"
                />
            </div>

            <p className="text-xs leading-relaxed text-slate-500">
                需要你自己部署一个生图中转站（NovelAI 不允许网页直连）。关闭时角色不会发图，
                也不会消耗任何额度。
            </p>

            <div>
                <label className={label}>中转站地址</label>
                <input className={field} value={cfg.relayUrl} autoComplete="off"
                    placeholder="https://xxx.你的名字.workers.dev"
                    onChange={e => patch({ relayUrl: e.target.value })} />
            </div>

            <div>
                <label className={label}>NovelAI 持久 Token</label>
                <input className={field} type="password" value={cfg.token} autoComplete="off"
                    placeholder="pst-..."
                    onChange={e => patch({ token: e.target.value })} />
                <p className="text-[10px] text-slate-400 mt-1 pl-1">
                    NovelAI 网站 → Account → Get Persistent API Token。只存在这台设备上。
                </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                    <label className={label}>模型</label>
                    <input className={field} value={cfg.model} autoComplete="off"
                        onChange={e => patch({ model: e.target.value })} />
                </div>
                <div>
                    <label className={label}>宽</label>
                    <input className={field} type="number" value={cfg.width}
                        onChange={e => patch({ width: parseInt(e.target.value, 10) || 832 })} />
                </div>
                <div>
                    <label className={label}>高</label>
                    <input className={field} type="number" value={cfg.height}
                        onChange={e => patch({ height: parseInt(e.target.value, 10) || 1216 })} />
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
            </div>

            <div>
                <label className={label}>画质词（每张自动追加）</label>
                <input className={field} value={cfg.qualityTags} autoComplete="off"
                    onChange={e => patch({ qualityTags: e.target.value })} />
            </div>

            <div>
                <label className={label}>负面提示词</label>
                <textarea className={`${field} min-h-[3.5rem] resize-y`} value={cfg.negativePrompt}
                    onChange={e => patch({ negativePrompt: e.target.value })} />
            </div>

            <details className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                <summary className="text-[11px] font-bold text-slate-500 cursor-pointer">
                    高级 · 覆盖生成参数
                </summary>
                <p className="text-[10px] text-slate-400 mt-2 mb-1.5 leading-relaxed">
                    一段 JSON，会合并进 parameters 覆盖默认值。留空即不覆盖；写错了只会被忽略，不影响生图。
                </p>
                <textarea
                    className={`${field} min-h-[5rem] font-mono text-[11px] resize-y`}
                    placeholder='{"sampler": "k_dpmpp_2m"}'
                    value={cfg.extraParams}
                    onChange={e => patch({ extraParams: e.target.value })}
                />
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
                    result.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}>
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
