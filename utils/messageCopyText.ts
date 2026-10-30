// 长按消息 →「复制文字」用：取出一条消息里**人能看到的文字**。
//
// 普通文字消息直接用 content；各种卡片（外卖、音乐、新闻、转发、查手机……三十来种）
// 的文字散在 metadata 各处、每种字段名都不一样，挨个写提取规则既长又容易漏新卡片。
// 所以卡片走「看到什么复制什么」：长按那一刻从卡片的 DOM 里按显示顺序把文字抽出来，
// 跳过按钮、图标、隐藏元素。HTML 卡片在沙盒 iframe 里，外面读不到，改从源码里抽文字。

import type { Message } from '../types';

/** 这些元素里的字不是「卡片内容」：按钮上的「复制源码」、图标、样式脚本等。 */
const SKIP_TAGS = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'AUDIO', 'VIDEO', 'INPUT', 'TEXTAREA', 'SELECT']);

/** 解析出来的 HTML 没有排版信息，只能按标签名判断哪些要换行。 */
const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER',
    'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'TABLE', 'TR', 'UL',
]);

const isBlockDisplay = (display: string) => !display.startsWith('inline') && display !== 'contents' && display !== '';

/**
 * 按显示顺序把文字串起来：块级元素前后换行，br 换行，其余挨着拼。
 * live=true 时读真实样式（页面上的卡片），隐藏的不要；false 时按标签名判断（解析出来的 HTML）。
 */
const collectText = (root: Node, live: boolean): string => {
    const parts: string[] = [];
    // inRow：父元素是横排的 flex（卡片里常见的「名字　价格」一行），子元素之间用空格不换行
    const walk = (node: Node, inRow = false) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const t = (node.nodeValue || '').replace(/\s+/g, ' ');
            if (t.trim()) parts.push(t);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        const tag = el.tagName.toUpperCase();
        if (SKIP_TAGS.has(tag) || el.getAttribute('aria-hidden') === 'true') return;
        if (tag === 'BR') { parts.push('\n'); return; }
        let block = BLOCK_TAGS.has(tag);
        let row = false;
        if (live) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            block = isBlockDisplay(style.display);
            row = style.display.endsWith('flex') && !style.flexDirection.startsWith('column');
        }
        const sep = inRow ? ' ' : '\n';
        if (block) parts.push(sep);
        el.childNodes.forEach(child => walk(child, row));
        if (block) parts.push(sep);
    };
    walk(root);
    return parts.join('')
        .split('\n')
        .map(line => line.replace(/ {2,}/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
};

/** HTML 卡片源码 → 纯文字。 */
export const htmlSourceToText = (html: string): string => {
    if (!html.trim()) return '';
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return collectText(doc.body, false);
    } catch {
        return '';
    }
};

/** 页面上一张卡片 → 它显示出来的文字。 */
export const elementToText = (el: Element | null | undefined): string => {
    if (!el) return '';
    try {
        // 气泡外壳里还有心象、表情回应、群聊发送人名字，只取标了 data-copy-root 的正文区
        return collectText(el.querySelector('[data-copy-root]') || el, true);
    } catch {
        return '';
    }
};

/** 写剪贴板；iOS PWA 偶尔拒绝 Clipboard API，降级到 execCommand。 */
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 降级到 execCommand */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch { return false; }
};

/**
 * 一条消息能复制的文字；空串 = 没有可复制的（纯图片、表情包这类），菜单里就不显示「复制文字」。
 * el 是长按时手指下面的那个消息容器。
 */
export const getMessageCopyText = (msg: Message | null | undefined, el?: Element | null): string => {
    if (!msg) return '';
    if (msg.type === 'text') return msg.content || '';
    if (msg.type === 'image' || msg.type === 'emoji' || msg.type === 'voice') return '';
    if (msg.type === 'html_card') {
        const html = typeof msg.metadata?.htmlSource === 'string' ? msg.metadata.htmlSource : '';
        if (html) return htmlSourceToText(html);
    }
    return elementToText(el);
};
