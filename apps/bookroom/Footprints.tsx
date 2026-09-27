/** 书房「足迹」：读书打卡与年度书单。 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, CalendarCheck, CaretRight } from '@phosphor-icons/react';
import type { BookroomRecord } from '../../utils/bookroom/bookroom';
import { dateKey, monthGrid, readingDays, streakDays, yearSummary, type BookroomMeta } from '../../utils/bookroom/stats';
import { Avatar, Cover, Stars } from './shared';
import type { CharacterProfile } from '../../types';

// ============ 打卡 ============

export const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export const CheckinCard: React.FC<{ records: BookroomRecord[]; meta: BookroomMeta; onCheckin: () => void; onYear: () => void }> = ({ records, meta, onCheckin, onYear }) => {
    const now = new Date();
    const days = useMemo(() => readingDays(records, meta), [records, meta]);
    const streak = streakDays(days);
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const monthCount = [...days].filter(k => k.startsWith(prefix)).length;
    const today = dateKey(now.getTime());
    const grid = monthGrid(now.getFullYear(), now.getMonth());
    return (
        <section className="bk-card bk-checkin">
            <div className="bk-checkin-head">
                <div>
                    <p className="bk-checkin-num"><b>{streak}</b> 天连续阅读</p>
                    <small>{now.getMonth() + 1} 月读了 {monthCount} 天 · 报进度、写笔记书评都算</small>
                </div>
                <button disabled={days.has(today)} onClick={onCheckin}><CalendarCheck size={16} /> {days.has(today) ? '今天读过了' : '今天读了'}</button>
            </div>
            <div className="bk-cal">
                {WEEK.map(w => <span key={w} className="bk-cal-w">{w}</span>)}
                {grid.map((d, i) => d == null ? <span key={`e${i}`} /> : (
                    <span key={d} className={`${days.has(prefix + String(d).padStart(2, '0')) ? 'is-on' : ''} ${d === now.getDate() ? 'is-today' : ''}`}>{d}</span>
                ))}
            </div>
            <button className="bk-year-link" onClick={onYear}>{now.getFullYear()} 年度书单 <CaretRight size={13} /></button>
        </section>
    );
};

// ============ 年度书单 ============

export const YearView: React.FC<{
    year: number; records: BookroomRecord[]; meta: BookroomMeta; characters: CharacterProfile[];
    onBack: () => void; onYear: (y: number) => void; onOpenBook: (id: string) => void;
    onLetter: (char: CharacterProfile, summaryText: string) => Promise<void>;
}> = ({ year, records, meta, characters, onBack, onYear, onOpenBook, onLetter }) => {
    const sum = useMemo(() => yearSummary(records, meta, year), [records, meta, year]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const years = useMemo(() => {
        const ys = new Set<number>([new Date().getFullYear()]);
        for (const r of records) for (const h of r.history) ys.add(new Date(h.at).getFullYear());
        return [...ys].sort((a, b) => b - a);
    }, [records]);
    const companions = characters
        .map(c => ({ char: c, n: sum.companions[c.id] || 0 }))
        .filter(x => x.n > 0)
        .sort((a, b) => b.n - a.n);
    const letters = meta.yearLetters.filter(l => l.year === year);
    const summaryText = [
        `【书房 · 年度书单】我们 ${year} 年一起读书的总结：`,
        sum.finished.length ? `读完 ${sum.finished.length} 本：${sum.finished.map(f => `《${f.title}》${f.rating ? `（我打了 ${f.rating} 星）` : ''}`).join('、')}` : '今年还没有读完的书',
        `一共读书 ${sum.days} 天，报了 ${sum.reports} 次进度，记了 ${sum.notes} 条笔记。`,
        '给我写几句年度寄语吧。',
    ].join('\n');
    const candidates = companions.length ? companions.map(x => x.char) : characters.slice(0, 6);
    return (
        <>
            <header className="bk-top">
                <button className="bk-icon" onClick={onBack} aria-label="返回书架"><ArrowLeft size={20} /></button>
                <div className="bk-top-title"><small>YEAR IN BOOKS</small><h1>{year} 年度书单</h1></div>
                <span className="bk-icon" />
            </header>
            <main className="bk-scroll overflow-y-auto">
                {years.length > 1 && <nav className="bk-tabs" style={{ margin: '0 0 12px' }}>{years.map(y => <button key={y} aria-pressed={y === year} onClick={() => onYear(y)}>{y}</button>)}</nav>}
                <section className="bk-year-stats">
                    <div><b>{sum.finished.length}</b><small>读完</small></div>
                    <div><b>{sum.days}</b><small>读书天数</small></div>
                    <div><b>{sum.reports}</b><small>报进度</small></div>
                    <div><b>{sum.notes}</b><small>笔记</small></div>
                </section>

                <h3 className="bk-section">读完的书</h3>
                {!sum.finished.length ? <p className="bk-hint">今年还没有读完的书。报进度时勾上「我读完了这本」就会出现在这里。</p> : (
                    <div className="bk-year-books">
                        {sum.finished.map(f => (
                            <button key={f.novelId} onClick={() => onOpenBook(f.novelId)}>
                                <Cover title={f.title} cover={f.cover} large />
                                <span>{f.title}</span>
                                <Stars n={f.rating} />
                                <small>{new Date(f.finishedAt).getMonth() + 1} 月读完</small>
                            </button>
                        ))}
                    </div>
                )}

                {companions.length > 0 && <>
                    <h3 className="bk-section">一起读的人</h3>
                    <div className="bk-readers bk-readers-lg">{companions.map(({ char, n }) => <span key={char.id} className="bk-chip"><Avatar char={char} size={20} />{char.name} · {n} 本</span>)}</div>
                </>}

                <h3 className="bk-section">年度寄语</h3>
                {letters.map(l => (
                    <section key={l.charId} className="bk-letter">
                        <p>{l.text}</p>
                        <small>—— {l.charName}</small>
                    </section>
                ))}
                {error && <p className="bk-warn">{error}</p>}
                <div className="bk-pick">
                    {candidates.map(c => (
                        <button key={c.id} disabled={!!busyId} onClick={async () => {
                            setBusyId(c.id); setError('');
                            try { await onLetter(c, summaryText); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                            finally { setBusyId(null); }
                        }}><Avatar char={c} size={20} /><span>{busyId === c.id ? `${c.name} 正在写…` : letters.some(l => l.charId === c.id) ? `请 ${c.name} 重写` : `请 ${c.name} 写几句`}</span></button>
                    ))}
                </div>
                <p className="bk-hint">寄语会发进你们的私聊，也会进 ta 的记忆。</p>
            </main>
        </>
    );
};
