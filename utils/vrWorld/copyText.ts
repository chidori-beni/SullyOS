// 彼方 · 一键复制：把动态 / 邮局信件 / 留言簿 / 剧院的内容拼成纯文字。
//
// 和聊天长按「复制文字」（utils/messageCopyText.ts）不同，这里不从 DOM 抽字：
// 彼方的卡片为了排版会截断（动态里的信件摘要只显示 70 字、长信要点「展开全文」），
// 照屏幕抽就复制不全。所以直接从数据拼，拿到的永远是全文。

import type { VRCardMeta, VRGuestbookMessage, VRLetter, VRScript, VRStagedPlay } from '../../types';

const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const joinBlocks = (blocks: (string | undefined | null | false)[]) =>
    blocks.map(b => (b || '').trim()).filter(Boolean).join('\n');

/** 一条彼方动态。roomName 由调用方给（getRoom 在 constants 里，这里不依赖它）。 */
/** clean 和卡片上显示时用的是同一套清洗（去掉开头的自称、去掉漏出来的属性标记）。 */
export const feedItemCopyText = (
    item: { charName: string; timestamp: number; meta: VRCardMeta },
    roomName: string,
    clean: { activity?: (s: string) => string; annotation?: (s: string) => string } = {},
): string => {
    const act = clean.activity || (s => s);
    const ann = clean.annotation || (s => s);
    const m = item.meta;
    const annotations = m.annotationRefs?.length
        ? m.annotationRefs.map(r => `「${ann(r.text)}」`)
        : (m.annotationExcerpts || []).map(ex => `「${ann(ex)}」`);
    const poem = m.room === 'signal' && m.signalLine
        ? `《${(m.poemTitle || '无题')}》${m.poemLineSeq ? ` 第 ${m.poemLineSeq}/${m.poemTargetLines || '?'} 句` : ''}\n${m.signalLine}`
        : '';
    return joinBlocks([
        `${item.charName} · ${roomName} · ${fmtTime(item.timestamp)}`,
        m.activity && act(m.activity),
        m.behavior && act(m.behavior),
        ...annotations,
        m.room === 'postoffice' && m.letterExcerpt ? `「${m.letterExcerpt}」` : '',
        poem,
    ]);
};

/** 一封信：正文 + 回信 / 收到的回复 / 读后感，按这封信目前有的内容拼。 */
export const letterCopyText = (l: VRLetter): string => {
    const parts = [`${l.pen}：\n${l.content}`];
    if (l.reply?.content) {
        parts.push(`回信（${l.reply.pen}）：\n${l.reply.content}${l.reply.userNote ? `\n——\n${l.reply.userNote}` : ''}`);
    }
    for (const r of l.repliesReceived || []) parts.push(`${r.pen} 回：\n${r.content}`);
    if (l.reaction?.content) parts.push(`读后：\n${l.reaction.content}`);
    return parts.map(p => p.trim()).filter(Boolean).join('\n\n');
};

/** 留言簿的一条或多条留言，一条一行（回复的标出回给谁）。 */
export const guestbookCopyText = (messages: VRGuestbookMessage[], nameOf: (m: VRGuestbookMessage) => string = m => m.authorName): string =>
    messages.map(m => `${nameOf(m)}（${fmtTime(m.createdAt)}）${m.replyToName ? ` ↩${m.replyToName}` : ''}：${m.content}`).join('\n');

/** 剧本投稿：标题 + 简介 + 登场 + 正文。 */
export const scriptCopyText = (s: VRScript): string => joinBlocks([
    `《${s.title}》　${s.authorName}`,
    s.logline,
    s.roles.length ? `登场：${s.roles.map(r => r.persona ? `${r.name}（${r.persona}）` : r.name).join('、')}` : '',
]) + '\n\n' + s.body.trim();

/** 历史舞台剧：演员表 + 导演终本 + 观众锐评 + 评级。台上名字和回放界面一致（演员名统一换成角色名）。 */
export const stagedPlayCopyText = (p: VRStagedPlay): string => {
    const roleOf = new Map<string, string>();
    for (const c of p.cast) { roleOf.set(c.actorName, c.roleName); roleOf.set(c.roleName, c.roleName); }
    const name = (n?: string) => (n && roleOf.get(n)) || n || '';
    const script = p.stage.map(b =>
        b.kind === 'narration' ? `（${b.text}）`
            : b.kind === 'enter' ? `——${name(b.actorName)} 上场——`
                : b.kind === 'exit' ? `——${name(b.actorName)} 下场——`
                    : `${name(b.actorName)}：${b.text}`,
    ).join('\n');
    const head = joinBlocks([
        `《${p.title}》`,
        p.logline,
        p.cast.length ? `演员：${p.cast.map(c => `${c.actorName} 饰 ${c.roleName}`).join('、')}` : '',
    ]);
    const reviews = p.reviews.map(r => `${r.critic}：${r.text}`).join('\n');
    return [head, script, reviews && `观众席\n${reviews}`, p.rating && `综合评级：${p.rating}`].filter(Boolean).join('\n\n');
};
