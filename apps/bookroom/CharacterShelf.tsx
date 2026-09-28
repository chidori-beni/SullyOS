/**
 * 角色书单：ta 在读哪些书、读到哪；ta 留下的话（彼方批注 / 划线回应 / 书评）；ta 推荐的书。
 * 每条留言都能「在书里看」原文、也能删除；顶部可以清空 ta 的阅读记录。
 */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpenText, Eraser, Sparkle } from '@phosphor-icons/react';
import type { CharacterProfile, VRNovelAnnotation } from '../../types';
import { DB } from '../../utils/db';
import { readingPreferenceLabel } from '../../utils/vrWorld/library';
import { READING_PACE_LABEL, readingPaceOf } from '../../utils/bookroom/pace';
import { stripLeakedAttrs } from '../../utils/vrWorld/prompts';
import { chapterIndexAt, detectChapters, formatPercent, progressRatio, type BookroomRecord } from '../../utils/bookroom/bookroom';
import type { BookRecommendation } from '../../utils/bookroom/stats';
import { Avatar, Bar, Cover, Stars, SubTabs, charRatio, type ShelfBook, formatStamp } from './shared';

type TraceKind = '批注' | '回应' | '书评';
interface CharTrace {
    key: string; at: number; book: ShelfBook; quote: string; content: string; kind: TraceKind;
    segIdx?: number; rating?: number;
    remove: () => Promise<void>;
}

type CharTab = 'books' | 'traces' | 'recs';

