/**
 * 书房发进聊天的汇报（读书进度 / 划线 / 书评 / 荐书 / 年度书单）显示成卡片，
 * 免得看起来像用户自己打的字；角色在书房里回的话（页边批注 / 书评 / 荐书 / 年度寄语）也是卡片。
 * 消息本身仍是普通 text（content 原样进上下文和记忆），这里只管显示。
 * 装扮里用 .sully-chat-card[data-card="bookroom_card"] 选中（角色回的 data-card-sub 以 -reply 结尾）；
 * 内部有 .sully-bookroom-card-* 一组稳定类名。
 */
import React from 'react';
import { BookBookmark, PenNib, Star } from '@phosphor-icons/react';

const KIND_LABEL: Record<string, string> = {
    highlight: '划线',
    review: '交换书评',
    recommend: '想听你荐书',
    'year-letter': '年度书单',
    'highlight-reply': '页边批注',
    'review-reply': '交换书评',
    'recommend-reply': '荐书',
    'year-letter-reply': '年度寄语',
};


export const isBookroomReplyKind = (kind?: unknown) => typeof kind === 'string' && kind.endsWith('-reply');

/** 拆出「【书房 · 标题】第一行」和后面的行。认不出格式时整段当正文。 */
export function parseBookroomMessage(content: string, kind?: string): { title: string; book?: string; lines: string[] } {
    const all = content.split('\n');
    const m = all[0]?.match(/^【书房\s*·\s*([^】]+)】\s*(.*)$/);
    const title = (kind && KIND_LABEL[kind]) || m?.[1]?.trim() || '书房';
    const lines = (m ? [m[2], ...all.slice(1)] : all).map(l => l.trim()).filter(Boolean);
    const book = content.match(/《([^》]{1,60})》/)?.[1];
    return { title, book, lines };
}

/** 「评分：4/5」这一行 → 4 */
export const ratingOfLine = (line: string): number | undefined => {
    const m = line.match(/^评分\s*[:：]\s*([1-5])\s*(?:\/\s*5|分|星)?\s*$/);
    return m ? Number(m[1]) : undefined;
};

const WARM = { bg: '#fbf8f2', border: '#e3d8c8', ink: '#3b2f28', headBg: '#f4eee3', headLine: '#ece2d4', accent: '#9a5b3c', sub: '#8a7a6c', quote: '#c9a58a' };
const SAGE = { bg: '#f8faf5', border: '#d6dfcd', ink: '#33392f', headBg: '#edf2e7', headLine: '#dfe7d6', accent: '#5f7152', sub: '#7b8671', quote: '#a9b99b' };

export const BookroomChatCard: React.FC<{
    content: string; kind?: string;
    /** user = 用户发的汇报；char = 角色回的话 */
    side?: 'user' | 'char';
    /** 消息 metadata 里存的书名（角色的回复里不一定提书名） */
    bookTitle?: string;
    /** 角色当时在忙、有空了才补回的：用户是几点分享的 */
    deferredSince?: number;
}> = ({ content, kind, side = 'user', bookTitle, deferredSince }) => {
    const parsed = parseBookroomMessage(content, kind);
    const reply = side === 'char';
    const book = reply ? (bookTitle || (kind === 'recommend-reply' ? parsed.book : undefined)) : parsed.book;
    const { title, lines } = parsed;
    const c = reply ? SAGE : WARM;
    const Icon = reply ? PenNib : BookBookmark;
    const busyLabel = reply && deferredSince ? '忙完补回' : undefined;
    return (
        <div className={`sully-bookroom-card${reply ? ' sully-bookroom-card-reply' : ''} w-72 max-w-[82vw] overflow-hidden rounded-2xl border shadow-sm`} style={{ background: c.bg, borderColor: c.border, color: c.ink }}>
            <div className="sully-bookroom-card-head flex items-center gap-2 px-3.5 py-2 border-b" style={{ borderColor: c.headLine, background: c.headBg }}>
                <Icon className="sully-bookroom-card-icon" size={15} weight="fill" style={{ color: c.accent, flexShrink: 0 }} />
                <span className="sully-bookroom-card-title text-[11.5px] font-bold tracking-wide shrink-0" style={{ color: c.accent }}>书房 · {title}</span>
                {busyLabel && <span className="sully-bookroom-card-tag shrink-0 rounded-full px-1.5 text-[10px]" style={{ color: c.sub, border: `1px solid ${c.border}` }}>{busyLabel}</span>}
                {book && <span className="sully-bookroom-card-book ml-auto min-w-0 truncate text-[11px]" style={{ color: c.sub }}>《{book}》</span>}
            </div>
            <div className="sully-bookroom-card-body px-3.5 py-2.5 space-y-1.5" style={{ fontFamily: `'Noto Serif SC','Songti SC',serif` }}>
                {lines.map((line, i) => {
                    const stars = reply && i === 0 ? ratingOfLine(line) : undefined;
                    if (stars) {
                        return (
                            <p key={i} className="sully-bookroom-card-stars flex items-center gap-0.5 text-[12px]" aria-label={`评分 ${stars}/5`} style={{ color: c.accent }}>
                                {[1, 2, 3, 4, 5].map(n => <Star key={n} size={13} weight={n <= stars ? 'fill' : 'regular'} />)}
                            </p>
                        );
                    }
                    // 整行被「」包住的是书里的原文
                    const quote = /^「[\s\S]*」$/.test(line);
                    return quote ? (
                        <p key={i} className="sully-bookroom-card-quote text-[13px] leading-relaxed pl-2.5" style={{ borderLeft: `3px solid ${c.quote}`, color: c.ink }}>{line.slice(1, -1)}</p>
                    ) : (
                        <p key={i} className="sully-bookroom-card-line text-[13px] leading-relaxed whitespace-pre-wrap">{line}</p>
                    );
                })}
            </div>
        </div>
    );
};
