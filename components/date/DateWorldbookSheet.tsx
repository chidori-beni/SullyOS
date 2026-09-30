import React, { useMemo, useState } from 'react';
import { BookOpen, CaretRight } from '@phosphor-icons/react';
import type { MountedWorldbook } from '../../types';
import { getEffectiveWorldbookMode, isMountedWorldbookEnabled, WORLDBOOK_MODE_LABELS } from '../../utils/worldbook';

/**
 * 见面中快捷开关「这个角色挂的世界书」。
 *
 * 和神经链接里那颗开关是同一个字段（MountedWorldbook.mountEnabled）：关掉 = 仍保留挂载，
 * 只是不注入任何 AI 上下文；只改当前角色，不动公共世界书库。下一条回复开始生效。
 * 挂载 / 解除挂载 / 编辑正文仍去神经链接，这里不做。
 */
interface Props {
    charName: string;
    books: MountedWorldbook[];
    onToggle: (bookId: string) => void;
    onClose: () => void;
}

const UNCATEGORIZED = '未分类';

const DateWorldbookSheet: React.FC<Props> = ({ charName, books, onToggle, onClose }) => {
    const groups = useMemo(() => {
        const map = new Map<string, MountedWorldbook[]>();
        for (const book of books) {
            const key = book.category?.trim() || UNCATEGORIZED;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(book);
        }
        return [...map.entries()];
    }, [books]);
    // 分组少时默认全展开；多了就先收起，免得一屏滑不到头。
    const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(groups.length <= 3 ? groups.map(([key]) => key) : []));
    const enabledCount = books.filter(isMountedWorldbookEnabled).length;

    const toggleGroup = (key: string) => setOpenGroups(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    return (
        <div className="absolute inset-0 z-[250] flex items-end bg-black/60 backdrop-blur-sm animate-fade-in" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <div
                className="w-full rounded-t-3xl border-t border-white/10 bg-[#120c22] p-5 space-y-3 animate-slide-up"
                style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm font-medium text-white/85">{charName}的世界书</div>
                    {books.length > 0 && <div className="shrink-0 text-[11px] text-white/40">开着 {enabledCount} / {books.length}</div>}
                </div>
                <p className="text-xs leading-relaxed text-white/40">
                    和神经链接里的开关是同一个：关掉只是暂停，不会解除挂载；下一条回复开始生效。
                </p>
                {books.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 px-4 py-5 text-center text-xs leading-relaxed text-white/45">
                        {charName}还没有挂世界书。<br />离开见面后去「神经链接 → 扩展设定」挂一本，这里就会出现。
                    </div>
                ) : (
                    <div className="max-h-[55vh] space-y-2 overflow-y-auto overscroll-contain pt-1">
                        {groups.map(([key, groupBooks]) => {
                            const open = openGroups.has(key);
                            const groupOn = groupBooks.filter(isMountedWorldbookEnabled).length;
                            return (
                                <div key={key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                                    <button type="button" onClick={() => toggleGroup(key)} aria-expanded={open}
                                        className="flex w-full items-center gap-2 px-4 py-3 text-left active:bg-white/5">
                                        <CaretRight size={12} weight="bold" className={`shrink-0 text-white/40 transition-transform ${open ? 'rotate-90' : ''}`} />
                                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-white/75">{key}</span>
                                        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/55">{groupOn}/{groupBooks.length}</span>
                                    </button>
                                    {open && (
                                        <div className="space-y-1 border-t border-white/5 p-1.5">
                                            {groupBooks.map(book => {
                                                const on = isMountedWorldbookEnabled(book);
                                                const mode = getEffectiveWorldbookMode(book);
                                                // 仅线上 / 仅日程的书在见面里本来就不注入，开关它不会影响这次见面。
                                                const inactiveHere = mode === 'online' || mode === 'schedule';
                                                return (
                                                    <div key={book.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                                                        <BookOpen size={16} className={`shrink-0 ${on ? 'text-indigo-300' : 'text-white/25'}`} />
                                                        <div className="min-w-0 flex-1">
                                                            <div className={`truncate text-[13px] font-medium ${on ? 'text-white/85' : 'text-white/40'}`}>{book.title || '未命名'}</div>
                                                            {inactiveHere && <div className="mt-0.5 truncate text-[10px] text-amber-300/70">{WORLDBOOK_MODE_LABELS[mode]} · 见面里本来就不生效</div>}
                                                        </div>
                                                        <button type="button" onClick={() => onToggle(book.id)}
                                                            aria-label={`${on ? '暂时关闭' : '重新启用'}世界书：${book.title}`}
                                                            aria-pressed={on}
                                                            className={`relative h-6 w-11 shrink-0 rounded-full p-1 transition-colors active:scale-95 ${on ? 'bg-emerald-500' : 'bg-white/15'}`}>
                                                            <span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DateWorldbookSheet;
