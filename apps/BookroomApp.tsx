/**
 * 书房 —— 在 Reeden 里读，回来告诉 Sully 读到了哪；也能在这里直接翻书。
 *
 * 书与角色书签沿用彼方书库（同一个书架）。页面拆在 apps/bookroom/ 里：
 *   HomeTabs（书架 / 笔记 / 书友 / 足迹）· BookDetail（一本书，分五个小标签）· CharacterShelf（角色书单）
 *   Footprints（打卡 / 年度书单）· sheets（报进度 / 划线 / 书评 / 导入）· BookParts · shared
 * 阅读器与彼方共用 components/reader/NovelReader。逻辑见 utils/bookroom/。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Books, CalendarCheck, Highlighter, Plus, UsersThree } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import type { CharacterProfile, VRLibraryCategory, VRWorldNovel } from '../types';
import { detectChapters, emptyRecord, unfinishedReaders, type BookChapter, type BookroomRecord } from '../utils/bookroom/bookroom';
import { archiveBook, deleteBookCompletely, getBookroomMeta, listBookroomRecords, saveBookroomMeta, saveBookroomRecord, sendProgressToCharacters } from '../utils/bookroom/bookroomDb';
import type { BookNote } from '../utils/bookroom/reedenNotes';
import { askCharacterAboutHighlight, askCharacterInBookroom, buildHighlightMessage, RECOMMEND_INSTRUCTION, REVIEW_INSTRUCTION, YEAR_LETTER_INSTRUCTION } from '../utils/bookroom/highlightReply';
import { dateKey, emptyMeta, parseRatedReview, parseRecommendation, type BookRecommendation, type BookroomMeta } from '../utils/bookroom/stats';
import { NovelReader } from '../components/reader/NovelReader';
import type { ShelfBook } from './bookroom/shared';
import { BookDetail, type BookTab } from './bookroom/BookDetail';
import { CharacterShelf } from './bookroom/CharacterShelf';
import { YearView } from './bookroom/Footprints';
import { FriendsView, MeView, NotesHub, ShelfView } from './bookroom/HomeTabs';
import { HighlightSheet, ImportSheet, ReportSheet, ReviewSheet } from './bookroom/sheets';
import './bookroom/bookroom.css';

type HomeTab = 'shelf' | 'notes' | 'friends' | 'me';
const HOME_TAB_KEY = 'bookroom_home_tab';
const HOME_TABS: { id: HomeTab; label: string; icon: React.ReactNode; title: string }[] = [
    { id: 'shelf', label: '书架', icon: <Books size={21} />, title: '书房' },
    { id: 'notes', label: '笔记', icon: <Highlighter size={21} />, title: '笔记' },
    { id: 'friends', label: '书友', icon: <UsersThree size={21} />, title: '书友' },
    { id: 'me', label: '足迹', icon: <CalendarCheck size={21} />, title: '足迹' },
];

const BookroomApp: React.FC = () => {
    const { closeApp, characters, updateCharacter, apiConfig, memoryPalaceConfig, userProfile, groups, realtimeConfig, addToast, registerBackHandler } = useOS();
    const [novels, setNovels] = useState<VRWorldNovel[]>([]);
    const [records, setRecords] = useState<BookroomRecord[]>([]);
    const [categories, setCategories] = useState<VRLibraryCategory[]>([]);
    const [meta, setMeta] = useState<BookroomMeta>(emptyMeta);
    const [loaded, setLoaded] = useState(false);

    // 页面：首页标签 → 一本书 / 角色书单 / 年度书单；阅读器盖在最上面
    const [homeTab, setHomeTab] = useState<HomeTab>(() => { try { return (localStorage.getItem(HOME_TAB_KEY) as HomeTab) || 'shelf'; } catch { return 'shelf'; } });
    const [openId, setOpenId] = useState<string | null>(null);
    const [bookTab, setBookTab] = useState<BookTab>('progress');
    const [charView, setCharView] = useState<string | null>(null);
    const [yearView, setYearView] = useState<number | null>(null);
    const [reading, setReading] = useState<{ novelId: string; seg?: number; peek?: boolean } | null>(null);
    // 弹窗
    const [reporting, setReporting] = useState<{ preset?: BookChapter; note?: BookNote } | null>(null);
    const [highlighting, setHighlighting] = useState<{ note?: BookNote } | null>(null);
    const [reviewing, setReviewing] = useState(false);
    const [importing, setImporting] = useState(false);

    const reload = useCallback(async () => {
        const [n, r, m, c] = await Promise.all([
            DB.getVRNovels(), listBookroomRecords(),
            getBookroomMeta().catch(() => emptyMeta()),
            DB.getVRLibraryCategories().catch(() => []),
        ]);
        setNovels(n); setRecords(r); setMeta(m); setCategories(c); setLoaded(true);
    }, []);
    useEffect(() => { void reload(); }, [reload]);
    const switchHome = (t: HomeTab) => { setHomeTab(t); try { localStorage.setItem(HOME_TAB_KEY, t); } catch { /* ignore */ } };

    const saveMeta = async (next: BookroomMeta) => { await saveBookroomMeta(next); setMeta(next); };
    // 请角色说点什么（书评 / 荐书 / 年度寄语）：统一走书房的共用流程
    const ask = (char: CharacterProfile, req: { message: string; instruction: string; kind: string; purpose: string; novelId?: string }) =>
        askCharacterInBookroom({ char, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig, ...req });

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
    const viewedChar = characters.find(c => c.id === charView) || null;
    const readerNovel = reading ? novels.find(n => n.id === reading.novelId) : undefined;

    const openBook = (id: string, tab: BookTab = 'progress') => { setOpenId(id); setBookTab(tab); };
    const openReader = (novelId: string, seg?: number, peek?: boolean) => setReading({ novelId, seg, peek });

    useEffect(() => registerBackHandler(() => {
        if (reading) { setReading(null); return true; }
        if (reviewing) { setReviewing(false); return true; }
        if (highlighting) { setHighlighting(null); return true; }
        if (reporting) { setReporting(null); return true; }
        if (importing) { setImporting(false); return true; }
        if (openId) { setOpenId(null); return true; }
        if (charView) { setCharView(null); return true; }
        if (yearView) { setYearView(null); return true; }
        return false;
    }), [registerBackHandler, reading, reviewing, highlighting, reporting, importing, openId, charView, yearView]);

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

    /** 改角色在某本书（或全部书）上的彼方书签；undefined = 清掉 */
    const setBookmark = (char: CharacterProfile, novelId: string | null, value?: number) => {
        updateCharacter(char.id, latest => {
            const base = latest.vrState || { enabled: false, intervalMinutes: 120 };
            if (novelId == null) return { vrState: { ...base, novelBookmarks: {}, lastNovelId: undefined } };
            const bms = { ...(base.novelBookmarks || {}) };
            if (value == null) delete bms[novelId]; else bms[novelId] = value;
            return { vrState: { ...base, novelBookmarks: bms } };
        });
    };

    // ============ 子页面 ============

    let page: React.ReactNode;
    if (book) {
        page = (
            <BookDetail
                book={book} characters={characters} tab={bookTab} onTab={setBookTab}
                onBack={() => setOpenId(null)}
                onRead={(seg, peek) => openReader(book.novelId, seg, peek)}
                onReport={preset => setReporting({ preset })}
                onReportAtNote={note => setReporting({ note })}
                onReview={() => setReviewing(true)}
                onHighlight={note => setHighlighting({ note })}
                onError={msg => addToast(msg, 'error')}
                onInfo={msg => addToast(msg, 'success')}
                onSave={saveRecord}
                onPullBack={char => {
                    const userSeg = book.record.progress?.segIdx;
                    if (userSeg == null) return;
                    if (!window.confirm(`把 ${char.name} 在《${book.title}》的书签挪回到你的位置？\n\nta 之前写的批注都还在；之后 ta 会从你这里接着读，最多读到你这一章的结尾。`)) return;
                    setBookmark(char, book.novelId, userSeg);
                    addToast(`${char.name} 的书签已挪回你的位置`, 'success');
                }}
                onClearBookmark={char => {
                    if (!window.confirm(`清空 ${char.name} 在《${book.title}》的阅读进度？\n\nta 下次会从头读这本；批注不受影响（要删批注去「批注」页）。`)) return;
                    setBookmark(char, book.novelId, undefined);
                    addToast(`已清空 ${char.name} 在这本书的进度`, 'success');
                }}
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
        );
    } else if (viewedChar) {
        page = (
            <CharacterShelf
                char={viewedChar} books={books}
                onBack={() => setCharView(null)}
                onOpenBook={id => openBook(id)}
                onRead={(novelId, seg) => openReader(novelId, seg, true)}
                onSaveRecord={saveRecord}
                onClearAll={async alsoAnnotations => {
                    setBookmark(viewedChar, null);
                    if (alsoAnnotations) {
                        const mine = (await DB.getVRAnnotations()).filter(a => a.authorId === viewedChar.id);
                        for (const a of mine) await DB.deleteVRAnnotation(a.id);
                    }
                    addToast(alsoAnnotations ? `已清空 ${viewedChar.name} 的阅读记录和批注` : `已清空 ${viewedChar.name} 的阅读记录`, 'success');
                }}
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
        );
    } else if (yearView) {
        page = (
            <YearView year={yearView} records={records} meta={meta} characters={characters} onBack={() => setYearView(null)} onYear={setYearView} onOpenBook={id => openBook(id)}
                onLetter={async (char, summaryText) => {
                    const reply = await ask(char, { message: summaryText, instruction: YEAR_LETTER_INSTRUCTION(userProfile?.name || '用户', yearView), kind: 'year-letter', purpose: '年度寄语' });
                    const letter = { year: yearView, charId: char.id, charName: char.name, text: reply, at: Date.now() };
                    await saveMeta({ ...meta, yearLetters: [...meta.yearLetters.filter(l => !(l.year === yearView && l.charId === char.id)), letter] });
                }}
            />
        );
    } else {
        const current = HOME_TABS.find(t => t.id === homeTab)!;
        page = (
            <>
                <header className="bk-top">
                    <button className="bk-icon" onClick={closeApp} aria-label="返回"><ArrowLeft size={20} /></button>
                    <div className="bk-top-title">{homeTab === 'shelf' && <small>BOOKROOM</small>}<h1>{current.title}</h1></div>
                    {homeTab === 'shelf' ? <button className="bk-icon" onClick={() => setImporting(true)} aria-label="导入书"><Plus size={20} /></button> : <span className="bk-icon" />}
                </header>
                <main className="bk-scroll bk-scroll-tabbed overflow-y-auto">
                    {homeTab === 'shelf' && <ShelfView books={books} characters={characters} categories={categories} loaded={loaded} onOpen={id => openBook(id)} onImport={() => setImporting(true)} />}
                    {homeTab === 'notes' && <NotesHub books={books} onRead={(id, seg) => openReader(id, seg, true)} onOpenBookNotes={id => openBook(id, 'notes')} />}
                    {homeTab === 'friends' && <FriendsView books={books} characters={characters} onChar={setCharView} />}
                    {homeTab === 'me' && (
                        <MeView records={records} meta={meta}
                            onCheckin={() => void saveMeta({ ...meta, checkins: [...new Set([...meta.checkins, dateKey(Date.now())])] })}
                            onYear={setYearView} />
                    )}
                </main>
                <nav className="bk-tabbar" role="tablist">
                    {HOME_TABS.map(t => (
                        <button key={t.id} role="tab" aria-selected={homeTab === t.id} onClick={() => switchHome(t.id)}>
                            {t.icon}<span>{t.label}</span>
                        </button>
                    ))}
                </nav>
            </>
        );
    }

    return (
        <div className="bookroom">
            {page}

            {readerNovel && reading && (
                <NovelReader novel={readerNovel} characters={characters} initialSeg={reading.seg} peek={reading.peek} allowDeleteAnnotations
                    onClose={() => setReading(null)} />
            )}

            {book && reporting && (
                <ReportSheet
                    book={book} characters={characters} preset={reporting.preset} presetNote={reporting.note}
                    onClose={() => setReporting(null)}
                    onDone={async (rec, text, tellIds) => {
                        await saveRecord(rec);
                        // 阅读器里的「你的书签」也跟着挪过去，两边看到的一致
                        try { localStorage.setItem(`vr_user_bm_${book.novelId}`, String(rec.progress?.segIdx ?? 0)); } catch { /* ignore */ }
                        const tell = characters.filter(c => tellIds.includes(c.id));
                        if (tell.length) {
                            await sendProgressToCharacters({ text, novelId: book.novelId, characters: tell, apiConfig, memoryPalaceConfig, userName: userProfile?.name || '' });
                        }
                        setReporting(null);
                        addToast(tell.length ? `记好了，也告诉了 ${tell.map(c => c.name).join('、')}` : '进度记好了', 'success');
                        const finishedNow = rec.progress && rec.progress.segIdx >= book.segCount - 1;
                        if (finishedNow && !rec.reviews?.user && window.confirm(`读完《${book.title}》啦！要写一篇书评，和 ta 交换吗？`)) { setBookTab('reviews'); setReviewing(true); }
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
                    onImported={async id => { setImporting(false); await reload(); openBook(id); }}
                    onError={msg => addToast(msg, 'error')}
                />
            )}
        </div>
    );
};

export default BookroomApp;