export const CharacterShelf: React.FC<{
    char: CharacterProfile; books: ShelfBook[];
    onBack: () => void; onOpenBook: (novelId: string) => void;
    onRead: (novelId: string, segIdx: number) => void;
    onSaveRecord: (rec: BookroomRecord) => Promise<void>;
    onClearAll: (alsoAnnotations: boolean) => Promise<void>;
    recommendations: BookRecommendation[];
    onRecommend: () => Promise<void>;
    onRecStatus: (id: string, status: 'want' | 'read' | 'pass') => void;
    onRecDelete: (id: string) => void;
}> = ({ char, books, onBack, onOpenBook, onRead, onSaveRecord, onClearAll, recommendations, onRecommend, onRecStatus, onRecDelete }) => {
    const [tab, setTab] = useState<CharTab>('books');
    const [recBusy, setRecBusy] = useState(false);
    const [recError, setRecError] = useState('');
    const [annotations, setAnnotations] = useState<VRNovelAnnotation[] | null>(null);
    const [kind, setKind] = useState<TraceKind | 'all'>('all');
    const [open, setOpen] = useState<Set<string>>(new Set());
    const loadAnnotations = () => DB.getVRAnnotations().then(all => setAnnotations(all.filter(a => a.authorId === char.id))).catch(() => setAnnotations([]));
    useEffect(() => { void loadAnnotations(); }, [char.id]);

    const rows = books
        .map(b => ({ book: b, ratio: charRatio(char, b), companion: b.record.companionIds.includes(char.id) }))
        .filter(x => x.ratio != null || x.companion);
    const reading = rows.filter(x => x.ratio != null && x.ratio < 1).sort((a, b) => b.ratio! - a.ratio!);
    const finished = rows.filter(x => x.ratio != null && x.ratio >= 1);
    const notYet = rows.filter(x => x.ratio == null);

    // ta 留下的话：彼方书页边的批注 + 对你划线的回应 + 书评，按时间倒序
    const traces: CharTrace[] = [];
    for (const a of annotations || []) {
        const b = books.find(x => x.novelId === a.novelId);
        if (!b) continue;
        traces.push({
            key: `a-${a.id}`, at: a.createdAt, book: b, kind: '批注', segIdx: a.segIdx,
            quote: b.novel?.segments[a.segIdx]?.text || b.record.archived?.annotationQuotes[a.id] || '',
            content: stripLeakedAttrs(a.content),
            remove: async () => { await DB.deleteVRAnnotation(a.id); setAnnotations(l => (l || []).filter(x => x.id !== a.id)); },
        });
    }
    for (const b of books) {
        for (const n of b.record.notes || []) {
            for (const r of n.replies || []) {
                if (r.charId !== char.id) continue;
                traces.push({
                    key: `r-${n.id}-${r.at}`, at: r.at, book: b, kind: '回应', segIdx: n.segIdx, quote: n.quote, content: r.content,
                    remove: () => onSaveRecord({ ...b.record, notes: (b.record.notes || []).map(x => x.id === n.id ? { ...x, replies: (x.replies || []).filter(y => y.at !== r.at || y.charId !== char.id) } : x), updatedAt: Date.now() }),
                });
            }
        }
        const rv = b.record.reviews?.chars?.find(r => r.charId === char.id);
        if (rv) {
            traces.push({
                key: `v-${b.novelId}`, at: rv.at, book: b, kind: '书评', quote: '', content: rv.text, rating: rv.rating,
                remove: () => onSaveRecord({ ...b.record, reviews: { ...b.record.reviews, chars: (b.record.reviews?.chars || []).filter(x => x.charId !== char.id) }, updatedAt: Date.now() }),
            });
        }
    }
    traces.sort((a, b) => b.at - a.at);
    const shownTraces = traces.filter(t => kind === 'all' || t.kind === kind);
    const countOf = (k: TraceKind) => traces.filter(t => t.kind === k).length;
    const toggle = (key: string) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

    const clearAll = async () => {
        if (!window.confirm(`清空 ${char.name} 的全部阅读记录？\n\nta 在每本书上的书签都会清零，下次从头读。`)) return;
        const alsoAnn = window.confirm(`要不要连 ${char.name} 写过的 ${countOf('批注')} 条批注一起删掉？\n\n点「确定」一起删；点「取消」只清书签、批注留着。`);
        await onClearAll(alsoAnn);
        if (alsoAnn) setAnnotations([]);
    };

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
                <button className="bk-icon" onClick={onBack} aria-label="返回"><ArrowLeft size={20} /></button>
                <div className="bk-top-title"><small>READING LIST</small><h1>{char.name} 的书单</h1></div>
                <span className="bk-icon" />
            </header>
            <main className="bk-scroll overflow-y-auto">
                <section className="bk-char-hero">
                    <Avatar char={char} size={56} />
                    <div>
                        <p className="bk-char-stats"><b>{reading.length}</b> 在读 · <b>{finished.length}</b> 读完 · <b>{traces.length}</b> 条留言</p>
                        <p className="bk-hint">彼方里：{readingPreferenceLabel(char)} · {READING_PACE_LABEL[readingPaceOf(char)]}{char.vrState?.enabled ? '' : ' · 还没接入彼方，不会自己去读书'}</p>
                        <button className="bk-link-btn" onClick={() => void clearAll()}><Eraser size={13} /> 清空阅读记录</button>
                    </div>
                </section>

                <SubTabs<CharTab> className="bk-subtabs-sticky" value={tab} onChange={setTab} tabs={[
                    { id: 'books', label: '书单', badge: rows.length },
                    { id: 'traces', label: '留下的话', badge: traces.length },
                    { id: 'recs', label: '推荐', badge: recommendations.length },
                ]} />

                <div className="bk-tabpanel">
                    {tab === 'books' && <>
                        {reading.length > 0 && <><h3 className="bk-section">在读</h3><div className="bk-shelf">{reading.map(x => <BookRow key={x.book.novelId} book={x.book} ratio={x.ratio} />)}</div></>}
                        {finished.length > 0 && <><h3 className="bk-section">读完了</h3><div className="bk-shelf">{finished.map(x => <BookRow key={x.book.novelId} book={x.book} ratio={x.ratio} />)}</div></>}
                        {notYet.length > 0 && <><h3 className="bk-section">约好一起读、还没翻开</h3><div className="bk-shelf">{notYet.map(x => <BookRow key={x.book.novelId} book={x.book} ratio={null} />)}</div></>}
                        {!rows.length && <p className="bk-empty-sm">{char.name} 还没读过书架上的书。</p>}
                    </>}

                    {tab === 'traces' && <>
                        <nav className="bk-chips">
                            <button aria-pressed={kind === 'all'} onClick={() => setKind('all')}>全部 {traces.length}</button>
                            {(['批注', '回应', '书评'] as const).map(k => countOf(k) > 0 && <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{k} {countOf(k)}</button>)}
                        </nav>
                        {annotations == null ? <p className="bk-empty-sm">读取中…</p> : !shownTraces.length ? <p className="bk-empty-sm">还没有。ta 在彼方读书时会在页边写批注；你划线给 ta 看、交换书评时，ta 的话也会记在这里。</p> : (
                            <ul className="bk-notes">
                                {shownTraces.map(t => {
                                    const expanded = open.has(t.key);
                                    const chapters = t.book.record.chapters || (t.book.novel ? detectChapters(t.book.novel.segments) : []);
                                    const ci = t.segIdx != null ? chapterIndexAt(chapters, t.segIdx) : -1;
                                    return (
                                        <li key={t.key} className="bk-note-item bk-ann">
                                            <small><span>《{t.book.title}》{ci >= 0 ? ` · ${chapters[ci].title}` : ''} · {t.kind}</span><time>{formatStamp(t.at).full}</time></small>
                                            {t.quote && <blockquote className={expanded ? '' : 'is-clamped'} onClick={() => toggle(t.key)}>{t.quote}</blockquote>}
                                            {t.quote && t.quote.length > 60 && <button className="bk-link-btn" onClick={() => toggle(t.key)}>{expanded ? '收起原文' : '展开原文'}</button>}
                                            <p className="bk-note-reply"><b>{char.name}</b>{t.rating ? <> <Stars n={t.rating} /></> : null}：{t.content}</p>
                                            <div className="bk-note-foot">
                                                {t.book.novel && t.segIdx != null && <button onClick={() => onRead(t.book.novelId, t.segIdx!)}><BookOpenText size={13} /> 在书里看</button>}
                                                <button onClick={() => onOpenBook(t.book.novelId)}>去这本书</button>
                                                <button onClick={() => { if (window.confirm(`删掉 ${char.name} 的这条${t.kind}？删了找不回来。`)) void t.remove(); }}>删除</button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </>}

                    {tab === 'recs' && <section>
                        {!recommendations.length && <p className="bk-empty-sm">请 ta 按自己的口味和对你的了解推荐一本。推荐会发进你们的私聊。</p>}
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
                        <button className="bk-secondary" style={{ marginTop: 10 }} disabled={recBusy} onClick={async () => {
                            setRecBusy(true); setRecError('');
                            try { await onRecommend(); } catch (e) { setRecError(e instanceof Error ? e.message : String(e)); }
                            finally { setRecBusy(false); }
                        }}><Sparkle size={15} /> {recBusy ? `${char.name} 正在想…` : `请 ${char.name} 推荐一本`}</button>
                    </section>}
                </div>
            </main>
        </>
    );
};
