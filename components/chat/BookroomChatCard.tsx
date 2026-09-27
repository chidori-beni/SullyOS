/**
 * 书房发进聊天的汇报（读书进度 / 划线 / 书评 / 荐书 / 年度书单）显示成卡片，
 * 免得看起来像用户自己打的字。消息本身仍是普通 text（content 原样进上下文和记忆），这里只管显示。
 */
import React from 'react';
import { BookBookmark } from '@phosphor-icons/react';

const KIND_LABEL: Record<string, string> = {
    highlight: '划线',
    review: '交换书评',
    recommend: '想听你荐书',
    'year-letter': '年度书单',
};

/** 拆出「【书房 · 标题】第一行」和后面的行。认不出格式时整段当正文。 */
export function parseBookroomMessage(content: string, kind?: string): { title: string; book?: string; lines: string[] } {
    const all = content.split('\n');
    const m = all[0]?.match(/^【书房\s*·\s*([^】]+)】\s*(.*)$/);
    const title = (kind && KIND_LABEL[kind]) || m?.[1]?.trim() || '书房';
    const lines = (m ? [m[2], ...all.slice(1)] : all).map(l => l.trim()).filter(Boolean);
    const book = content.match(/《([^》]{1,60})》/)?.[1];
    return { title, book, lines };
}

export const BookroomChatCard: React.FC<{ content: string; kind?: string }> = ({ content, kind }) => {
    const { title, book, lines } = parseBookroomMessage(content, kind);
    return (
        <div className="w-72 max-w-[82vw] overflow-hidden rounded-2xl border shadow-sm" style={{ background: '#fbf8f2', borderColor: '#e3d8c8', color: '#3b2f28' }}>
            <div className="flex items-center gap-2 px-3.5 py-2 border-b" style={{ borderColor: '#ece2d4', background: '#f4eee3' }}>
                <BookBookmark size={15} weight="fill" style={{ color: '#9a5b3c' }} />
                <span className="text-[11.5px] font-bold tracking-wide" style={{ color: '#9a5b3c' }}>书房 · {title}</span>
                {book && <span className="ml-auto min-w-0 truncate text-[11px]" style={{ color: '#8a7a6c' }}>《{book}》</span>}
            </div>
            <div className="px-3.5 py-2.5 space-y-1.5" style={{ fontFamily: `'Noto Serif SC','Songti SC',serif` }}>
                {lines.map((line, i) => {
                    // 整行被「」包住的是书里的原文
                    const quote = /^「[\s\S]*」$/.test(line);
                    return quote ? (
                        <p key={i} className="text-[13px] leading-relaxed pl-2.5" style={{ borderLeft: '3px solid #c9a58a', color: '#4a3b31' }}>{line.slice(1, -1)}</p>
                    ) : (
                        <p key={i} className="text-[13px] leading-relaxed whitespace-pre-wrap">{line}</p>
                    );
                })}
            </div>
        </div>
    );
};
