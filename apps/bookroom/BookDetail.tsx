/**
 * 一本书的详情页：顶部封面 + 阅读 / 报进度，下面分「进度 · 目录 · 笔记 · 书评 · 批注」五个小标签。
 * 归档、彻底删除收在右上角「⋯」里，免得误点。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Archive, BookOpenText, Check, DotsThree, Trash } from '@phosphor-icons/react';
import type { CharacterProfile, VRNovelAnnotation } from '../../types';
import { DB } from '../../utils/db';
import { stripLeakedAttrs } from '../../utils/vrWorld/prompts';
import { chapterIndexAt, detectChapters, fallbackSections, formatPercent, progressRatio, type BookChapter, type BookroomRecord } from '../../utils/bookroom/bookroom';
import type { BookNote } from '../../utils/bookroom/reedenNotes';
import { Avatar, Bar, charRatio, SubTabs, type ShelfBook } from './shared';
import { CoverCard, NotesCard, ReviewsCard } from './BookParts';

export type BookTab = 'progress' | 'toc' | 'notes' | 'reviews' | 'annotations';

export const BookDetail: React.FC<{
    book: ShelfBook; characters: CharacterProfile[];
    tab: BookTab; onTab: (t: BookTab) => void;
    onBack: () => void; onReport: (preset?: BookChapter) => void;
    onRead: (segIdx?: number, peek?: boolean) => void;
    onSave: (rec: BookroomRecord) => Promise<void>; onArchive: () => void; onDelete: () => void;
    onReportAtNote: (note: BookNote) => void; onHighlight: (note?: BookNote) => void; onReview: () => void;
    onPullBack: (char: CharacterProfile) => void; onClearBookmark: (char: CharacterProfile) => void;
    onError: (msg: string) => void; onInfo: (msg: string) => void;
}> = (props) => {
    const { book, characters, tab, onTab, onBack, onReport, onRead, onSave, onArchive, onDelete } = props;
    const [menu, setMenu] = useState(false);
    const detected = useMemo(() => book.record.chapters || (book.novel ? detectChapters(book.novel.segments) : []), [book.novel, book.record.chapters]);
    const chapters = detected.length ? detected : fallbackSections(book.segCount);
    const archived = !!book.record.archived;
    const notesCount = book.record.notes?.length || 0;
    const reviewsCount = (book.record.reviews?.user ? 1 : 0) + (book.record.reviews?.chars?.length || 0);

    return (
        <>
            <header className="bk-top">
                <button className="bk-icon" onClick={onBack} aria-label="返回书架"><ArrowLeft size={20} /></button>
                <div className="bk-top-title"><h1 className="truncate">{book.title}</h1></div>
                <button className="bk-icon" onClick={() => setMenu(v => !v)} aria-label="更多操作"><DotsThree size={22} weight="bold" /></button>
                {menu && (
                    <div className="bk-menu" onClick={() => setMenu(false)}>
                        <div className="bk-menu-panel" onClick={e => e.stopPropagation()}>
                            {!archived && <button onClick={() => { setMenu(false); onArchive(); }}><Archive size={16} /><span>归档<small>删掉正文省空间，记录全留</small></span></button>}
                            <button className="is-danger" onClick={() => { setMenu(false); onDelete(); }}><Trash size={16} /><span>彻底删除<small>正文、批注、进度一起删，不能恢复</small></span></button>
                        </div>
                    </div>
                )}
            </header>
            <main className="bk-scroll overflow-y-auto">
                <CoverCard book={book} onSave={onSave} actions={<>
                    <button className="bk-primary" disabled={archived} onClick={() => onRead()}><BookOpenText size={16} /> 阅读</button>
                    <button className="bk-secondary" disabled={archived} onClick={() => onReport()}>报进度</button>
                </>} />
                {archived && <div className="bk-note">这本书已归档：正文删掉了，记录都在。想接着读，就重新导入同名的书，所有记录会自动接回。</div>}

                <SubTabs<BookTab>
                    className="bk-subtabs-sticky"
                    value={tab} onChange={onTab}
                    tabs={[
                        { id: 'progress', label: '进度' },
                        { id: 'toc', label: '目录' },
                        { id: 'notes', label: '笔记', badge: notesCount },
                        { id: 'reviews', label: '书评', badge: reviewsCount },
                        { id: 'annotations', label: '批注' },
                    ]}
                />

                <div className="bk-tabpanel">
                    {tab === 'progress' && <ProgressPanel {...props} chapters={chapters} />}
                    {tab === 'toc' && <TocPanel book={book} chapters={chapters} guessed={!detected.length} onRead={onRead} onReport={onReport} />}
                    {tab === 'notes' && (
                        <NotesCard book={book} chapters={chapters} onSave={onSave} onReportAtNote={props.onReportAtNote} onHighlight={props.onHighlight}
                            onError={props.onError} onInfo={props.onInfo} onLocate={seg => onRead(seg, true)} />
                    )}
                    {tab === 'reviews' && <ReviewsCard book={book} onReview={props.onReview} onSave={onSave} />}
                    {tab === 'annotations' && <AnnotationsPanel book={book} chapters={chapters} characters={characters} onRead={onRead} onError={props.onError} />}
                </div>
            </main>
        </>
    );
};

// ============ 进度 ============

const ProgressPanel: React.FC<React.ComponentProps<typeof BookDetail> & { chapters: BookChapter[] }> = ({ book, characters, chapters, onSave, onPullBack, onClearBookmark }) => {
    const [pickCompanions, setPickCompanions] = useState(false);
    const myAt = book.record.progress?.segIdx;
    const myChapter = myAt == null ? -1 : chapterIndexAt(chapters, myAt);
    const companions = book.record.companionIds;
    const readers = characters.filter(c => charRatio(c, book) != null || companions.includes(c.id));
    return (
        <>
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
                    // 读得比你靠前（且你还没读完）：可以把书签挪回你的位置
                    const ahead = myAt != null && bm != null && bm - 1 > myAt && myAt < book.segCount - 1 && !book.record.archived;
                    return (
                        <div className="bk-progress-row" key={c.id}>
                            <Avatar char={c} />
                            <div>
                                <p>{c.name}{r == null ? ' · 还没在彼方翻开' : r >= 1 ? ' · 读完了' : ch >= 0 ? ` · ${chapters[ch].title}` : ''}</p>
                                <Bar ratio={r ?? 0} tone="char" />
                                {r != null && (
                                    <div className="bk-row-actions">
                                        {ahead && <button onClick={() => onPullBack(c)}>挪回我的位置</button>}
                                        <button onClick={() => onClearBookmark(c)}>清空进度</button>
                                    </div>
                                )}
                            </div>
                            <em>{r == null ? '—' : formatPercent(r)}</em>
                        </div>
                    );
                })}
                <p className="bk-hint">角色的进度来自 ta 在彼方图书馆自己读书。想让 ta 读这本，去彼方书库设置「谁来读这些书」。</p>
            </section>

            <section className="bk-card">
                <div className="bk-card-head"><h2>一起读的人</h2><button onClick={() => setPickCompanions(v => !v)}>{pickCompanions ? '完成' : '修改'}</button></div>
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
                <p className="bk-hint">报进度时默认告诉这些人，进度会进 ta 的聊天和记忆。ta 们在彼方读这本时，最多读到你当前那一章的结尾，追上了就等你。</p>
            </section>

            {book.record.history.length > 0 && (
                <section className="bk-card">
                    <h2>读书记录</h2>
                    <ul className="bk-history">
                        {[...book.record.history].reverse().slice(0, 20).map(h => {
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
        </>
    );
};

// ============ 目录 ============

const TocPanel: React.FC<{
    book: ShelfBook; chapters: BookChapter[]; guessed: boolean;
    onRead: (segIdx?: number) => void; onReport: (preset?: BookChapter) => void;
}> = ({ book, chapters, guessed, onRead, onReport }) => {
    const myAt = book.record.progress?.segIdx;
    const myChapter = myAt == null ? -1 : chapterIndexAt(chapters, myAt);
    const archived = !!book.record.archived;
    return (
        <section className="bk-card">
            {guessed && <p className="bk-hint" style={{ marginTop: 0 }}>没认出章节标题，按位置分段。</p>}
            <ol className="bk-toc">
                {chapters.map((c, i) => (
                    <li key={`${c.segIdx}-${i}`} className={i === myChapter ? 'is-here' : i < myChapter ? 'is-read' : ''}>
                        <button disabled={archived} onClick={() => onRead(c.segIdx)}>
                            <span>{c.title}</span>
                            {i === myChapter && <em>读到这</em>}
                        </button>
                        {!archived && i !== myChapter && <button className="bk-toc-mark" onClick={() => onReport(c)}>读到这</button>}
                    </li>
                ))}
            </ol>
            {!archived && <p className="bk-hint">点章节名打开阅读；点右边「读到这」记进度。</p>}
        </section>
    );
};

// ============ 批注 ============

const AnnotationsPanel: React.FC<{
    book: ShelfBook; chapters: BookChapter[]; characters: CharacterProfile[];
    onRead: (segIdx?: number, peek?: boolean) => void; onError: (msg: string) => void;
}> = ({ book, chapters, characters, onRead, onError }) => {
    const [list, setList] = useState<VRNovelAnnotation[] | null>(null);
    const [who, setWho] = useState<string>('all');
    const [open, setOpen] = useState<Set<string>>(new Set());
    useEffect(() => {
        let alive = true;
        void DB.getVRAnnotations(book.novelId).then(a => { if (alive) setList(a); }).catch(() => { if (alive) setList([]); });
        return () => { alive = false; };
    }, [book.novelId]);

    const nameOf = (a: VRNovelAnnotation) => characters.find(c => c.id === a.authorId)?.name || a.authorName;
    const authors = useMemo(() => {
        const m = new Map<string, { id: string; name: string; n: number }>();
        for (const a of list || []) {
            const cur = m.get(a.authorId) || { id: a.authorId, name: nameOf(a), n: 0 };
            cur.n++; m.set(a.authorId, cur);
        }
        return [...m.values()].sort((x, y) => y.n - x.n);
    }, [list, characters]);
    const shown = (list || []).filter(a => who === 'all' || a.authorId === who).sort((a, b) => a.segIdx - b.segIdx || a.createdAt - b.createdAt);

    const quoteOf = (a: VRNovelAnnotation) => book.novel?.segments[a.segIdx]?.text || book.record.archived?.annotationQuotes[a.id] || '';
    const remove = async (ids: string[], confirmText: string) => {
        if (!window.confirm(confirmText)) return;
        try {
            for (const id of ids) await DB.deleteVRAnnotation(id);
            setList(l => (l || []).filter(a => !ids.includes(a.id)));
        } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    };
    const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    if (list == null) return <p className="bk-empty-sm">读取中…</p>;
    if (!list.length) return <p className="bk-empty-sm">这本书还没有批注。角色在彼方读书时会在页边写批注。</p>;
    const whoName = authors.find(a => a.id === who)?.name;
    return (
        <section>
            <nav className="bk-chips">
                <button aria-pressed={who === 'all'} onClick={() => setWho('all')}>全部 {list.length}</button>
                {authors.map(a => <button key={a.id} aria-pressed={who === a.id} onClick={() => setWho(a.id)}>{a.name} {a.n}</button>)}
            </nav>
            {who !== 'all' && (
                <button className="bk-danger" style={{ marginBottom: 10 }} onClick={() => void remove(shown.map(a => a.id), `删掉 ${whoName} 在《${book.title}》的全部 ${shown.length} 条批注？删了找不回来。`)}>
                    <Trash size={15} /> 删掉 {whoName} 在这本书的全部批注
                </button>
            )}
            <ul className="bk-notes">
                {shown.map(a => {
                    const ci = chapterIndexAt(chapters, a.segIdx);
                    const quote = quoteOf(a);
                    const expanded = open.has(a.id);
                    return (
                        <li key={a.id} className="bk-note-item bk-ann">
                            <small>{nameOf(a)} · {ci >= 0 ? chapters[ci].title : '书里某处'}{a.targetAnnotationId ? ' · 回应别人' : ''}</small>
                            {quote && <blockquote className={expanded ? '' : 'is-clamped'} onClick={() => toggle(a.id)}>{quote}</blockquote>}
                            {quote && quote.length > 60 && <button className="bk-link-btn" onClick={() => toggle(a.id)}>{expanded ? '收起原文' : '展开原文'}</button>}
                            <p className="bk-note-reply"><b>{nameOf(a)}</b>：{stripLeakedAttrs(a.content)}</p>
                            <div className="bk-note-foot">
                                {book.novel && <button onClick={() => onRead(a.segIdx, true)}><BookOpenText size={13} /> 在书里看</button>}
                                <button onClick={() => void remove([a.id], `删掉 ${nameOf(a)} 的这条批注？删了找不回来。`)}>删除</button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};
