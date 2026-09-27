/** 书的详情页用到的卡片：封面、笔记、书评。 */
import React, { useRef, useState } from 'react';
import { ArrowSquareOut, BookOpenText, ChatCircleText, FileArrowUp, Highlighter, ImageSquare, NotePencil, Trash } from '@phosphor-icons/react';
import { decodeBytes } from '../../utils/vrWorld/decodeText';
import { chapterIndexAt, type BookChapter, type BookroomRecord } from '../../utils/bookroom/bookroom';
import { mergeNotes, parseReedenNotes, placeNotes, suggestProgressFromNotes, titleFromCsvName, type BookNote } from '../../utils/bookroom/reedenNotes';
import { compressCover } from '../../utils/bookroom/cover';
import { Cover, Stars, type ShelfBook } from './shared';

// ============ 封面 ============

export const CoverCard: React.FC<{ book: ShelfBook; onSave: (rec: BookroomRecord) => Promise<void>; actions?: React.ReactNode }> = ({ book, onSave, actions }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const pick = async (f: File) => {
        setBusy(true); setError('');
        try { await onSave({ ...book.record, cover: await compressCover(f), updatedAt: Date.now() }); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
    };
    return (
        <section className="bk-cover-card">
            <Cover title={book.title} cover={book.record.cover} archived={!!book.record.archived} large />
            <div>
                <p className="bk-cover-meta">{book.author || '佚名'} · {(book.totalChars / 10000).toFixed(1)} 万字{book.record.archived ? ' · 已归档' : ''}</p>
                {book.novel?.summary && <p className="bk-cover-summary">{book.novel.summary}</p>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
                {actions && <div className="bk-hero-actions">{actions}</div>}
                <div className="bk-cover-actions">
                    <button disabled={busy} onClick={() => fileRef.current?.click()}><ImageSquare size={14} /> {busy ? '处理中…' : book.record.cover ? '换封面' : '上传封面'}</button>
                    {book.record.cover && <button disabled={busy} onClick={() => { if (window.confirm('去掉这本书的封面？')) void onSave({ ...book.record, cover: undefined, updatedAt: Date.now() }); }}>去掉</button>}
                </div>
                {error && <p className="bk-warn">{error}</p>}
            </div>
        </section>
    );
};

// ============ 笔记 ============

export const NOTES_PREVIEW = 8;

export const NotesCard: React.FC<{
    book: ShelfBook; chapters: BookChapter[];
    onSave: (rec: BookroomRecord) => Promise<void>;
    onReportAtNote: (note: BookNote) => void; onHighlight: (note?: BookNote) => void;
    onError: (msg: string) => void; onInfo: (msg: string) => void;
    /** 在阅读器里打开这段原文（只看、不改书签） */
    onLocate?: (segIdx: number) => void;
}> = ({ book, chapters, onSave, onReportAtNote, onHighlight, onError, onInfo, onLocate }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [showAll, setShowAll] = useState(false);
    const [busy, setBusy] = useState(false);
    const notes = book.record.notes || [];
    // 按书里的先后排；对不上位置的放最后
    const ordered = [...notes].sort((a, b) => (a.segIdx ?? Infinity) - (b.segIdx ?? Infinity) || a.at - b.at);
    const shown = showAll ? ordered : ordered.slice(0, NOTES_PREVIEW);

    const importCsv = async (f: File) => {
        setBusy(true);
        try {
            const text = decodeBytes(await f.arrayBuffer()).text;
            const incoming = parseReedenNotes(text);
            if (!incoming.length) { onError('这份笔记里没有内容'); return; }
            const csvTitle = titleFromCsvName(f.name);
            if (csvTitle && csvTitle !== book.title && !window.confirm(`这份笔记看起来是《${csvTitle}》的，确定要导入到《${book.title}》吗？`)) return;
            const placed = book.novel ? placeNotes(book.novel.segments, chapters, incoming) : incoming;
            const { notes: merged, added, updated } = mergeNotes(notes, placed);
            await onSave({ ...book.record, notes: merged, updatedAt: Date.now() });
            const missed = placed.filter(n => n.segIdx == null).length;
            onInfo(`导入 ${added} 条新笔记${updated ? `，更新 ${updated} 条` : ''}${missed && book.novel ? `（${missed} 条在书里没找到原文）` : ''}`);
            if (book.novel) {
                const next = suggestProgressFromNotes(merged, book.record.progress?.segIdx);
                if (next && window.confirm(`最新一条笔记在「${next.chapter || '书里某处'}」，比你记的进度靠后。要把进度更新到这里吗？`)) onReportAtNote(next);
            }
        } catch (e) { onError(`导入失败：${e instanceof Error ? e.message : String(e)}`); }
        finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
    };

    const remove = (note: BookNote) => {
        if (!window.confirm('删掉这条笔记？（聊天里已经发出去的消息不受影响）')) return;
        void onSave({ ...book.record, notes: notes.filter(n => n.id !== note.id), updatedAt: Date.now() });
    };

    return (
        <section>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f); }} />
            <div className="bk-note-actions">
                <button disabled={busy} onClick={() => fileRef.current?.click()}><FileArrowUp size={14} /> {busy ? '导入中…' : '导入 Reeden 笔记'}</button>
                {!book.record.archived && <button onClick={() => onHighlight()}><ChatCircleText size={14} /> 划一句给 ta 看</button>}
            </div>
            {!notes.length && <p className="bk-hint">在 Reeden 的笔记页导出 CSV，再从这里导入。重复导入不会重复，只会补上新的。</p>}
            <ul className="bk-notes">
                {shown.map(n => {
                    const ci = n.segIdx != null ? chapterIndexAt(chapters, n.segIdx) : -1;
                    return (
                        <li key={n.id} className="bk-note-item" style={{ borderLeftColor: n.color || 'var(--bk-accent)' }}>
                            <small>{n.chapter || (ci >= 0 ? chapters[ci].title : '')}{n.segIdx == null && book.novel ? ' · 书里没找到这句' : ''}</small>
                            <blockquote>{n.quote}</blockquote>
                            {n.note && <p className="bk-note-mine">我：{n.note}</p>}
                            {(n.replies || []).map(r => <p key={r.at} className="bk-note-reply"><b>{r.charName}</b>：{r.content}</p>)}
                            <div className="bk-note-foot">
                                {onLocate && book.novel && n.segIdx != null && <button onClick={() => onLocate(n.segIdx!)}><BookOpenText size={13} /> 看原文</button>}
                                {!book.record.archived && <button onClick={() => onHighlight(n)}><ChatCircleText size={13} /> 给 ta 看</button>}
                                {n.link && <a href={n.link}><ArrowSquareOut size={13} /> 在 Reeden 打开</a>}
                                <button onClick={() => remove(n)}>删除</button>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {ordered.length > NOTES_PREVIEW && <button className="bk-more" onClick={() => setShowAll(v => !v)}>{showAll ? '收起' : `展开全部 ${ordered.length} 条`}</button>}
        </section>
    );
};

// ============ 书评 ============

export const ReviewsCard: React.FC<{ book: ShelfBook; onReview: () => void; onSave: (rec: BookroomRecord) => Promise<void> }> = ({ book, onReview, onSave }) => {
    const mine = book.record.reviews?.user;
    const theirs = book.record.reviews?.chars || [];
    const removeMine = () => {
        if (!window.confirm('删掉你的书评？（发进聊天的消息不受影响）')) return;
        void onSave({ ...book.record, reviews: { ...book.record.reviews, user: undefined }, updatedAt: Date.now() });
    };
    const removeChar = (charId: string, name: string) => {
        if (!window.confirm(`删掉 ${name} 的书评？（发进聊天的消息不受影响）`)) return;
        void onSave({ ...book.record, reviews: { ...book.record.reviews, chars: theirs.filter(r => r.charId !== charId) }, updatedAt: Date.now() });
    };
    return (
        <section>
            {!mine && !theirs.length && <p className="bk-empty-sm">读完以后写一篇，再请 ta 也写一篇，两篇并排放在这里。</p>}
            {mine && (
                <div className="bk-review is-mine">
                    <div className="bk-review-head"><b>我</b><Stars n={mine.rating} /><button className="bk-link-btn" onClick={removeMine} aria-label="删除我的书评"><Trash size={13} /></button></div>
                    <p>{mine.text}</p>
                </div>
            )}
            {theirs.map(r => (
                <div key={r.charId} className="bk-review">
                    <div className="bk-review-head"><b>{r.charName}</b><Stars n={r.rating} /><button className="bk-link-btn" onClick={() => removeChar(r.charId, r.charName)} aria-label={`删除${r.charName}的书评`}><Trash size={13} /></button></div>
                    <p>{r.text}</p>
                </div>
            ))}
            <button className="bk-secondary" style={{ marginTop: 10 }} onClick={onReview}><NotePencil size={15} /> {mine ? '改我的书评 / 再请 ta 写一篇' : '写书评'}</button>
        </section>
    );
};
