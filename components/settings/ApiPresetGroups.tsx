import React, { useState } from 'react';
import type { ApiPreset } from '../../types';

const UNGROUPED = '未分组';
// 只记用户亲手点过的组；没点过的组按「含当前预设就展开，否则收起」。
const COLLAPSE_KEY = 'sully-api-preset-group-open-v1';

function readOpenState(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Shared preset library: Settings manages entries; character dialogs only load drafts. */
export default function ApiPresetGroups({ presets, activeId, children }: {
  presets: ApiPreset[];
  /** 当前选中的预设：它所在的组默认展开，收起时组标题上也会写出来 */
  activeId?: string | null;
  children: (preset: ApiPreset) => React.ReactNode;
}) {
  const [openState, setOpenState] = useState(readOpenState);
  const groups = new Map<string, ApiPreset[]>();
  for (const preset of presets) {
    const group = preset.group?.trim() || UNGROUPED;
    groups.set(group, [...(groups.get(group) || []), preset]);
  }
  if (!presets.some(p => p.group?.trim())) {
    return <div className="flex flex-wrap gap-2">{presets.map(children)}</div>;
  }
  const isOpen = (name: string, items: ApiPreset[]) =>
    openState[name] ?? items.some(p => p.id === activeId);
  const save = (next: Record<string, boolean>) => {
    setOpenState(next);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* 无痕模式写不进就只在本次生效 */ }
  };
  const entries = [...groups];
  const allOpen = entries.every(([name, items]) => isOpen(name, items));
  const setAll = (open: boolean) => save({ ...openState, ...Object.fromEntries(entries.map(([name]) => [name, open])) });

  return <div className="space-y-1.5">
    <div className="flex justify-end">
      <button type="button" onClick={() => setAll(!allOpen)} className="text-[10px] text-slate-400 px-1 active:scale-95">
        {allOpen ? '全部收起' : '全部展开'}
      </button>
    </div>
    {entries.map(([name, items]) => {
      const open = isOpen(name, items);
      const active = items.find(p => p.id === activeId);
      return <div key={name} className="rounded-xl border border-slate-100 bg-slate-50/60">
        <button type="button" onClick={() => save({ ...openState, [name]: !open })}
          aria-expanded={open}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-left active:opacity-70">
          <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" /></svg>
          <span className="text-xs font-medium text-slate-600 truncate">{name}</span>
          <span className="text-[10px] text-slate-400 shrink-0">· {items.length}</span>
          {!open && active && <span className="ml-auto text-[10px] text-primary truncate">当前：{active.name}</span>}
        </button>
        {open && <div className="flex flex-wrap gap-2 px-3 pb-3">{items.map(children)}</div>}
      </div>;
    })}
  </div>;
}
