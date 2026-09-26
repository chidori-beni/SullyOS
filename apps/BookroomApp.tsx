/**
 * 书房 —— 在 Reeden 里读，回来告诉 Sully 读到了哪。
 *
 * 书与角色书签沿用彼方书库（同一个书架），书房只管「你的那一半」：
 * 报进度（选章节 / 粘一句原文）、看你和角色各读到哪、把进度发进角色私聊进记忆、
 * 归档（只删正文，记录全留）。逻辑见 utils/bookroom/。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Archive, BookOpenText, Check, ListBullets, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import TokenImg from '../components/os/TokenImg';
import type { CharacterProfile, VRWorldNovel } from '../types';
import { buildNovelAsync } from '../utils/vrWorld/novel';
import { decodeBytes } from '../utils/vrWorld/decodeText';
import { extractPdfText, isPdfFile } from '../utils/pdfText';
import {
    applyProgress, buildProgressMessage, chapterIndexAt, detectChapters, emptyRecord, fallbackSections,
    findArchivedByTitle, formatPercent, locateSentence, progressRatio, unfinishedReaders,
    type BookChapter, type BookroomRecord, type SentenceMatch,
} from '../utils/bookroom/bookroom';
import { archiveBook, listBookroomRecords, restoreArchivedBook, saveBookroomRecord, sendProgressToCharacters } from '../utils/bookroom/bookroomDb';
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

const Bar: React.FC<{ ratio: number; tone?: 'me' | 'char' }> = ({ ratio, tone = 'me' }) => (
    <span className={`bk-bar bk-bar-${tone}`}><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
);

const BookroomApp: React.FC = () => {
    const { closeApp, characters, apiConfig, memoryPalaceConfig, userProfile, addToast, registerBackHandler } = useOS();
    const [novels, setNovels] = useState<VRWorldNovel[]>([]);
    const [records, setRecords] = useState<BookroomRecord[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [reporting, setReporting] = useState<{ preset?: BookChapter } | null>(null);
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
        if (reporting) { setReporting(null); return true; }
        if (importing) { setImporting(false); return true; }
        if (openId) { setOpenId(null); return true; }
        return false;
    }), [registerBackHandler, reporting, importing, openId]);

    const saveRecord = async (rec: BookroomRecord) => {
        await saveBookroomRecord(rec);
        setRecords(rs => [...rs.filter(r => r.novelId !== rec.novelId), rec]);
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
                    <main className="bk-scroll">
                        <p className="bk-lead">在 Reeden 里读，回来告诉 {characters.length === 1 ? characters[0].name : 'ta'} 你读到了哪。书架和彼方书库是同一个。</p>
                        {loaded && !books.length && <div className="bk-empty"><BookOpenText size={36} weight="thin" /><p>书架还空着。<br />点右上角「+」导入一本 TXT / PDF。</p></div>}
                        <div className="bk-shelf">
                            {books.map(b => {
                                const me = b.record.progress ? progressRatio(b.record.progress.segIdx, b.segCount) : null;
                                const readers = characters.filter(c => charRatio(c, b) != null || b.record.companionIds.includes(c.id));
                                return (
                                    <button key={b.novelId} className={`bk-book ${b.record.archived ? 'is-archived' : ''}`} onClick={() => setOpenId(b.novelId)}>
                                        <span className="bk-spine" aria-hidden>{b.title.slice(0, 1)}</span>
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
                />
            )}

            {book && reporting && (
                <ReportSheet
                    book={book} characters={characters} preset={reporting.preset}
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
    onSave: (rec: BookroomRecord) => Promise<void>; onArchive: () => void;
}> = ({ book, characters, onBack, onReport, onSave, onArchive }) => {
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
            <main className="bk-scroll">
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
            </main>
        </>
    );
};

// ============ 报进度 ============

const ReportSheet: React.FC<{
    book: ShelfBook; characters: CharacterProfile[]; preset?: BookChapter;
    onClose: () => void; onDone: (rec: BookroomRecord, text: string, tellIds: string[]) => Promise<void>;
}> = ({ book, characters, preset, onClose, onDone }) => {
    const novel = book.novel!;
    const detected = useMemo(() => detectChapters(novel.segments), [novel]);
    const chapters = detected.length ? detected : fallbackSections(novel.segments.length);
    const [tab, setTab] = useState<'chapter' | 'sentence'>('chapter');
    const current = book.record.progress ? chapterIndexAt(chapters, book.record.progress.segIdx) : -1;
    const [chapterIdx, setChapterIdx] = useState(() => {
        if (preset) return Math.max(0, chapters.findIndex(c => c.segIdx === preset.segIdx && c.title === preset.title));
        return Math.max(0, current);
    });
    const [sentence, setSentence] = useState('');
    const [matches, setMatches] = useState<SentenceMatch[] | null>(null);
    const [picked, setPicked] = useState<SentenceMatch | null>(null);
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
                <div className="bk-sheet-body">
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
    const [text, setText] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const archived = title.trim() ? findArchivedByTitle(records, title) : undefined;

    const pickFile = async (f: File) => {
        setBusy(true);
        try {
            const buf = await f.arrayBuffer();
            let content: string;
            if (isPdfFile(f)) {
                const result = await extractPdfText(buf, { onProgress: ({ page, totalPages }) => setStatus(`正在提取 PDF 文字… ${page}/${totalPages}`) });
                content = result.text.trim();
                if (!content) { onError('PDF 里没有可提取的文字，可能是扫描件'); return; }
            } else if (/\.txt$/i.test(f.name) || f.type.startsWith('text/')) {
                content = decodeBytes(buf).text;
            } else { onError('目前只支持 .txt 和 .pdf'); return; }
            setText(content);
            if (!title.trim()) setTitle(f.name.replace(/\.(txt|pdf)$/i, ''));
            setStatus(`读好了，共 ${content.length.toLocaleString()} 字`);
        } catch (e) { onError(`读取失败：${e instanceof Error ? e.message : String(e)}`); }
        finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
    };

    const commit = async () => {
        setBusy(true);
        try {
            const novel = await buildNovelAsync(title, text, { author, onProgress: r => setStatus(`切分中… ${Math.round(r * 100)}%`) });
            if (!novel.segments.length) { onError('正文是空的'); return; }
            if (archived) {
                await restoreArchivedBook(novel, archived);
                await onImported(archived.novelId);
            } else {
                await DB.saveVRNovel(novel);
                await onImported(novel.id);
            }
        } catch (e) { onError(`导入失败：${e instanceof Error ? e.message : String(e)}`); }
        finally { setBusy(false); }
    };

    return (
        <div className="bk-sheet-backdrop" onClick={onClose}>
            <section className="bk-sheet" role="dialog" aria-label="导入书" onClick={e => e.stopPropagation()}>
                <header><h2>导入一本书</h2><button className="bk-icon" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
                <div className="bk-sheet-body">
                    <p className="bk-hint">用来认目录、找句子。和 Reeden 里那本用同一个文件最准。导入后彼方书库里也会出现。</p>
                    <input ref={fileRef} type="file" accept=".txt,.pdf,text/plain,application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pickFile(f); }} />
                    <button className="bk-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>选择 TXT / PDF 文件</button>
                    {status && <p className="bk-hint">{status}</p>}
                    <input className="bk-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="书名" />
                    <input className="bk-input" value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者（可不填）" />
                    {archived && <p className="bk-note">书房里有一本归档的《{archived.archived!.title}》，导入后会接回它的进度、目录和角色批注。</p>}
                </div>
                <footer><button className="bk-primary" disabled={busy || !text.trim() || !title.trim()} onClick={() => void commit()}>{busy ? '处理中…' : archived ? '导入并接回记录' : '放上书架'}</button></footer>
            </section>
        </div>
    );
};

export default BookroomApp;
