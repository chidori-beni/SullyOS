/**
 * 书房首页的四个标签：书架 / 笔记 / 书友 / 足迹。
 */
import React, { useMemo, useState } from 'react';
import { BookOpenText, CaretRight, MagnifyingGlass, Rows, SquaresFour } from '@phosphor-icons/react';
import type { CharacterProfile, VRLibraryCategory } from '../../types';
import { chapterIndexAt, detectChapters, formatPercent, progressRatio, type BookroomRecord } from '../../utils/bookroom/bookroom';
import { READING_PACE_LABEL, readingPaceOf } from '../../utils/bookroom/pace';
import { yearSummary, type BookroomMeta } from '../../utils/bookroom/stats';
import { Avatar, Bar, Cover, charRatio, type ShelfBook } from './shared';
import { CheckinCard } from './Footprints';

// ============ 书架 ============

type ShelfStatus = 'all' | 'reading' | 'unread' | 'finished' | 'archived';
const SHELF_VIEW_KEY = 'bookroom_shelf_view';

const statusOf = (b: ShelfBook): Exclude<ShelfStatus, 'all'> => {
    if (b.record.archived) return 'archived';
    const p = b.record.progress;
    if (!p) return 'unread';
    return p.segIdx >= b.segCount - 1 ? 'finished' : 'reading';
};

