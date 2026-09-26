// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { chunkNovelText } from '../vrWorld/novel';
import { chaptersFromAnchors } from './bookroom';
import { EpubError, parseEpub, resolvePath } from './epub';

const filler = '他站在窗边看雨，想了很久也没有说话。'.repeat(30);
const xhtml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title><style>p{color:red}</style></head>
<body>${body}</body></html>`;
const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

async function toBuffer(zip: JSZip) {
    return zip.generateAsync({ type: 'arraybuffer' });
}

async function epub3() {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', container);
    zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>雪线以北</dc:title><dc:creator>某作者</dc:creator><dc:description>&lt;p&gt;一个关于&lt;b&gt;等待&lt;/b&gt;的故事&lt;/p&gt;</dc:description></metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
    zip.file('OEBPS/nav.xhtml', xhtml(`<nav epub:type="toc"><ol>
<li><a href="text/ch1.xhtml">第一章 重逢</a></li>
<li><a href="text/ch2.xhtml">第二章 旧信</a><ol><li><a href="text/ch2.xhtml#s2">二·下</a></li></ol></li></ol></nav>`));
    zip.file('OEBPS/text/ch1.xhtml', xhtml(`<h1>第一章 重逢</h1><p>${filler}</p><p>第一行<br/>第二行</p><p><ruby>雪<rt>xue</rt></ruby>落下来了。</p><img src="../images/cover.jpg"/>`));
    zip.file('OEBPS/text/ch2.xhtml', xhtml(`<h1>第二章 旧信</h1><p>${filler}</p><h2 id="s2">二·下</h2><p>她终于开口说：“你回来了。”${filler}</p>`));
    zip.file('OEBPS/images/cover.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    return toBuffer(zip);
}

describe('EPUB 导入', () => {
    it('EPUB3：书名、作者、简介、正文文字、自带目录、封面', async () => {
        const book = await parseEpub(await epub3());
        expect(book.title).toBe('雪线以北');
        expect(book.author).toBe('某作者');
        expect(book.description).toBe('一个关于等待的故事');
        expect(book.text).toContain('第一行\n第二行');
        expect(book.text).toContain('雪落下来了。');
        expect(book.text).not.toContain('xue');
        expect(book.text).not.toContain('color:red');
        expect(book.toc.map(t => t.title)).toEqual(['第一章 重逢', '第二章 旧信', '二·下']);
        expect(book.toc[2].anchor.startsWith('二·下')).toBe(true);
        expect(book.cover?.type).toBe('image/jpeg');
        expect(book.cover?.size).toBe(7);
    });

    it('目录能对到切好的段落块上，且按顺序', async () => {
        const book = await parseEpub(await epub3());
        const segments = chunkNovelText(book.text);
        const chapters = chaptersFromAnchors(segments, book.toc);
        expect(chapters.map(c => c.title)).toEqual(['第一章 重逢', '第二章 旧信', '二·下']);
        expect(segments[chapters[0].segIdx].text).toContain('第一章 重逢');
        expect(segments[chapters[2].segIdx].text).toContain('二·下');
        expect(chapters[1].segIdx).toBeLessThan(chapters[2].segIdx);
    });

    it('EPUB2：NCX 目录 + meta 封面', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', container);
        zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>旧书</dc:title><meta name="cover" content="cov"/></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="a" href="a.html" media-type="application/xhtml+xml"/><item id="cov" href="c.png" media-type="image/png"/></manifest>
<spine toc="ncx"><itemref idref="a"/></spine></package>`);
        zip.file('OEBPS/toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
<navPoint id="n1"><navLabel><text>楔子</text></navLabel><content src="a.html"/></navPoint></navMap></ncx>`);
        // 不规范的 HTML（没闭合的 <p>）也要能读
        zip.file('OEBPS/a.html', '<html><body><p>楔子<p>很久以前的故事。</body></html>');
        zip.file('OEBPS/c.png', new Uint8Array([137, 80, 78, 71]));
        const book = await parseEpub(await toBuffer(zip));
        expect(book.title).toBe('旧书');
        expect(book.text).toContain('很久以前的故事。');
        expect(book.toc).toEqual([{ title: '楔子', anchor: expect.stringContaining('楔子') }]);
        expect(book.cover?.type).toBe('image/png');
    });

    it('正文加密（DRM）的书直接说明原因；只加密字体的照常读', async () => {
        const drm = new JSZip();
        drm.file('META-INF/container.xml', container);
        drm.file('META-INF/encryption.xml', '<encryption><EncryptedData><CipherReference URI="OEBPS/text/ch1.xhtml"/></EncryptedData></encryption>');
        await expect(parseEpub(await toBuffer(drm))).rejects.toThrow(/DRM/);

        const zip = await JSZip.loadAsync(await epub3());
        zip.file('META-INF/encryption.xml', '<encryption><EncryptedData><CipherReference URI="OEBPS/fonts/a.otf"/></EncryptedData></encryption>');
        await expect(parseEpub(await toBuffer(zip))).resolves.toMatchObject({ title: '雪线以北' });
    });

    it('不是 EPUB 的文件给出看得懂的错误', async () => {
        await expect(parseEpub(new TextEncoder().encode('hello').buffer as ArrayBuffer)).rejects.toBeInstanceOf(EpubError);
    });

    it('相对路径解析', () => {
        expect(resolvePath('OEBPS/content.opf', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
        expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a%20b.jpg#x')).toBe('OEBPS/images/a b.jpg');
    });
});
