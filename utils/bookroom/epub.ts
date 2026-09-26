/**
 * EPUB → 书房/彼方能用的形态：纯文字正文 + 自带目录 + 封面图。
 *
 * 只取文字：插图、字体、排版不进 Sully（用户在 Reeden 里读原样；Sully 这份只用来
 * 认目录、找句子、给角色读）。封面单独取出来给书架用。有 DRM 加密的书读不出正文。
 */
import type JSZipType from 'jszip';

export interface EpubTocEntry {
    title: string;
    /** 这一章开头的一段原文，用来在切好的段落块里定位 */
    anchor: string;
}

export interface ParsedEpub {
    title: string;
    author?: string;
    description?: string;
    text: string;
    toc: EpubTocEntry[];
    cover?: Blob;
}

export class EpubError extends Error {}

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'section', 'article',
    'header', 'footer', 'pre', 'tr', 'dt', 'dd', 'figcaption', 'table', 'aside', 'hr']);
const SKIP = new Set(['script', 'style', 'rt', 'rp', 'head', 'title', 'svg', 'math']);

/** 把一个 XHTML 节点转成带换行的纯文字。 */
export function extractText(node: Node): string {
    const out: string[] = [];
    const walk = (n: Node) => {
        if (n.nodeType === 3) { out.push((n.nodeValue || '').replace(/\s+/g, ' ')); return; }
        if (n.nodeType !== 1) return;
        const tag = (n as Element).localName.toLowerCase();
        if (SKIP.has(tag)) return;
        if (tag === 'br') { out.push('\n'); return; }
        const block = BLOCK.has(tag);
        if (block) out.push('\n');
        n.childNodes.forEach(walk);
        if (block) out.push('\n');
    };
    walk(node);
    return out.join('').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

/** 相对路径解析（EPUB 里的 href 都相对于所在文件）。 */
export function resolvePath(baseFile: string, href: string): string {
    const clean = decodeURIComponent(href.split('#')[0]);
    if (!clean) return baseFile;
    const parts = baseFile.split('/').slice(0, -1);
    for (const seg of clean.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
}

const fragmentOf = (href: string) => {
    const i = href.indexOf('#');
    return i < 0 ? '' : decodeURIComponent(href.slice(i + 1));
};

function parseXml(src: string, type: DOMParserSupportedType = 'application/xml'): Document {
    const doc = new DOMParser().parseFromString(src, type);
    if (type !== 'text/html' && doc.getElementsByTagName('parsererror').length) {
        // 不规范的 XHTML 很常见，退回宽松的 HTML 解析
        return new DOMParser().parseFromString(src, 'text/html');
    }
    return doc;
}

/** 按本地名取元素（忽略 dc:/opf: 这些命名空间前缀）。 */
const byLocal = (root: Document | Element, name: string): Element[] =>
    Array.from(root.getElementsByTagName('*')).filter(e => e.localName === name);

const ANCHOR_LEN = 40;

export async function parseEpub(data: ArrayBuffer, fallbackTitle = '无题'): Promise<ParsedEpub> {
    const JSZip = (await import('jszip')).default;
    let zip: JSZipType;
    try { zip = await JSZip.loadAsync(data); } catch { throw new EpubError('这不是有效的 EPUB 文件（解压失败）'); }
    const read = async (path: string) => {
        const f = zip.file(path);
        if (!f) throw new EpubError(`EPUB 里缺少文件：${path}`);
        return f.async('string');
    };
    if (zip.file('META-INF/encryption.xml')) {
        const enc = await read('META-INF/encryption.xml');
        // 只加密字体（常见的字体混淆）不影响正文；加密了正文才读不出来
        if (/xhtml|\.html?"/i.test(enc)) throw new EpubError('这本 EPUB 有版权加密（DRM），读不出正文。可以换一个没有加密的版本');
    }

    const container = parseXml(await read('META-INF/container.xml'));
    const opfPath = byLocal(container, 'rootfile')[0]?.getAttribute('full-path');
    if (!opfPath) throw new EpubError('EPUB 结构不完整：找不到 OPF');
    const opf = parseXml(await read(opfPath));

    const meta = (name: string) => byLocal(opf, name)[0]?.textContent?.trim() || undefined;
    const title = meta('title') || fallbackTitle;
    const author = meta('creator');
    const descRaw = meta('description');
    const description = descRaw ? extractText(parseXml(`<div>${descRaw}</div>`, 'text/html').body).slice(0, 500) : undefined;

    const manifest = new Map<string, { href: string; type: string; props: string }>();
    for (const item of byLocal(opf, 'item')) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        if (id && href) manifest.set(id, { href: resolvePath(opfPath, href), type: item.getAttribute('media-type') || '', props: item.getAttribute('properties') || '' });
    }
    const spineEl = byLocal(opf, 'spine')[0];
    const spine = byLocal(opf, 'itemref')
        .filter(r => r.getAttribute('linear') !== 'no')
        .map(r => manifest.get(r.getAttribute('idref') || '')?.href)
        .filter((h): h is string => !!h);
    if (!spine.length) throw new EpubError('EPUB 里没有正文章节');

    // 正文：按阅读顺序逐个文件取文字；顺手缓存文档，目录定位要用
    const docs = new Map<string, Document>();
    const fileText = new Map<string, string>();
    const chunks: string[] = [];
    for (const path of spine) {
        if (!zip.file(path)) continue;
        const doc = parseXml(await read(path), 'application/xhtml+xml');
        docs.set(path, doc);
        const text = extractText(doc.body || doc.documentElement);
        fileText.set(path, text);
        if (text) chunks.push(text);
    }
    const text = chunks.join('\n\n');
    if (!text.trim()) throw new EpubError('这本 EPUB 里没有可提取的文字（可能是纯图片漫画，或者加密了）');

    // 目录：EPUB3 的 nav 优先，没有再看 EPUB2 的 NCX
    const raw: { title: string; path: string; frag: string }[] = [];
    const navItem = [...manifest.values()].find(m => m.props.split(/\s+/).includes('nav'));
    if (navItem && zip.file(navItem.href)) {
        const nav = parseXml(await read(navItem.href), 'application/xhtml+xml');
        const navs = byLocal(nav, 'nav');
        const toc = navs.find(n => (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').includes('toc')) || navs[0];
        for (const a of toc ? byLocal(toc, 'a') : []) {
            const href = a.getAttribute('href');
            const t = a.textContent?.replace(/\s+/g, ' ').trim();
            if (href && t) raw.push({ title: t, path: resolvePath(navItem.href, href), frag: fragmentOf(href) });
        }
    }
    if (!raw.length) {
        const ncxId = spineEl?.getAttribute('toc');
        const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find(m => m.type === 'application/x-dtbncx+xml');
        if (ncx && zip.file(ncx.href)) {
            const doc = parseXml(await read(ncx.href));
            for (const np of byLocal(doc, 'navPoint')) {
                const label = byLocal(np, 'text')[0]?.textContent?.replace(/\s+/g, ' ').trim();
                const src = byLocal(np, 'content')[0]?.getAttribute('src');
                if (label && src) raw.push({ title: label, path: resolvePath(ncx.href, src), frag: fragmentOf(src) });
            }
        }
    }
    const toc: EpubTocEntry[] = [];
    for (const r of raw) {
        const doc = docs.get(r.path);
        let anchor = '';
        if (doc && r.frag) {
            const el = doc.getElementById(r.frag) || doc.querySelector(`[name="${CSS_escape(r.frag)}"]`);
            if (el) anchor = extractText(el) || textAfter(el);
        }
        if (!anchor) anchor = fileText.get(r.path) || '';
        if (anchor) toc.push({ title: r.title, anchor: anchor.slice(0, ANCHOR_LEN) });
    }

    // 封面：EPUB3 cover-image → EPUB2 <meta name="cover"> → 名字里带 cover 的图片
    const coverMetaId = byLocal(opf, 'meta').find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
    const images = [...manifest.entries()].filter(([, m]) => m.type.startsWith('image/'));
    const coverItem = images.find(([, m]) => m.props.split(/\s+/).includes('cover-image'))
        || images.find(([id]) => id === coverMetaId)
        || images.find(([id, m]) => /cover/i.test(id) || /cover/i.test(m.href));
    let cover: Blob | undefined;
    if (coverItem && zip.file(coverItem[1].href)) {
        const bytes = await zip.file(coverItem[1].href)!.async('arraybuffer');
        cover = new Blob([bytes], { type: coverItem[1].type });
    }

    return { title, author, description, text, toc, cover };
}

/** 空锚点（如 <a id="x"/>）时，取它后面紧跟着的文字。 */
function textAfter(el: Element): string {
    let n: Node | null = el;
    let acc = '';
    while (n && acc.length < ANCHOR_LEN) {
        while (n && !n.nextSibling) n = n.parentNode;
        if (!n) break;
        n = n.nextSibling;
        if (n) acc += n.nodeType === 1 ? extractText(n) : (n.nodeValue || '').trim();
    }
    return acc.trim();
}

const CSS_escape = (s: string) => s.replace(/["\\]/g, '\\$&');
