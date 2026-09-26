/**
 * 书房 —— 在 Reeden 里读，回来告诉 Sully 读到了哪。
 *
 * 书与角色书签沿用彼方书库（同一个书架），书房只管「你的那一半」：
 * 报进度（选章节 / 粘一句原文）、看你和角色各读到哪、把进度发进角色私聊进记忆、
 * 归档（只删正文，记录全留）。逻辑见 utils/bookroom/。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Archive, ArrowSquareOut, BookOpenText, ChatCircleText, Check, FileArrowUp, Highlighter, ImageSquare, ListBullets, MagnifyingGlass, Plus, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import TokenImg from '../components/os/TokenImg';
import type { CharacterProfile, VRWorldNovel } from '../types';
import { buildNovelAsync } from '../utils/vrWorld/novel';
import { decodeBytes } from '../utils/vrWorld/decodeText';
import { extractPdfText, isPdfFile } from '../utils/pdfText';
import {
    applyProgress, buildProgressMessage, chapterIndexAt, chaptersFromAnchors, detectChapters, emptyRecord, fallbackSections,
    findArchivedByTitle, formatPercent, locateSentence, progressRatio, unfinishedReaders,
    type BookChapter, type BookroomRecord, type SentenceMatch,
} from '../utils/bookroom/bookroom';
import { archiveBook, deleteBookCompletely, listBookroomRecords, restoreArchivedBook, saveBookroomRecord, saveImportExtras, sendProgressToCharacters } from '../utils/bookroom/bookroomDb';
import { parseEpub } from '../utils/bookroom/epub';
import { mergeNotes, parseReedenNotes, placeNotes, suggestProgressFromNotes, titleFromCsvName, type BookNote } from '../utils/bookroom/reedenNotes';
import { askCharacterAboutHighlight, buildHighlightMessage } from '../utils/bookroom/highlightReply';
import { compressCover } from '../utils/bookroom/cover';
import './bookroom/bookroom.css';

/** 书架上的一本：在架（有正文）或已归档（只有记录）。 */
interface ShelfBook {
    novelId: string;
    title: string;
    author?: string;
    segCount: number;
    totalChars: number;
    novel?: VRWorldNovel;
    record: BookroomRecord;
}

const charRatio = (c: CharacterProfile, book: ShelfBook) => {
    const bm = c.vrState?.novelBookmarks?.[book.novelId];
    return bm == null || bm <= 0 ? null : Math.min(1, bm / Math.max(1, book.segCount));
};

const Avatar: React.FC<{ char: CharacterProfile; size?: number }> = ({ char, size = 26 }) => (
    <span className="bk-avatar" style={{ width: size, height: size }}>
        {char.avatar ? <TokenImg value={char.avatar} alt={char.name} /> : <span>{char.name.slice(0, 1)}</span>}
    </span>
);

/** 书脊 / 封面：有封面图就显示图，没有就是带首字的书脊。 */
const Cover: React.FC<{ title: string; cover?: string; archived?: boolean; large?: boolean }> = ({ title, cover, archived, large }) => (
    <span className={`bk-spine ${cover ? 'has-cover' : ''} ${archived ? 'is-archived' : ''} ${large ? 'bk-spine-lg' : ''}`} aria-hidden>
        {cover ? <img src={cover} alt="" /> : title.slice(0, 1)}
    </span>
);

const Bar: React.FC<{ ratio: number; tone?: 'me' | 'char' }> = ({ ratio, tone = 'me' }) => (
    <span className={`bk-bar bk-bar-${tone}`}><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
);

