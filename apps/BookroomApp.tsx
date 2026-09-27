/**
 * 书房 —— 在 Reeden 里读，回来告诉 Sully 读到了哪。
 *
 * 书与角色书签沿用彼方书库（同一个书架），书房只管「你的那一半」：
 * 报进度（选章节 / 粘一句原文）、看你和角色各读到哪、把进度发进角色私聊进记忆、
 * 归档（只删正文，记录全留）。逻辑见 utils/bookroom/。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Archive, ArrowSquareOut, BookOpenText, CalendarCheck, CaretRight, ChatCircleText, Check, FileArrowUp, Highlighter, ImageSquare, ListBullets, MagnifyingGlass, NotePencil, Plus, Sparkle, Star, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import TokenImg from '../components/os/TokenImg';
import type { CharacterProfile, VRNovelAnnotation, VRWorldNovel } from '../types';
import { readingPreferenceLabel } from '../utils/vrWorld/library';
import { stripLeakedAttrs } from '../utils/vrWorld/prompts';
import { buildNovelAsync } from '../utils/vrWorld/novel';
import { decodeBytes } from '../utils/vrWorld/decodeText';
import { extractPdfText, isPdfFile } from '../utils/pdfText';
import {
    applyProgress, buildProgressMessage, chapterIndexAt, chaptersFromAnchors, detectChapters, emptyRecord, fallbackSections,
    findArchivedByTitle, formatPercent, locateSentence, progressRatio, unfinishedReaders,
    type BookChapter, type BookroomRecord, type SentenceMatch,
} from '../utils/bookroom/bookroom';
import { archiveBook, deleteBookCompletely, getBookroomMeta, listBookroomRecords, restoreArchivedBook, saveBookroomMeta, saveBookroomRecord, saveImportExtras, sendProgressToCharacters } from '../utils/bookroom/bookroomDb';
import { parseEpub } from '../utils/bookroom/epub';
import { mergeNotes, parseReedenNotes, placeNotes, suggestProgressFromNotes, titleFromCsvName, type BookNote } from '../utils/bookroom/reedenNotes';
import { askCharacterAboutHighlight, askCharacterInBookroom, buildHighlightMessage, RECOMMEND_INSTRUCTION, REVIEW_INSTRUCTION, YEAR_LETTER_INSTRUCTION } from '../utils/bookroom/highlightReply';
import { dateKey, monthGrid, parseRatedReview, parseRecommendation, readingDays, streakDays, yearSummary, emptyMeta, type BookRecommendation, type BookroomMeta } from '../utils/bookroom/stats';
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
    // 角色书单：看某个角色在读哪些书、读到哪、留过什么话
    const [charView, setCharView] = useState<string | null>(null);
    // 三期：打卡 / 荐书 / 年度寄语的全局记录，书评弹窗，年度书单页
    const [meta, setMeta] = useState<BookroomMeta>(emptyMeta);
    const [reviewing, setReviewing] = useState(false);
    const [yearView, setYearView] = useState<number | null>(null);

    const reload = useCallback(async () => {
        const [n, r, m] = await Promise.all([DB.getVRNovels(), listBookroomRecords(), getBookroomMeta().catch(() => emptyMeta())]);
        setNovels(n); setRecords(r); setMeta(m); setLoaded(true);
    }, []);
    const saveMeta = async (next: BookroomMeta) => { await saveBookroomMeta(next); setMeta(next); };
    // 请角色说点什么（书评 / 荐书 / 年度寄语）：统一走书房的共用流程
    const ask = (char: CharacterProfile, req: { message: string; instruction: string; kind: string; purpose: string; novelId?: string }) =>
        askCharacterInBookroom({ char, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig, ...req });
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
        if (reviewing) { setReviewing(false); return true; }
        if (highlighting) { setHighlighting(null); return true; }
        if (reporting) { setReporting(null); return true; }
        if (importing) { setImporting(false); return true; }
        if (openId) { setOpenId(null); return true; }
        if (charView) { setCharView(null); return true; }
        if (yearView) { setYearView(null); return true; }
        return false;
    }), [registerBackHandler, reviewing, highlighting, reporting, importing, openId, charView, yearView]);
    const viewedChar = characters.find(c => c.id === charView) || null;
    // 「谁在读」：在书架上任何一本书有彼方书签、或被设成一起读的人
    const bookReaders = characters
        .map(c => ({ char: c, count: books.filter(b => charRatio(c, b) != null || b.record.companionIds.includes(c.id)).length }))
        .filter(x => x.count > 0);

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
            {!book && viewedChar ? (
                <CharacterShelf char={viewedChar} books={books} onBack={() => setCharView(null)} onOpenBook={setOpenId}
                    recommendations={meta.recommendations.filter(r => r.charId === viewedChar.id)}
                    onRecommend={async () => {
                        const userName = userProfile?.name || '用户';
                        const reply = await ask(viewedChar, { message: '【书房 · 荐书】给我推荐一本书吧，想看看你会选什么。', instruction: RECOMMEND_INSTRUCTION(userName), kind: 'recommend', purpose: '荐书' });
                        const parsed = parseRecommendation(reply);
                        if (!parsed) throw new Error(`ta 回复了，但没看出推荐的是哪本书：${reply.slice(0, 80)}`);
                        const rec: BookRecommendation = { id: `rec${Date.now().toString(36)}`, charId: viewedChar.id, charName: viewedChar.name, ...parsed, at: Date.now() };
                        await saveMeta({ ...meta, recommendations: [...meta.recommendations, rec] });
                    }}
                    onRecStatus={(id, status) => void saveMeta({ ...meta, recommendations: meta.recommendations.map(r => r.id === id ? { ...r, status: r.status === status ? undefined : status } : r) })}
                    onRecDelete={id => void saveMeta({ ...meta, recommendations: meta.recommendations.filter(r => r.id !== id) })}
                />
            ) : !book && yearView ? (
                <YearView year={yearView} records={records} meta={meta} characters={characters} onBack={() => setYearView(null)} onYear={setYearView} onOpenBook={setOpenId}
                    onLetter={async (char, summaryText) => {
                        const reply = await ask(char, { message: summaryText, instruction: YEAR_LETTER_INSTRUCTION(userProfile?.name || '用户', yearView), kind: 'year-letter', purpose: '年度寄语' });
                        const letter = { year: yearView, charId: char.id, charName: char.name, text: reply, at: Date.now() };
                        await saveMeta({ ...meta, yearLetters: [...meta.yearLetters.filter(l => !(l.year === yearView && l.charId === char.id)), letter] });
                    }}
                />
            ) : !book ? (
                <>
                    <header className="bk-top">
                        <button className="bk-icon" onClick={closeApp} aria-label="返回"><ArrowLeft size={20} /></button>
                        <div className="bk-top-title"><small>BOOKROOM</small><h1>书房</h1></div>
                        <button className="bk-icon" onClick={() => setImporting(true)} aria-label="导入书"><Plus size={20} /></button>
                    </header>
                    <main className="bk-scroll overflow-y-auto">
                        <p className="bk-lead">在 Reeden 里读，回来告诉 {characters.length === 1 ? characters[0].name : 'ta'} 你读到了哪。书架和彼方书库是同一个。</p>
                        {loaded && books.length > 0 && (
                            <CheckinCard records={records} meta={meta}
                                onCheckin={() => void saveMeta({ ...meta, checkins: [...new Set([...meta.checkins, dateKey(Date.now())])] })}
                                onYear={() => setYearView(new Date().getFullYear())} />
                        )}
                        {bookReaders.length > 0 && (
                            <div className="bk-who">
                                <small>谁在读 · 点开看 ta 的书单</small>
                                <div className="bk-who-row">
                                    {bookReaders.map(({ char, count }) => (
                                        <button key={char.id} onClick={() => setCharView(char.id)}>
                                            <Avatar char={char} size={44} />
                                            <span>{char.name}</span>
                                            <em>{count} 本</em>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
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
                    onReview={() => setReviewing(true)}
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
                        const finishedNow = rec.progress && rec.progress.segIdx >= book.segCount - 1;
                        if (finishedNow && !rec.reviews?.user && window.confirm(`读完《${book.title}》啦！要写一篇书评，和 ta 交换吗？`)) setReviewing(true);
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

            {book && reviewing && (
                <ReviewSheet
                    book={book} characters={characters}
                    onClose={() => setReviewing(false)}
                    onSaveMine={async (text, rating) => {
                        const reviews = { ...(book.record.reviews || {}), user: { text, rating, at: Date.now() } };
                        await saveRecord({ ...book.record, reviews, updatedAt: Date.now() });
                        return reviews;
                    }}
                    onExchange={async (char, mine, savedReviews) => {
                        const bm = char.vrState?.novelBookmarks?.[book.novelId];
                        const hasRead = bm != null && bm > 0;
                        const hasFinished = hasRead && bm! >= book.segCount;
                        const message = `【书房 · 书评】我读完了《${book.title}》${mine.rating ? `，给它 ${mine.rating} 星` : ''}：\n${mine.text}\n\n你也写一篇吧，我们交换看看。`;
                        const reply = await ask(char, { message, instruction: REVIEW_INSTRUCTION(userProfile?.name || '用户', hasFinished, hasRead), kind: 'review', purpose: '交换书评', novelId: book.novelId });
                        const parsed = parseRatedReview(reply);
                        const charReview = { charId: char.id, charName: char.name, text: parsed.text, rating: parsed.rating, at: Date.now() };
                        // 用刚存好的那份书评做底，别用渲染时的旧记录（不然会把刚写的「我的书评」盖掉）
                        const reviews = { ...savedReviews, chars: [...(savedReviews.chars || []).filter(r => r.charId !== char.id), charReview] };
                        await saveRecord({ ...book.record, reviews, updatedAt: Date.now() });
                        return charReview;
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

// ============ 打卡 ============

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

const CheckinCard: React.FC<{ records: BookroomRecord[]; meta: BookroomMeta; onCheckin: () => void; onYear: () => void }> = ({ records, meta, onCheckin, onYear }) => {
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

const Stars: React.FC<{ n?: number; size?: number }> = ({ n, size = 12 }) => n ? (
    <span className="bk-stars" aria-label={`${n} 星`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} weight={i <= n ? 'fill' : 'regular'} />)}</span>
) : null;

const YearView: React.FC<{
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

// ============ 书评 ============

const ReviewsCard: React.FC<{ book: ShelfBook; onReview: () => void }> = ({ book, onReview }) => {
    const mine = book.record.reviews?.user;
    const theirs = book.record.reviews?.chars || [];
    return (
        <section className="bk-card">
            <div className="bk-card-head"><h2><NotePencil size={16} /> 书评</h2>{(mine || theirs.length > 0) && <button onClick={onReview}>{mine ? '改 / 交换' : '写书评'}</button>}</div>
            {!mine && !theirs.length && <>
                <p className="bk-hint">读完以后写一篇，再请 ta 也写一篇，两篇并排放在这里。</p>
                <button className="bk-secondary" style={{ marginTop: 8 }} onClick={onReview}><NotePencil size={15} /> 写书评</button>
            </>}
            {mine && <div className="bk-review is-mine"><div className="bk-review-head"><b>我</b><Stars n={mine.rating} /></div><p>{mine.text}</p></div>}
            {theirs.map(r => <div key={r.charId} className="bk-review"><div className="bk-review-head"><b>{r.charName}</b><Stars n={r.rating} /></div><p>{r.text}</p></div>)}
        </section>
    );
};

const ReviewSheet: React.FC<{
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

// ============ 角色书单 ============

interface CharTrace { key: string; at: number; bookId: string; bookTitle: string; quote: string; content: string; kind: '批注' | '回应' }

const CharacterShelf: React.FC<{
    char: CharacterProfile; books: ShelfBook[];
    onBack: () => void; onOpenBook: (novelId: string) => void;
    recommendations: BookRecommendation[];
    onRecommend: () => Promise<void>;
    onRecStatus: (id: string, status: 'want' | 'read' | 'pass') => void;
    onRecDelete: (id: string) => void;
}> = ({ char, books, onBack, onOpenBook, recommendations, onRecommend, onRecStatus, onRecDelete }) => {
    const [recBusy, setRecBusy] = useState(false);
    const [recError, setRecError] = useState('');
    const [annotations, setAnnotations] = useState<VRNovelAnnotation[] | null>(null);
    const [showAll, setShowAll] = useState(false);
    useEffect(() => {
        let alive = true;
        void DB.getVRAnnotations().then(all => { if (alive) setAnnotations(all.filter(a => a.authorId === char.id)); }).catch(() => { if (alive) setAnnotations([]); });
        return () => { alive = false; };
    }, [char.id]);

    const rows = books
        .map(b => ({ book: b, ratio: charRatio(char, b), companion: b.record.companionIds.includes(char.id) }))
        .filter(x => x.ratio != null || x.companion);
    const reading = rows.filter(x => x.ratio != null && x.ratio < 1).sort((a, b) => b.ratio! - a.ratio!);
    const finished = rows.filter(x => x.ratio != null && x.ratio >= 1);
    const notYet = rows.filter(x => x.ratio == null);

    // ta 留下的话：彼方书页边的批注 + 书房里对你划线的回应，按时间倒序
    const traces: CharTrace[] = [];
    for (const a of annotations || []) {
        const b = books.find(x => x.novelId === a.novelId);
        if (!b) continue;
        const quote = b.novel?.segments[a.segIdx]?.text.slice(0, 50).replace(/\s+/g, ' ') || b.record.archived?.annotationQuotes[a.id] || '';
        traces.push({ key: `a-${a.id}`, at: a.createdAt, bookId: b.novelId, bookTitle: b.title, quote, content: stripLeakedAttrs(a.content), kind: '批注' });
    }
    for (const b of books) {
        for (const n of b.record.notes || []) {
            for (const r of n.replies || []) {
                if (r.charId === char.id) traces.push({ key: `r-${n.id}-${r.at}`, at: r.at, bookId: b.novelId, bookTitle: b.title, quote: n.quote.slice(0, 50), content: r.content, kind: '回应' });
            }
        }
    }
    traces.sort((a, b) => b.at - a.at);
    const shownTraces = showAll ? traces : traces.slice(0, 8);

    const BookRow = ({ book, ratio }: { book: ShelfBook; ratio: number | null }) => {
        const chapters = book.record.chapters || (book.novel ? detectChapters(book.novel.segments) : []);
        const bm = char.vrState?.novelBookmarks?.[book.novelId];
        const ch = bm != null && bm > 0 ? chapterIndexAt(chapters, bm - 1) : -1;
        const me = book.record.progress ? progressRatio(book.record.progress.segIdx, book.segCount) : null;
        return (
            <button className="bk-book" onClick={() => onOpenBook(book.novelId)}>
                <Cover title={book.title} cover={book.record.cover} archived={!!book.record.archived} />
                <span className="bk-book-body">
                    <strong>{book.title}</strong>
                    <small>{ratio == null ? '还没在彼方翻开 · 和你一起读' : ratio >= 1 ? '读完了' : ch >= 0 ? chapters[ch].title : '已开始'}</small>
                    <span className="bk-mini-row"><em>ta</em><Bar ratio={ratio ?? 0} tone="char" /><em>{ratio == null ? '—' : formatPercent(ratio)}</em></span>
                    <span className="bk-mini-row"><em>我</em><Bar ratio={me ?? 0} /><em>{me == null ? '未开始' : formatPercent(me)}</em></span>
                </span>
            </button>
        );
    };

    return (
        <>
            <header className="bk-top">
                <button className="bk-icon" onClick={onBack} aria-label="返回书架"><ArrowLeft size={20} /></button>
                <div className="bk-top-title"><small>READING LIST</small><h1>{char.name} 的书单</h1></div>
                <span className="bk-icon" />
            </header>
            <main className="bk-scroll overflow-y-auto">
                <section className="bk-char-hero">
                    <Avatar char={char} size={56} />
                    <div>
                        <p className="bk-char-stats"><b>{reading.length}</b> 在读 · <b>{finished.length}</b> 读完 · <b>{traces.length}</b> 条留言</p>
                        <p className="bk-hint">彼方里的阅读方式：{readingPreferenceLabel(char)}{char.vrState?.enabled ? '' : ' · 还没接入彼方，不会自己去读书'}</p>
                    </div>
                </section>

                {reading.length > 0 && <><h3 className="bk-section">在读</h3><div className="bk-shelf">{reading.map(x => <BookRow key={x.book.novelId} book={x.book} ratio={x.ratio} />)}</div></>}
                {finished.length > 0 && <><h3 className="bk-section">读完了</h3><div className="bk-shelf">{finished.map(x => <BookRow key={x.book.novelId} book={x.book} ratio={x.ratio} />)}</div></>}
                {notYet.length > 0 && <><h3 className="bk-section">约好一起读、还没翻开</h3><div className="bk-shelf">{notYet.map(x => <BookRow key={x.book.novelId} book={x.book} ratio={null} />)}</div></>}
                {!rows.length && <p className="bk-empty">{char.name} 还没读过书架上的书。</p>}

                <h3 className="bk-section">{char.name} 推荐的书</h3>
                <section className="bk-card">
                    {!recommendations.length && <p className="bk-hint" style={{ marginTop: 0 }}>请 ta 按自己的口味和对你的了解推荐一本。推荐会发进你们的私聊。</p>}
                    <ul className="bk-recs">
                        {[...recommendations].reverse().map(r => (
                            <li key={r.id} className={r.status === 'pass' ? 'is-pass' : ''}>
                                <strong>《{r.title}》</strong>{r.author && <small> {r.author}</small>}
                                <p>{r.reason}</p>
                                <div className="bk-note-foot">
                                    {(['want', 'read', 'pass'] as const).map(st => (
                                        <button key={st} aria-pressed={r.status === st} onClick={() => onRecStatus(r.id, st)}>{{ want: '想读', read: '读过了', pass: '不感兴趣' }[st]}</button>
                                    ))}
                                    <button onClick={() => { if (window.confirm('删掉这条推荐？')) onRecDelete(r.id); }}>删除</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    {recError && <p className="bk-warn">{recError}</p>}
                    <button className="bk-secondary" style={{ marginTop: 8 }} disabled={recBusy} onClick={async () => {
                        setRecBusy(true); setRecError('');
                        try { await onRecommend(); } catch (e) { setRecError(e instanceof Error ? e.message : String(e)); }
                        finally { setRecBusy(false); }
                    }}><Sparkle size={15} /> {recBusy ? `${char.name} 正在想…` : `请 ${char.name} 推荐一本`}</button>
                </section>

                <h3 className="bk-section">{char.name} 留下的话</h3>
                {annotations == null ? <p className="bk-hint">读取中…</p> : !traces.length ? <p className="bk-hint">还没有。ta 在彼方读书时会在页边写批注，你在书房划线给 ta 看时 ta 的回应也会记在这里。</p> : (
                    <ul className="bk-notes">
                        {shownTraces.map(t => (
                            <li key={t.key} className="bk-note-item bk-trace" onClick={() => onOpenBook(t.bookId)}>
                                <small>《{t.bookTitle}》 · {t.kind} · {new Date(t.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</small>
                                {t.quote && <blockquote>{t.quote}{t.quote.length >= 50 ? '…' : ''}</blockquote>}
                                <p className="bk-note-reply"><b>{char.name}</b>：{t.content}</p>
                            </li>
                        ))}
                    </ul>
                )}
                {traces.length > 8 && <button className="bk-more" onClick={() => setShowAll(v => !v)}>{showAll ? '收起' : `展开全部 ${traces.length} 条`}</button>}
            </main>
        </>
    );
};

// ============ 一本书 ============

const BookDetail: React.FC<{
    book: ShelfBook; characters: CharacterProfile[];
    onBack: () => void; onReport: (preset?: BookChapter) => void;
    onSave: (rec: BookroomRecord) => Promise<void>; onArchive: () => void; onDelete: () => void;
    onReportAtNote: (note: BookNote) => void; onHighlight: (note?: BookNote) => void; onReview: () => void;
    onError: (msg: string) => void; onInfo: (msg: string) => void;
}> = ({ book, characters, onBack, onReport, onSave, onArchive, onDelete, onReportAtNote, onHighlight, onReview, onError, onInfo }) => {
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

                <ReviewsCard book={book} onReview={onReview} />

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
