import React, { useEffect, useMemo, useState } from 'react';
import {
    getAppearanceTagLibrary,
    getCharacterAppearanceLooks,
    normalizeAppearanceTags,
    withCharacterAppearanceLooks,
    type CharacterAppearanceLook,
    type ImageGenConfig,
} from '../../utils/novelaiImage';

const inputClass = 'w-full px-3 py-2 rounded-xl border border-violet-100 text-sm outline-none focus:border-violet-400 bg-white';

interface Props {
    charId: string;
    charName?: string;
    cfg: ImageGenConfig;
    onChange: (patch: Partial<ImageGenConfig>) => void;
    defaultOpen?: boolean;
    addToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const newLook = (index: number, source?: CharacterAppearanceLook): CharacterAppearanceLook => ({
    id: `look_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: source ? `${source.name} 副本` : `造型 ${index + 1}`,
    prompt: source?.prompt || '',
    tags: source ? [...source.tags] : [],
});

/**
 * 神经链接与生图设置共用的折叠式衣橱。一页只编辑一套，避免角色造型多以后无限拉长页面。
 */
export const CharacterLookWardrobe: React.FC<Props> = ({
    charId,
    charName,
    cfg,
    onChange,
    defaultOpen = false,
    addToast,
}) => {
    const looks = useMemo(() => getCharacterAppearanceLooks(cfg, charId), [cfg, charId]);
    const tagLibrary = useMemo(() => getAppearanceTagLibrary(cfg), [cfg]);
    const [activeId, setActiveId] = useState<string>('');
    const [tagDraft, setTagDraft] = useState('');
    const [expanded, setExpanded] = useState(defaultOpen);

    useEffect(() => {
        if (!looks.length) {
            setActiveId('');
            return;
        }
        if (!looks.some(look => look.id === activeId)) setActiveId(looks[0].id);
    }, [looks, activeId]);

    const activeIndex = Math.max(0, looks.findIndex(look => look.id === activeId));
    const active = looks[activeIndex];

    const commit = (nextLooks: CharacterAppearanceLook[]) => onChange(withCharacterAppearanceLooks(cfg, charId, nextLooks));
    const patchActive = (patch: Partial<CharacterAppearanceLook>) => {
        if (!active) return;
        commit(looks.map(look => look.id === active.id ? { ...look, ...patch } : look));
    };
    const addLook = (source?: CharacterAppearanceLook) => {
        const item = newLook(looks.length, source);
        commit([...looks, item]);
        setActiveId(item.id);
        setTagDraft('');
    };
    const deleteActive = () => {
        if (!active) return;
        if (looks.length > 1 && !window.confirm(`删除「${active.name}」？`)) return;
        const next = looks.filter(look => look.id !== active.id);
        commit(next);
        setActiveId(next[Math.min(activeIndex, Math.max(0, next.length - 1))]?.id || '');
    };
    const addTags = (raw: string) => {
        if (!active) return;
        const incoming = normalizeAppearanceTags(raw.split(/[，,、;；\n]+/g));
        if (!incoming.length) return;
        patchActive({ tags: normalizeAppearanceTags([...active.tags, ...incoming]) });
        onChange({ appearanceTagLibrary: normalizeAppearanceTags([...tagLibrary, ...incoming]) });
        setTagDraft('');
    };

    return (
        <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="group rounded-3xl border border-violet-100 bg-violet-50/55 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                    <span className="block text-xs font-bold text-violet-700">生图衣橱</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">
                        {charName ? `${charName} · ` : ''}{looks.length ? `${looks.length} 套造型` : '还没有造型'} · 点开分页编辑
                    </span>
                </span>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-violet-500 shadow-sm group-open:hidden">展开</span>
                <span className="hidden shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-violet-500 shadow-sm group-open:inline">收起</span>
            </summary>

            <div className="space-y-3 border-t border-violet-100 px-3 pb-3 pt-3">
                <p className="text-[10px] leading-relaxed text-slate-500">
                    每套保存完整外观提示词和多个标签。自拍生图前，文字 API 只看到标签、时间与场景，选好后完整提示词才在本机拼给 NovelAI。
                </p>

                {!looks.length ? (
                    <button type="button" onClick={() => addLook()}
                        className="w-full rounded-2xl border border-dashed border-violet-300 bg-white py-3 text-xs font-bold text-violet-600 active:scale-[0.98]">
                        ＋ 添加第一套造型
                    </button>
                ) : (
                    <>
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {looks.map((look, index) => (
                                <button key={look.id} type="button" onClick={() => { setActiveId(look.id); setTagDraft(''); }}
                                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold ${look.id === active?.id ? 'border-violet-300 bg-violet-500 text-white' : 'border-violet-100 bg-white text-slate-500'}`}>
                                    {index + 1}. {look.name}
                                </button>
                            ))}
                            <button type="button" onClick={() => addLook()}
                                className="shrink-0 rounded-full border border-dashed border-violet-300 bg-white px-3 py-1.5 text-[10px] font-bold text-violet-500">＋ 新造型</button>
                        </div>

                        {active && (
                            <div className="space-y-3 rounded-2xl border border-violet-100 bg-white/75 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold text-violet-500">第 {activeIndex + 1} / {looks.length} 套</span>
                                    <div className="flex gap-1.5">
                                        <button type="button" onClick={() => addLook(active)} className="rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-600">复制</button>
                                        <button type="button" onClick={deleteActive} className="rounded-lg bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-500">删除</button>
                                    </div>
                                </div>

                                <div>
                                    <label className="mb-1 block pl-1 text-[10px] font-bold tracking-widest text-slate-400">造型名称（仅本机显示）</label>
                                    <input className={inputClass} value={active.name} maxLength={40}
                                        onChange={event => patchActive({ name: event.target.value })} placeholder="例如：黑色风衣" />
                                </div>

                                <div>
                                    <label className="mb-1 block pl-1 text-[10px] font-bold tracking-widest text-slate-400">完整外观提示词</label>
                                    <textarea className={`${inputClass} min-h-[6.5rem] resize-y font-mono text-[11px]`}
                                        value={active.prompt}
                                        onChange={event => patchActive({ prompt: event.target.value })}
                                        placeholder="1boy, silver hair, red eyes, black coat, swept-back hair ..." />
                                    <p className="mt-1 pl-1 text-[10px] leading-relaxed text-slate-400">写长相、发型、服装和固定配饰；动作、场景、表情仍由这次自拍描述补充。</p>
                                </div>

                                <div>
                                    <label className="mb-1 block pl-1 text-[10px] font-bold tracking-widest text-slate-400">这套造型的标签</label>
                                    <div className="flex min-h-8 flex-wrap gap-1.5">
                                        {active.tags.length ? active.tags.map(tag => (
                                            <button key={tag} type="button" title="点一下移除"
                                                onClick={() => patchActive({ tags: active.tags.filter(item => item !== tag) })}
                                                className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold text-violet-700">#{tag} ×</button>
                                        )) : <span className="py-1 text-[10px] text-slate-300">还没有标签</span>}
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        <input className={inputClass} value={tagDraft} maxLength={120}
                                            onChange={event => setTagDraft(event.target.value)}
                                            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTags(tagDraft); } }}
                                            placeholder="日常，外出，约会…" />
                                        <button type="button" onClick={() => addTags(tagDraft)} className="shrink-0 rounded-xl bg-violet-500 px-3 text-xs font-bold text-white">添加</button>
                                    </div>
                                </div>

                                {tagLibrary.some(tag => !active.tags.includes(tag)) && (
                                    <div>
                                        <div className="mb-1.5 text-[10px] font-bold text-slate-400">输入过的标签 · 点选复用</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {tagLibrary.filter(tag => !active.tags.includes(tag)).map(tag => (
                                                <button key={tag} type="button" onClick={() => addTags(tag)}
                                                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-500">＋ {tag}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                <button type="button" onClick={() => addToast?.('生图衣橱会随“角色生图”配置保存在这台设备上', 'info')}
                    className="w-full text-center text-[9px] leading-relaxed text-slate-400">
                    标签可跨角色复用；完整提示词不会发给文字 API
                </button>
            </div>
        </details>
    );
};

export default CharacterLookWardrobe;