const BookroomApp: React.FC = () => {
    const { closeApp, characters, apiConfig, memoryPalaceConfig, userProfile, groups, realtimeConfig, addToast, registerBackHandler } = useOS();
    const [novels, setNovels] = useState<VRWorldNovel[]>([]);
    const [records, setRecords] = useState<BookroomRecord[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [reporting, setReporting] = useState<{ preset?: BookChapter; note?: BookNote } | null>(null);
    // 划线给 ta 看：note 为空表示手动粘一句
    const [highlighting, setHighlighting] = useState<{ note?: BookNote } | null>(null);
    const [importing, setImporting] = useState(false);

    const reload = useCallback(async () => {
        const [n, r] = await Promise.all([DB.getVRNovels(), listBookroomRecords()]);
        setNovels(n); setRecords(r); setLoaded(true);
    }, []);
    useEffect(() => { void reload(); }, [reload]);

    const books = useMemo<ShelfBook[]>(() => {
        const byId = new Map(records.map(r => [r.novelId, r]));
        const live: ShelfBook[] = novels.map(n => ({
            novelId: n.id, title: n.title, author: n.author, segCount: n.segments.length, totalChars: n.totalChars,
            novel: n, record: byId.get(n.id) || emptyRecord(n.id),
        }));
        const liveIds = new Set(novels.map(n => n.id));
        const archived: ShelfBook[] = records.filter(r => r.archived && !liveIds.has(r.novelId)).map(r => ({
            novelId: r.novelId, title: r.archived!.title, author: r.archived!.author,
            segCount: r.archived!.segCount, totalChars: r.archived!.totalChars, record: r,
        }));
        const recent = (b: ShelfBook) => b.record.progress?.at || 0;
        return [...live.sort((a, b) => recent(b) - recent(a)), ...archived];
    }, [novels, records]);

    const book = books.find(b => b.novelId === openId) || null;

    useEffect(() => registerBackHandler(() => {
        if (highlighting) { setHighlighting(null); return true; }
        if (reporting) { setReporting(null); return true; }
        if (importing) { setImporting(false); return true; }
        if (openId) { setOpenId(null); return true; }
        return false;
    }), [registerBackHandler, highlighting, reporting, importing, openId]);

    const saveRecord = async (rec: BookroomRecord) => {
        const nv = novels.find(n => n.id === rec.novelId);
        // 自动识别出的目录也存一份：聊天里说「读到第几章」要用，不必每次都扫正文
        const autoChapters = !rec.chapters && nv ? detectChapters(nv.segments) : [];
        const stamped: BookroomRecord = {
            ...rec,
            title: nv?.title || rec.title || rec.archived?.title,
            segCount: nv?.segments.length ?? rec.segCount,
            chapters: rec.chapters || (autoChapters.length ? autoChapters : undefined),
        };
        await saveBookroomRecord(stamped);
        setRecords(rs => [...rs.filter(r => r.novelId !== rec.novelId), stamped]);
    };

    return (
        <div className="bookroom">
            {!book ? (
                <>
                    <header className="bk-top">
                        <button className="bk-icon" onClick={closeApp} aria-label="返回"><ArrowLeft size={20} /></button>
                        <div className="bk-top-title"><small>BOOKROOM</small><h1>书房</h1></div>
                        <button className="bk-icon" onClick={() => setImporting(true)} aria-label="导入书"><Plus size={20} /></button>
                    </header>
                    <main className="bk-scroll overflow-y-auto">
                        <p className="bk-lead">在 Reeden 里读，回来告诉 {characters.length === 1 ? characters[0].name : 'ta'} 你读到了哪。书架和彼方书库是同一个。</p>
                        {loaded && !books.length && <div className="bk-empty"><BookOpenText size={36} weight="thin" /><p>书架还空着。<br />点右上角「+」导入一本 EPUB / TXT / PDF。</p></div>}
                        <div className="bk-shelf">
                            {books.map(b => {
                                const me = b.record.progress ? progressRatio(b.record.progress.segIdx, b.segCount) : null;
                                const readers = characters.filter(c => charRatio(c, b) != null || b.record.companionIds.includes(c.id));
                                return (
                                    <button key={b.novelId} className={`bk-book ${b.record.archived ? 'is-archived' : ''}`} onClick={() => setOpenId(b.novelId)}>
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
                    </main>
                </>
            ) : (
                <BookDetail
                    book={book} characters={characters}
                    onBack={() => setOpenId(null)}
                    onReport={preset => setReporting({ preset })}
                    onReportAtNote={note => setReporting({ note })}
                    onHighlight={note => setHighlighting({ note })}
                    onError={msg => addToast(msg, 'error')}
                    onInfo={msg => addToast(msg, 'success')}
                    onSave={saveRecord}
                    onArchive={async () => {
                        if (!book.novel) return;
                        const pending = unfinishedReaders(book.novel, book.record, characters);
                        const warn = pending.length ? `\n\n还没读完的：${pending.join('、')}。归档后角色就没法接着读这本了。` : '';
                        if (!window.confirm(`归档《${book.title}》？\n\n会删掉正文来省空间，进度、目录、角色批注和聊天里的记忆都保留。以后重新导入同名的书，记录会自动接回。${warn}`)) return;
                        try {
                            const next = await archiveBook(book.novel, { ...book.record, chapters: book.record.chapters || detectChapters(book.novel.segments) });
                            setRecords(rs => [...rs.filter(r => r.novelId !== next.novelId), next]);
                            setNovels(ns => ns.filter(n => n.id !== book.novelId));
                            addToast('已归档，记录都还在', 'success');
                        } catch (e) { addToast(e instanceof Error ? e.message : String(e), 'error'); }
                    }}
                    onDelete={async () => {
                        if (!window.confirm(`彻底删除《${book.title}》？\n\n正文、角色在书上的批注、你的进度、读书记录和封面都会删掉，不能恢复。\n\n已经发进聊天的进度消息和角色的记忆不受影响。\n\n只想省空间的话，用「归档」更好。`)) return;
                        try {
                            await deleteBookCompletely(book.novelId);
                            setRecords(rs => rs.filter(r => r.novelId !== book.novelId));
                            setNovels(ns => ns.filter(n => n.id !== book.novelId));
                            setOpenId(null);
                            addToast('已删除', 'success');
                        } catch (e) { addToast(e instanceof Error ? e.message : String(e), 'error'); }
                    }}
                />
            )}

            {book && reporting && (
                <ReportSheet
                    book={book} characters={characters} preset={reporting.preset} presetNote={reporting.note}
                    onClose={() => setReporting(null)}
                    onDone={async (rec, text, tellIds) => {
                        await saveRecord(rec);
                        // 彼方阅读器里的「你的书签」也跟着挪过去，两边看到的一致
                        try { localStorage.setItem(`vr_user_bm_${book.novelId}`, String(rec.progress?.segIdx ?? 0)); } catch { /* ignore */ }
                        const tell = characters.filter(c => tellIds.includes(c.id));
                        if (tell.length) {
                            await sendProgressToCharacters({ text, novelId: book.novelId, characters: tell, apiConfig, memoryPalaceConfig, userName: userProfile?.name || '' });
                        }
                        setReporting(null);
                        addToast(tell.length ? `记好了，也告诉了 ${tell.map(c => c.name).join('、')}` : '进度记好了', 'success');
                    }}
                />
            )}

            {book && highlighting && (
                <HighlightSheet
                    book={book} characters={characters} note={highlighting.note}
                    onClose={() => setHighlighting(null)}
                    onAsk={async (char, quote, comment, chapter, segIdx) => {
                        const reply = await askCharacterAboutHighlight({
                            char, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig,
                            novelId: book.novelId,
                            message: buildHighlightMessage({ bookTitle: book.title, chapter, quote, comment }),
                        });
                        const answer = { charId: char.id, charName: char.name, content: reply, at: Date.now() };
                        const notes = book.record.notes || [];
                        const target = highlighting.note;
                        const nextNotes: BookNote[] = target
                            ? notes.map(n => n.id === target.id ? { ...n, replies: [...(n.replies || []), answer] } : n)
                            : [...notes, { id: `m${Date.now().toString(36)}`, chapter: chapter || '', quote, note: comment || undefined, at: Date.now(), segIdx, source: 'manual', replies: [answer] }];
                        await saveRecord({ ...book.record, notes: nextNotes, updatedAt: Date.now() });
                        return reply;
                    }}
                />
            )}

            {importing && (
                <ImportSheet
                    records={records}
                    onClose={() => setImporting(false)}
                    onImported={async id => { setImporting(false); await reload(); setOpenId(id); }}
                    onError={msg => addToast(msg, 'error')}
                />
            )}
        </div>
    );
};

// ============ 一本书 ============

const BookDetail: React.FC<{
    book: ShelfBook; characters: CharacterProfile[];
    onBack: () => void; onReport: (preset?: BookChapter) => void;
    onSave: (rec: BookroomRecord) => Promise<void>; onArchive: () => void; onDelete: () => void;
    onReportAtNote: (note: BookNote) => void; onHighlight: (note?: BookNote) => void;
    onError: (msg: string) => void; onInfo: (msg: string) => void;
}> = ({ book, characters, onBack, onReport, onSave, onArchive, onDelete, onReportAtNote, onHighlight, onError, onInfo }) => {
    const detected = useMemo(() => book.record.chapters || (book.novel ? detectChapters(book.novel.segments) : []), [book.novel, book.record.chapters]);
    const chapters = detected.length ? detected : fallbackSections(book.segCount);
    const myAt = book.record.progress?.segIdx;
    const myChapter = myAt == null ? -1 : chapterIndexAt(chapters, myAt);
    const [pickCompanions, setPickCompanions] = useState(false);
    const [showAllToc, setShowAllToc] = useState(false);
    const companions = book.record.companionIds;
    const readers = characters.filter(c => charRatio(c, book) != null || companions.includes(c.id));
    const tocStart = showAllToc ? 0 : Math.max(0, myChapter - 2);
    const tocList = showAllToc ? chapters : chapters.slice(tocStart, tocStart + 8);

    return (
        <>
            <header className="bk-top">
                <button className="bk-icon" onClick={onBack} aria-label="返回书架"><ArrowLeft size={20} /></button>
                <div className="bk-top-title"><small>{book.author || '佚名'}</small><h1 className="truncate">{book.title}</h1></div>
                <span className="bk-icon" />
            </header>
            <main className="bk-scroll overflow-y-auto">
                <CoverCard book={book} onSave={onSave} />

                {book.record.archived && (
                    <div className="bk-note">这本书已归档：正文删掉了，记录都在。想接着读，就重新导入同名的书，所有记录会自动接回。</div>
                )}

                <section className="bk-card">
                    <h2>读到哪了</h2>
                    <div className="bk-progress-row">
                        <span className="bk-avatar bk-avatar-me">我</span>
                        <div>
                            <p>{myAt == null ? '还没报过进度' : myChapter >= 0 ? chapters[myChapter].title : '已开始'}</p>
                            <Bar ratio={myAt == null ? 0 : progressRatio(myAt, book.segCount)} />
                        </div>
                        <em>{myAt == null ? '—' : formatPercent(progressRatio(myAt, book.segCount))}</em>
                    </div>
                    {readers.map(c => {
                        const r = charRatio(c, book);
                        const bm = c.vrState?.novelBookmarks?.[book.novelId];
                        const ch = bm != null ? chapterIndexAt(chapters, Math.max(0, bm - 1)) : -1;
                        return (
                            <div className="bk-progress-row" key={c.id}>
                                <Avatar char={c} />
                                <div>
                                    <p>{c.name}{r == null ? ' · 还没在彼方翻开' : r >= 1 ? ' · 读完了' : ch >= 0 ? ` · ${chapters[ch].title}` : ''}</p>
                                    <Bar ratio={r ?? 0} tone="char" />
                                </div>
                                <em>{r == null ? '—' : formatPercent(r)}</em>
                            </div>
                        );
                    })}
                    {!book.record.archived && <button className="bk-primary" onClick={() => onReport()}>报进度</button>}
                    <p className="bk-hint">角色的进度来自 ta 在彼方图书馆自己读书，想让 ta 读这本，去彼方书库设置「谁来读这些书」。</p>
                </section>

                <section className="bk-card">
                    <div className="bk-card-head"><h2>一起读的人</h2><button onClick={() => setPickCompanions(v => !v)}>{pickCompanions ? '完成' : '修改'}</button></div>
                    <p className="bk-hint">报进度时默认告诉这些人，进度会进 ta 的聊天和记忆。</p>
                    {pickCompanions ? (
                        <div className="bk-pick">
                            {characters.map(c => {
                                const on = companions.includes(c.id);
                                return (
                                    <button key={c.id} aria-pressed={on} onClick={() => void onSave({ ...book.record, companionIds: on ? companions.filter(id => id !== c.id) : [...companions, c.id], updatedAt: Date.now() })}>
                                        <Avatar char={c} size={22} /><span>{c.name}</span>{on && <Check size={14} weight="bold" />}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bk-readers bk-readers-lg">
                            {companions.length ? characters.filter(c => companions.includes(c.id)).map(c => <span key={c.id} className="bk-chip"><Avatar char={c} size={20} />{c.name}</span>) : <span className="bk-hint">还没选。</span>}
                        </div>
                    )}
                </section>

                <section className="bk-card">
                    <div className="bk-card-head">
                        <h2><ListBullets size={16} /> 目录{!detected.length && chapters.length ? '（没认出章节，按位置分）' : ''}</h2>
                        {chapters.length > 8 && <button onClick={() => setShowAllToc(v => !v)}>{showAllToc ? '收起' : `全部 ${chapters.length} 章`}</button>}
                    </div>
                    <ol className="bk-toc">
                        {tocList.map((c, i) => {
                            const idx = showAllToc ? i : tocStart + i;
                            return (
                                <li key={`${c.segIdx}-${idx}`} className={idx === myChapter ? 'is-here' : idx < myChapter ? 'is-read' : ''}>
                                    <button disabled={!!book.record.archived} onClick={() => onReport(c)}>
                                        <span>{c.title}</span>{idx === myChapter && <em>读到这</em>}
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    {!book.record.archived && <p className="bk-hint">点某一章，直接报「读到这一章」。</p>}
                </section>

                <NotesCard book={book} chapters={chapters} onSave={onSave} onReportAtNote={onReportAtNote} onHighlight={onHighlight} onError={onError} onInfo={onInfo} />

                {book.record.history.length > 0 && (
                    <section className="bk-card">
                        <h2>读书记录</h2>
                        <ul className="bk-history">
                            {[...book.record.history].reverse().slice(0, 12).map(h => {
                                const ci = chapterIndexAt(chapters, h.segIdx);
                                return (
                                    <li key={h.at}>
                                        <time>{new Date(h.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time>
                                        <div>
                                            <p>{ci >= 0 ? chapters[ci].title : '某处'} · {formatPercent(progressRatio(h.segIdx, book.segCount))}</p>
                                            {h.thought && <small>{h.thought}</small>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                {!book.record.archived && (
                    <button className="bk-danger" onClick={onArchive}><Archive size={16} /> 归档（删正文省空间，记录全留）</button>
                )}
                <button className="bk-danger bk-delete" onClick={onDelete}><Trash size={16} /> 彻底删除这本书</button>
            </main>
        </>
    );
};

// ============ 封面 ============

const CoverCard: React.FC<{ book: ShelfBook; onSave: (rec: BookroomRecord) => Promise<void> }> = ({ book, onSave }) => {
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
                <p className="bk-cover-meta">{(book.totalChars / 10000).toFixed(1)} 万字{book.record.archived ? ' · 已归档' : ''}</p>
                {book.novel?.summary && <p className="bk-cover-summary">{book.novel.summary}</p>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
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

const NOTES_PREVIEW = 8;

const NotesCard: React.FC<{
    book: ShelfBook; chapters: BookChapter[];
    onSave: (rec: BookroomRecord) => Promise<void>;
    onReportAtNote: (note: BookNote) => void; onHighlight: (note?: BookNote) => void;
    onError: (msg: string) => void; onInfo: (msg: string) => void;
}> = ({ book, chapters, onSave, onReportAtNote, onHighlight, onError, onInfo }) => {
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
        <section className="bk-card">
            <div className="bk-card-head"><h2><Highlighter size={16} /> 笔记{notes.length ? ` ${notes.length}` : ''}</h2></div>
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

const HighlightSheet: React.FC<{
    book: ShelfBook; characters: CharacterProfile[]; note?: BookNote;
    onClose: () => void;
    onAsk: (char: CharacterProfile, quote: string, comment: string, chapter: string | undefined, segIdx: number | undefined) => Promise<string>;
}> = ({ book, characters, note, onClose, onAsk }) => {
    const companions = characters.filter(c => book.record.companionIds.includes(c.id));
    const ordered = [...companions, ...characters.filter(c => !book.record.companionIds.includes(c.id))];
    const [charId, setCharId] = useState(ordered[0]?.id || '');
    const [quote, setQuote] = useState(note?.quote || '');
    const [comment, setComment] = useState(note?.note || '');
    const [busy, setBusy] = useState(false);
    const [reply, setReply] = useState('');
    const [error, setError] = useState('');
    const char = characters.find(c => c.id === charId);

    const ask = async () => {
        if (!char || !quote.trim()) return;
        setBusy(true); setError('');
        try {
            let chapter = note?.chapter;
            let segIdx = note?.segIdx;
            if (!note && book.novel) {
                // 手动粘的句子：顺手在书里找位置，章节名给 ta 当语境
                const hit = locateSentence(book.novel.segments, quote)[0];
                if (hit) {
                    segIdx = hit.segIdx;
                    const chs = book.record.chapters || detectChapters(book.novel.segments);
                    chapter = chs[chapterIndexAt(chs, hit.segIdx)]?.title;
                }
            }
            setReply(await onAsk(char, quote.trim(), comment.trim(), chapter || undefined, segIdx));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    };

    return (
        <div className="bk-sheet-backdrop" onClick={busy ? undefined : onClose}>
            <section className="bk-sheet" role="dialog" aria-label="划线给 ta 看" onClick={e => e.stopPropagation()}>
                <header><h2>划线给 ta 看</h2><button className="bk-icon" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header>
                <div className="bk-sheet-body overflow-y-auto">
                    {note ? <blockquote className="bk-quote">{note.quote}</blockquote>
                        : <textarea value={quote} onChange={e => setQuote(e.target.value)} placeholder="粘贴你划的那一句…" rows={3} />}
                    <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="想跟 ta 说什么？（可以不写）" rows={2} maxLength={500} />
                    <div className="bk-tell">
                        <small>给谁看</small>
                        <div className="bk-pick">
                            {ordered.slice(0, 12).map(c => (
                                <button key={c.id} aria-pressed={c.id === charId} onClick={() => setCharId(c.id)}><Avatar char={c} size={20} /><span>{c.name}</span>{c.id === charId && <Check size={13} weight="bold" />}</button>
                            ))}
                        </div>
                    </div>
                    <p className="bk-hint">这句和 ta 的回应都会进你们的私聊和 ta 的记忆。每次点会调用一次聊天 API。</p>
                    {reply && <div className="bk-reply"><b>{char?.name}</b><p>{reply}</p></div>}
                    {error && <p className="bk-warn">{error}</p>}
                </div>
                <footer>
                    {reply
                        ? <button className="bk-primary" onClick={onClose}>好</button>
                        : <button className="bk-primary" disabled={busy || !char || !quote.trim()} onClick={() => void ask()}>{busy ? `${char?.name || 'ta'} 正在看…` : '给 ta 看'}</button>}
                </footer>
            </section>
        </div>
    );
};

// ============ 报进度 ============

const ReportSheet: React.FC<{
    book: ShelfBook; characters: CharacterProfile[]; preset?: BookChapter; presetNote?: BookNote;
    onClose: () => void; onDone: (rec: BookroomRecord, text: string, tellIds: string[]) => Promise<void>;
}> = ({ book, characters, preset, presetNote, onClose, onDone }) => {
    const novel = book.novel!;
    const detected = useMemo(() => book.record.chapters || detectChapters(novel.segments), [novel, book.record.chapters]);
    const chapters = detected.length ? detected : fallbackSections(novel.segments.length);
    const [tab, setTab] = useState<'chapter' | 'sentence'>(presetNote ? 'sentence' : 'chapter');
    const current = book.record.progress ? chapterIndexAt(chapters, book.record.progress.segIdx) : -1;
    const [chapterIdx, setChapterIdx] = useState(() => {
        if (preset) return Math.max(0, chapters.findIndex(c => c.segIdx === preset.segIdx && c.title === preset.title));
        return Math.max(0, current);
    });
    const [sentence, setSentence] = useState(presetNote?.quote || '');
    // 从笔记来的：直接用笔记已经对好的位置
    const noteMatch = useMemo<SentenceMatch[] | null>(() => {
        if (!presetNote) return null;
        const found = locateSentence(novel.segments, presetNote.quote);
        const same = found.find(m => m.segIdx === presetNote.segIdx) || found[0];
        return same ? [same] : [];
    }, [presetNote, novel.segments]);
    const [matches, setMatches] = useState<SentenceMatch[] | null>(noteMatch);
    const [picked, setPicked] = useState<SentenceMatch | null>(noteMatch?.[0] || null);
    const [thought, setThought] = useState('');
    const [finished, setFinished] = useState(false);
    const [tell, setTell] = useState<string[]>(book.record.companionIds);
    const [busy, setBusy] = useState(false);
    const listRef = useRef<HTMLOListElement>(null);

    useEffect(() => {
        listRef.current?.querySelector('.is-picked')?.scrollIntoView({ block: 'center' });
    }, []);

    const segIdx = finished ? novel.segments.length - 1
        : tab === 'chapter' ? chapters[chapterIdx]?.segIdx ?? 0
        : picked?.segIdx;
    const canSave = segIdx != null && !busy;

    const search = () => {
        const found = locateSentence(novel.segments, sentence);
        setMatches(found);
        setPicked(found.length === 1 ? found[0] : null);
    };

    const save = async () => {
        if (segIdx == null) return;
        setBusy(true);
        try {
            const via = finished ? 'chapter' : tab;
            const entry = { segIdx, via, sentence: via === 'sentence' ? sentence.trim().slice(0, 120) : undefined, at: Date.now(), thought: thought.trim() || undefined } as const;
            const rec = applyProgress({ ...book.record, chapters: book.record.chapters || (detected.length ? detected : undefined) }, entry);
            const ci = chapterIndexAt(chapters, segIdx);
            const text = buildProgressMessage({
                bookTitle: book.title,
                chapterTitle: detected.length && ci >= 0 ? chapters[ci].title : undefined,
                ratio: progressRatio(segIdx, novel.segments.length),
                finished,
                thought,
                sentence: entry.sentence,
            });
            await onDone(rec, text, tell);
        } finally { setBusy(false); }
    };

    return (
        <div className="bk-sheet-backdrop" onClick={onClose}>
            <section className="bk-sheet" role="dialog" aria-label="报进度" onClick={e => e.stopPropagation()}>
                <header><h2>读到哪了？</h2><button className="bk-icon" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
                <nav className="bk-tabs">
                    <button aria-pressed={tab === 'chapter'} onClick={() => setTab('chapter')}>选章节</button>
                    <button aria-pressed={tab === 'sentence'} onClick={() => setTab('sentence')}>粘一句原文</button>
                </nav>
                <div className="bk-sheet-body overflow-y-auto">
                    {finished ? <p className="bk-note">记为「读完了」。</p> : tab === 'chapter' ? (
                        <ol className="bk-toc bk-toc-pick" ref={listRef}>
                            {chapters.map((c, i) => (
                                <li key={`${c.segIdx}-${i}`} className={i === chapterIdx ? 'is-picked' : i === current ? 'is-here' : ''}>
                                    <button onClick={() => setChapterIdx(i)}><span>{c.title}</span>{i === current && <em>上次</em>}{i === chapterIdx && <Check size={14} weight="bold" />}</button>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <div className="bk-sentence">
                            <p className="bk-hint">在 Reeden 里长按你停下的那句，复制，粘到这里。</p>
                            <textarea value={sentence} onChange={e => { setSentence(e.target.value); setMatches(null); setPicked(null); }} placeholder="粘贴一句原文…" rows={3} />
                            <button className="bk-secondary" disabled={sentence.trim().length < 6} onClick={search}><MagnifyingGlass size={15} /> 在书里找</button>
                            {matches && !matches.length && <p className="bk-warn">书里没找到这句。换一句长一点、没有省略的试试；或者改用「选章节」。</p>}
                            {matches && matches.length > 1 && <p className="bk-hint">找到 {matches.length} 处，点一下你停下的那处：</p>}
                            {matches?.map(m => {
                                const ci = chapterIndexAt(chapters, m.segIdx);
                                return (
                                    <button key={m.segIdx} className={`bk-match ${picked?.segIdx === m.segIdx ? 'is-picked' : ''}`} onClick={() => setPicked(m)}>
                                        <small>{ci >= 0 ? chapters[ci].title : ''} · {formatPercent(progressRatio(m.segIdx, novel.segments.length))}{m.exact ? '' : ' · 只对上了一部分'}</small>
                                        <span>{m.context}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <label className="bk-check"><input type="checkbox" checked={finished} onChange={e => setFinished(e.target.checked)} /> 我读完了这本</label>
                    <textarea className="bk-thought" value={thought} onChange={e => setThought(e.target.value)} placeholder="想说点什么？（可以不写）" rows={2} maxLength={500} />
                    {characters.length > 0 && (
                        <div className="bk-tell">
                            <small>告诉谁（会发进 ta 的私聊，进记忆）</small>
                            <div className="bk-pick">
                                {characters.filter(c => book.record.companionIds.includes(c.id) || tell.includes(c.id)).concat(characters.filter(c => !book.record.companionIds.includes(c.id) && !tell.includes(c.id))).slice(0, 12).map(c => {
                                    const on = tell.includes(c.id);
                                    return <button key={c.id} aria-pressed={on} onClick={() => setTell(t => on ? t.filter(id => id !== c.id) : [...t, c.id])}><Avatar char={c} size={20} /><span>{c.name}</span>{on && <Check size={13} weight="bold" />}</button>;
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <footer><button className="bk-primary" disabled={!canSave} onClick={() => void save()}>{busy ? '保存中…' : tell.length ? '记下，并告诉 ta' : '记下'}</button></footer>
            </section>
        </div>
    );
};

// ============ 导入 ============

const ImportSheet: React.FC<{
    records: BookroomRecord[]; onClose: () => void;
    onImported: (novelId: string) => Promise<void>; onError: (msg: string) => void;
}> = ({ records, onClose, onImported, onError }) => {
    const [title, setTitle] = useState('');
    const [author, setAuthor] = useState('');
    const [summary, setSummary] = useState('');
    const [text, setText] = useState('');
    const [toc, setToc] = useState<{ title: string; anchor: string }[]>([]);
    const [cover, setCover] = useState<string | undefined>();
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const coverRef = useRef<HTMLInputElement>(null);
    const archived = title.trim() ? findArchivedByTitle(records, title) : undefined;

    const pickFile = async (f: File) => {
        setBusy(true);
        try {
            const buf = await f.arrayBuffer();
            const baseName = f.name.replace(/\.(txt|pdf|epub)$/i, '');
            let content: string;
            let nextToc: { title: string; anchor: string }[] = [];
            if (/\.epub$/i.test(f.name) || f.type === 'application/epub+zip') {
                setStatus('正在拆开 EPUB…');
                const book = await parseEpub(buf, baseName);
                content = book.text;
                nextToc = book.toc;
                setTitle(book.title);
                if (book.author) setAuthor(book.author);
                if (book.description) setSummary(book.description);
                if (book.cover) {
                    try { setCover(await compressCover(book.cover)); } catch { /* 封面坏了不影响导入 */ }
                }
            } else if (isPdfFile(f)) {
                const result = await extractPdfText(buf, { onProgress: ({ page, totalPages }) => setStatus(`正在提取 PDF 文字… ${page}/${totalPages}`) });
                content = result.text.trim();
                if (!content) { onError('PDF 里没有可提取的文字，可能是扫描件'); return; }
            } else if (/\.txt$/i.test(f.name) || f.type.startsWith('text/')) {
                content = decodeBytes(buf).text;
            } else { onError('目前支持 .epub、.txt 和 .pdf'); return; }
            setText(content);
            setToc(nextToc);
            if (!title.trim() && !nextToc.length) setTitle(baseName);
            setStatus(`读好了，共 ${content.length.toLocaleString()} 字${nextToc.length ? `，自带目录 ${nextToc.length} 章` : ''}`);
        } catch (e) { onError(`读取失败：${e instanceof Error ? e.message : String(e)}`); setStatus(''); }
        finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
    };

    const pickCover = async (f: File) => {
        try { setCover(await compressCover(f)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
        finally { if (coverRef.current) coverRef.current.value = ''; }
    };

    const commit = async () => {
        setBusy(true);
        try {
            const novel = await buildNovelAsync(title, text, { author, summary, onProgress: r => setStatus(`切分中… ${Math.round(r * 100)}%`) });
            if (!novel.segments.length) { onError('正文是空的'); return; }
            if (archived) {
                const mapped = toc.length ? chaptersFromAnchors(novel.segments, toc) : [];
                await restoreArchivedBook(novel, archived, { chapters: mapped.length ? mapped : undefined, cover });
                await onImported(archived.novelId);
            } else {
                await DB.saveVRNovel(novel);
                await saveImportExtras(novel, { toc, cover });
                await onImported(novel.id);
            }
        } catch (e) { onError(`导入失败：${e instanceof Error ? e.message : String(e)}`); }
        finally { setBusy(false); }
    };

    return (
        <div className="bk-sheet-backdrop" onClick={onClose}>
            <section className="bk-sheet" role="dialog" aria-label="导入书" onClick={e => e.stopPropagation()}>
                <header><h2>导入一本书</h2><button className="bk-icon" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
                <div className="bk-sheet-body overflow-y-auto">
                    <p className="bk-hint">用来认目录、找句子。和 Reeden 里那本用同一个文件最准。EPUB 只取文字和封面，插图排版留在 Reeden 里看。导入后彼方书库里也会出现。</p>
                    <input ref={fileRef} type="file" accept=".epub,.txt,.pdf,application/epub+zip,text/plain,application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pickFile(f); }} />
                    <button className="bk-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>选择 EPUB / TXT / PDF 文件</button>
                    {status && <p className="bk-hint">{status}</p>}
                    <div className="bk-import-row">
                        <button className="bk-cover-pick" onClick={() => coverRef.current?.click()} aria-label={cover ? '换封面' : '上传封面'}>
                            {cover ? <img src={cover} alt="封面" /> : <span><ImageSquare size={20} /><br />封面</span>}
                        </button>
                        <input ref={coverRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pickCover(f); }} />
                        <div className="bk-import-fields">
                            <input className="bk-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="书名" />
                            <input className="bk-input" value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者（可不填）" />
                        </div>
                    </div>
                    {archived && <p className="bk-note">书房里有一本归档的《{archived.archived!.title}》，导入后会接回它的进度、目录和角色批注。</p>}
                </div>
                <footer><button className="bk-primary" disabled={busy || !text.trim() || !title.trim()} onClick={() => void commit()}>{busy ? '处理中…' : archived ? '导入并接回记录' : '放上书架'}</button></footer>
            </section>
        </div>
    );
};

export default BookroomApp;
