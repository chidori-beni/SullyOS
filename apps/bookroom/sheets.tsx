/** 书房的底部弹窗：报进度、划线给 ta 看、书评、导入。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImageSquare, MagnifyingGlass, Star, X } from '@phosphor-icons/react';
import { DB } from '../../utils/db';
import { buildNovelAsync } from '../../utils/vrWorld/novel';
import { decodeBytes } from '../../utils/vrWorld/decodeText';
import { extractPdfText, isPdfFile } from '../../utils/pdfText';
import { applyProgress, buildProgressMessage, chapterIndexAt, chaptersFromAnchors, detectChapters, fallbackSections, findArchivedByTitle, formatPercent, locateSentence, progressRatio, type BookChapter, type BookroomRecord, type SentenceMatch } from '../../utils/bookroom/bookroom';
import { restoreArchivedBook, saveImportExtras } from '../../utils/bookroom/bookroomDb';
import { parseEpub } from '../../utils/bookroom/epub';
import type { BookNote } from '../../utils/bookroom/reedenNotes';
import { compressCover } from '../../utils/bookroom/cover';
import { Avatar, Stars, type ShelfBook } from './shared';
import type { CharacterProfile } from '../../types';

// ============ 报进度 ============

export const ReportSheet: React.FC<{
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

export const HighlightSheet: React.FC<{
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

// ============ 书评 ============

export const ReviewSheet: React.FC<{
    book: ShelfBook; characters: CharacterProfile[];
    onClose: () => void;
    onSaveMine: (text: string, rating?: number) => Promise<NonNullable<BookroomRecord['reviews']>>;
    onExchange: (char: CharacterProfile, mine: { text: string; rating?: number }, savedReviews: NonNullable<BookroomRecord['reviews']>) => Promise<{ charName: string; text: string; rating?: number }>;
}> = ({ book, characters, onClose, onSaveMine, onExchange }) => {
    const prev = book.record.reviews?.user;
    const [rating, setRating] = useState<number | undefined>(prev?.rating);
    const [text, setText] = useState(prev?.text || '');
    const companions = characters.filter(c => book.record.companionIds.includes(c.id));
    const ordered = [...companions, ...characters.filter(c => !book.record.companionIds.includes(c.id))];
    const [charId, setCharId] = useState<string>(ordered[0]?.id || '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<{ charName: string; text: string; rating?: number } | null>(null);
    const char = characters.find(c => c.id === charId);

    const submit = async (exchange: boolean) => {
        if (!text.trim()) return;
        setBusy(true); setError('');
        try {
            const saved = await onSaveMine(text.trim(), rating);
            if (exchange && char) setResult(await onExchange(char, { text: text.trim(), rating }, saved));
            else onClose();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    };

    return (
        <div className="bk-sheet-backdrop" onClick={busy ? undefined : onClose}>
            <section className="bk-sheet" role="dialog" aria-label="写书评" onClick={e => e.stopPropagation()}>
                <header><h2>《{book.title}》书评</h2><button className="bk-icon" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header>
                <div className="bk-sheet-body overflow-y-auto">
                    {result ? (
                        <div className="bk-review"><div className="bk-review-head"><b>{result.charName}</b><Stars n={result.rating} size={14} /></div><p>{result.text}</p></div>
                    ) : <>
                        <div className="bk-rate">{[1, 2, 3, 4, 5].map(i => (
                            <button key={i} aria-label={`${i} 星`} onClick={() => setRating(rating === i ? undefined : i)}><Star size={26} weight={rating && i <= rating ? 'fill' : 'regular'} /></button>
                        ))}</div>
                        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="读完的感受、喜欢和不喜欢的地方……" rows={7} maxLength={3000} />
                        <div className="bk-tell">
                            <small>和谁交换（ta 会写一篇自己的，发进你们的私聊）</small>
                            <div className="bk-pick">
                                {ordered.slice(0, 12).map(c => (
                                    <button key={c.id} aria-pressed={c.id === charId} onClick={() => setCharId(c.id)}><Avatar char={c} size={20} /><span>{c.name}</span>{c.id === charId && <Check size={13} weight="bold" />}</button>
                                ))}
                            </div>
                        </div>
                        <p className="bk-hint">ta 没在彼方读完这本的话，会老实说只读到哪、只评读过的部分。交换会调用一次聊天 API。</p>
                    </>}
                    {error && <p className="bk-warn">{error}</p>}
                </div>
                <footer className="bk-footer-row">
                    {result ? <button className="bk-primary" onClick={onClose}>好</button> : <>
                        <button className="bk-secondary" disabled={busy || !text.trim()} onClick={() => void submit(false)}>只存我的</button>
                        <button className="bk-primary" disabled={busy || !text.trim() || !char} onClick={() => void submit(true)}>{busy ? `${char?.name || 'ta'} 正在写…` : '存下并交换'}</button>
                    </>}
                </footer>
            </section>
        </div>
    );
};

// ============ 导入 ============

export const ImportSheet: React.FC<{
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
