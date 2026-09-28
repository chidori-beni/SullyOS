/** 书房各页面共用的小组件与类型。 */
import React from 'react';
import { Star } from '@phosphor-icons/react';
import TokenImg from '../../components/os/TokenImg';
import type { BookroomRecord } from '../../utils/bookroom/bookroom';
import type { CharacterProfile, VRWorldNovel } from '../../types';

/** 书架上的一本：在架（有正文）或已归档（只有记录）。 */
export interface ShelfBook {
    novelId: string;
    title: string;
    author?: string;
    segCount: number;
    totalChars: number;
    novel?: VRWorldNovel;
    record: BookroomRecord;
}

export const charRatio = (c: CharacterProfile, book: ShelfBook) => {
    const bm = c.vrState?.novelBookmarks?.[book.novelId];
    return bm == null || bm <= 0 ? null : Math.min(1, bm / Math.max(1, book.segCount));
};

export const Avatar: React.FC<{ char: CharacterProfile; size?: number }> = ({ char, size = 26 }) => (
    <span className="bk-avatar" style={{ width: size, height: size }}>
        {char.avatar ? <TokenImg value={char.avatar} alt={char.name} /> : <span>{char.name.slice(0, 1)}</span>}
    </span>
);

/** 书脊 / 封面：有封面图就显示图，没有就是带首字的书脊。 */
export const Cover: React.FC<{ title: string; cover?: string; archived?: boolean; large?: boolean }> = ({ title, cover, archived, large }) => (
    <span className={`bk-spine ${cover ? 'has-cover' : ''} ${archived ? 'is-archived' : ''} ${large ? 'bk-spine-lg' : ''}`} aria-hidden>
        {cover ? <img src={cover} alt="" /> : title.slice(0, 1)}
    </span>
);

export const Bar: React.FC<{ ratio: number; tone?: 'me' | 'char' }> = ({ ratio, tone = 'me' }) => (
    <span className={`bk-bar bk-bar-${tone}`}><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
);

export const Stars: React.FC<{ n?: number; size?: number }> = ({ n, size = 12 }) => n ? (
    <span className="bk-stars" aria-label={`${n} 星`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} weight={i <= n ? 'fill' : 'regular'} />)}</span>
) : null;

/** 日期 + 时间：今年的写「9/27 21:05」，往年的带上年份。 */
export function formatStamp(at: number): { date: string; time: string; full: string } {
    const d = new Date(at);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = d.getFullYear() === new Date().getFullYear()
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return { date, time, full: `${date} ${time}` };
}

/** 页面里的小标签（子分类）。 */
export function SubTabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (id: T) => void; className?: string }) {
    return (
        <nav className={`bk-subtabs ${className}`} role="tablist">
            {tabs.map(t => (
                <button key={t.id} role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>
                    {t.label}{t.badge ? <small>{t.badge}</small> : null}
                </button>
            ))}
        </nav>
    );
}