export const ShelfView: React.FC<{
    books: ShelfBook[]; characters: CharacterProfile[]; categories: VRLibraryCategory[]; loaded: boolean;
    onOpen: (novelId: string) => void; onImport: () => void;
}> = ({ books, characters, categories, loaded, onOpen, onImport }) => {
    const [status, setStatus] = useState<ShelfStatus>('all');
    const [category, setCategory] = useState('all');
    const [query, setQuery] = useState('');
    const [view, setView] = useState<'shelf' | 'list'>(() => { try { return localStorage.getItem(SHELF_VIEW_KEY) === 'list' ? 'list' : 'shelf'; } catch { return 'shelf'; } });
    const switchView = (v: 'shelf' | 'list') => { setView(v); try { localStorage.setItem(SHELF_VIEW_KEY, v); } catch { /* ignore */ } };

    const count = (s: ShelfStatus) => s === 'all' ? books.length : books.filter(b => statusOf(b) === s).length;
    const catIds = new Set(categories.map(c => c.id));
    const q = query.trim().toLocaleLowerCase();
    const shown = books.filter(b =>
        (status === 'all' || statusOf(b) === status)
        && (category === 'all' || (category === 'none' ? !catIds.has(b.novel?.categoryId || '') : b.novel?.categoryId === category))
        && (!q || `${b.title} ${b.author || ''}`.toLocaleLowerCase().includes(q)));

    if (loaded && !books.length) {
        return (
            <div className="bk-empty">
                <BookOpenText size={40} weight="thin" />
                <p>书架还空着。</p>
                <button className="bk-primary" style={{ maxWidth: 220 }} onClick={onImport}>导入一本书（EPUB / TXT / PDF）</button>
            </div>
        );
    }

    const rows: ShelfBook[][] = [];
    for (let i = 0; i < shown.length; i += 3) rows.push(shown.slice(i, i + 3));

    return (
        <>
            <div className="bk-shelf-tools">
                <label className="bk-search"><MagnifyingGlass size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜书名或作者" /></label>
                <div className="bk-view-toggle">
                    <button aria-pressed={view === 'shelf'} onClick={() => switchView('shelf')} aria-label="书架"><SquaresFour size={17} /></button>
                    <button aria-pressed={view === 'list'} onClick={() => switchView('list')} aria-label="列表"><Rows size={17} /></button>
                </div>
            </div>
            <nav className="bk-chips">
                {([['all', '全部'], ['reading', '在读'], ['unread', '未开始'], ['finished', '读完'], ['archived', '已归档']] as const).map(([id, label]) =>
                    (id === 'all' || count(id) > 0) && <button key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>{label} {count(id)}</button>)}
            </nav>
            {categories.length > 0 && (
                <nav className="bk-chips bk-chips-sub">
                    <button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>所有分类</button>
                    {categories.map(c => <button key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</button>)}
                    <button aria-pressed={category === 'none'} onClick={() => setCategory('none')}>未分类</button>
                </nav>
            )}

            {!shown.length && <p className="bk-empty-sm">这里没有书。换个分类或搜索词试试。</p>}

            {view === 'shelf' ? (
                <div className="bk-bookcase">
                    {rows.map((row, i) => (
                        <div className="bk-plank" key={i}>
                            {row.map(b => {
                                const me = b.record.progress ? progressRatio(b.record.progress.segIdx, b.segCount) : null;
                                return (
                                    <button key={b.novelId} className={`bk-case-book ${b.record.archived ? 'is-archived' : ''}`} onClick={() => onOpen(b.novelId)}>
                                        <Cover title={b.title} cover={b.record.cover} archived={!!b.record.archived} large />
                                        {me != null && <span className="bk-case-progress"><span style={{ width: `${Math.round(me * 100)}%` }} /></span>}
                                        <span className="bk-case-title">{b.title}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bk-shelf">
                    {shown.map(b => {
                        const me = b.record.progress ? progressRatio(b.record.progress.segIdx, b.segCount) : null;
                        const readers = characters.filter(c => charRatio(c, b) != null || b.record.companionIds.includes(c.id));
                        return (
                            <button key={b.novelId} className={`bk-book ${b.record.archived ? 'is-archived' : ''}`} onClick={() => onOpen(b.novelId)}>
                                <Cover title={b.title} cover={b.record.cover} archived={!!b.record.archived} />
                                <span className="bk-book-body">
                                    <strong>{b.title}</strong>
                                    <small>{b.author || '佚名'} · {(b.totalChars / 10000).toFixed(1)} 万字{b.record.archived ? ' · 已归档' : ''}</small>
                                    <span className="bk-mini-row"><em>我</em><Bar ratio={me ?? 0} /><em>{me == null ? '未开始' : formatPercent(me)}</em></span>
                                    {readers.length > 0 && <span className="bk-readers">{readers.slice(0, 5).map(c => <Avatar key={c.id} char={c} size={20} />)}</span>}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </>
    );
};

// ============ 笔记 ============

export const NotesHub: React.FC<{
    books: ShelfBook[];
    onRead: (novelId: string, segIdx: number) => void;
    onOpenBookNotes: (novelId: string) => void;
}> = ({ books, onRead, onOpenBookNotes }) => {
    const [bookId, setBookId] = useState('all');
    const [onlyReplied, setOnlyReplied] = useState(false);
    const all = useMemo(() => books.flatMap(b => (b.record.notes || []).map(n => ({ n, b }))).sort((x, y) => y.n.at - x.n.at), [books]);
    const withNotes = books.filter(b => (b.record.notes || []).length);
    const shown = all.filter(({ n, b }) => (bookId === 'all' || b.novelId === bookId) && (!onlyReplied || (n.replies || []).length));
    if (!all.length) {
        return <p className="bk-empty-sm">还没有笔记。<br />点进一本书的「笔记」页，可以导入 Reeden 导出的笔记，或者划一句给 ta 看。</p>;
    }
    return (
        <>
            <nav className="bk-chips">
                <button aria-pressed={bookId === 'all'} onClick={() => setBookId('all')}>全部 {all.length}</button>
                {withNotes.map(b => <button key={b.novelId} aria-pressed={bookId === b.novelId} onClick={() => setBookId(b.novelId)}>{b.title} {(b.record.notes || []).length}</button>)}
            </nav>
            <label className="bk-check" style={{ margin: '0 2px 10px' }}><input type="checkbox" checked={onlyReplied} onChange={e => setOnlyReplied(e.target.checked)} /> 只看角色回应过的</label>
            <ul className="bk-notes">
                {shown.map(({ n, b }) => {
                    const chapters = b.record.chapters || (b.novel ? detectChapters(b.novel.segments) : []);
                    const ci = n.segIdx != null ? chapterIndexAt(chapters, n.segIdx) : -1;
                    return (
                        <li key={`${b.novelId}-${n.id}`} className="bk-note-item" style={{ borderLeftColor: n.color || 'var(--bk-accent)' }}>
                            <small>《{b.title}》 · {n.chapter || (ci >= 0 ? chapters[ci].title : '')}</small>
                            <blockquote>{n.quote}</blockquote>
                            {n.note && <p className="bk-note-mine">我：{n.note}</p>}
                            {(n.replies || []).map(r => <p key={r.at} className="bk-note-reply"><b>{r.charName}</b>：{r.content}</p>)}
                            <div className="bk-note-foot">
                                {b.novel && n.segIdx != null && <button onClick={() => onRead(b.novelId, n.segIdx!)}><BookOpenText size={13} /> 在书里看</button>}
                                <button onClick={() => onOpenBookNotes(b.novelId)}>去这本书</button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </>
    );
};

// ============ 书友 ============

export const FriendsView: React.FC<{ books: ShelfBook[]; characters: CharacterProfile[]; onChar: (id: string) => void }> = ({ books, characters, onChar }) => {
    const [showOthers, setShowOthers] = useState(false);
    const stats = characters.map(c => {
        const rows = books.map(b => charRatio(c, b)).filter((r): r is number => r != null);
        const together = books.filter(b => b.record.companionIds.includes(c.id)).length;
        return { char: c, reading: rows.filter(r => r < 1).length, finished: rows.filter(r => r >= 1).length, together };
    });
    const active = stats.filter(s => s.reading || s.finished || s.together);
    const others = stats.filter(s => !(s.reading || s.finished || s.together));
    const Row = ({ s }: { s: typeof stats[number] }) => (
        <button className="bk-friend" onClick={() => onChar(s.char.id)}>
            <Avatar char={s.char} size={44} />
            <span>
                <strong>{s.char.name}</strong>
                <small>在读 {s.reading} · 读完 {s.finished}{s.together ? ` · 和你一起读 ${s.together}` : ''}</small>
                <small>{s.char.vrState?.enabled ? `彼方 · ${READING_PACE_LABEL[readingPaceOf(s.char)]}` : '还没接入彼方'}</small>
            </span>
            <CaretRight size={16} />
        </button>
    );
    return (
        <>
            {!active.length && <p className="bk-empty-sm">还没有角色读过书架上的书。<br />在书的「进度」页把 ta 设成「一起读的人」，或者让 ta 在彼方图书馆读书。</p>}
            <div className="bk-friends">{active.map(s => <Row key={s.char.id} s={s} />)}</div>
            {others.length > 0 && <>
                <button className="bk-more" onClick={() => setShowOthers(v => !v)}>{showOthers ? '收起' : `其他 ${others.length} 个角色`}</button>
                {showOthers && <div className="bk-friends">{others.map(s => <Row key={s.char.id} s={s} />)}</div>}
            </>}
        </>
    );
};

// ============ 足迹 ============

export const MeView: React.FC<{
    records: BookroomRecord[]; meta: BookroomMeta;
    onCheckin: () => void; onYear: (y: number) => void;
}> = ({ records, meta, onCheckin, onYear }) => {
    const years = useMemo(() => {
        const ys = new Set<number>([new Date().getFullYear()]);
        for (const r of records) for (const h of r.history) ys.add(new Date(h.at).getFullYear());
        return [...ys].sort((a, b) => b - a);
    }, [records]);
    const want = meta.recommendations.filter(r => r.status === 'want');
    return (
        <>
            <CheckinCard records={records} meta={meta} onCheckin={onCheckin} onYear={() => onYear(new Date().getFullYear())} />
            <h3 className="bk-section">年度书单</h3>
            <div className="bk-friends">
                {years.map(y => {
                    const s = yearSummary(records, meta, y);
                    return (
                        <button key={y} className="bk-friend" onClick={() => onYear(y)}>
                            <span className="bk-year-badge">{y}</span>
                            <span><strong>{y} 年</strong><small>读完 {s.finished.length} 本 · 读书 {s.days} 天 · 笔记 {s.notes} 条</small></span>
                            <CaretRight size={16} />
                        </button>
                    );
                })}
            </div>
            <h3 className="bk-section">想读清单</h3>
            {!want.length ? <p className="bk-empty-sm">角色推荐的书里，标了「想读」的会列在这里。</p> : (
                <ul className="bk-recs">
                    {want.map(r => <li key={r.id}><strong>《{r.title}》</strong>{r.author && <small> {r.author}</small>}<p>{r.charName} 推荐：{r.reason}</p></li>)}
                </ul>
            )}
        </>
    );
};
