/**
 * imageSave.ts —— 把聊天里的图片存出去
 *
 * 两条完全不同的「保存」：
 *
 * 1. **存到手机**（`saveImageToDevice`）——真的落到 iOS 相册 / 电脑下载文件夹。
 *    iOS 独立 PWA 里 `<a download>` 对 data URL 基本没用（要么静默失败、要么跳去
 *    Safari 显示一堆 base64），唯一稳的是 **Web Share 的 files 分享**：弹系统分享面板，
 *    里面就有「存储图像」。所以优先级是 share → download → 新标签页兜底。
 *
 * 2. **存进 App 自己的相册**（`saveImageToGallery`）——写 IndexedDB 的 gallery 表，
 *    也就是「相册」App 看到的那个。角色生的图和用户自己发的图本来就会自动入库，
 *    这个函数是给「看大图时手动补存一次」和历史消息用的。
 *
 * ⚠️ **不要在调用 `navigator.share` 之前 await 任何东西**。iOS 只认「用户手势那一拍」
 * 里发起的分享，中间插一个 `await fetch(dataUrl)` 手势就过期了，表现为
 * `NotAllowedError`。所以 data URL → Blob 走同步的 `atob`，不走 fetch。
 */

import { DB } from './db';

export type SaveImageMethod = 'share' | 'download' | 'newtab' | 'none';

export interface SaveImageResult {
    ok: boolean;
    method: SaveImageMethod;
    /** 直接拿去 toast 的中文说明 */
    message: string;
}

/** data URL 的 MIME，取不到就按 png 算。 */
export function dataUrlMime(dataUrl: string): string {
    const m = /^data:([^;,]+)[;,]/.exec(dataUrl || '');
    return m ? m[1] : 'image/png';
}

/** 按 MIME 给个扩展名，只认我们自己会产出的那几种。 */
export function extensionForMime(mime: string): string {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'png';
}

/**
 * data URL → Blob，**同步**。
 * 同步是硬要求，见文件头注释：异步会让 iOS 的分享手势过期。
 */
export function dataUrlToBlobSync(dataUrl: string): Blob {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('这不是一个 data URL');
    const meta = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const mime = dataUrlMime(dataUrl);

    if (!meta.includes(';base64')) {
        return new Blob([decodeURIComponent(body)], { type: mime });
    }
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/**
 * 存到手机。**必须在用户点击的同一拍里调用**，中间不要 await 别的东西。
 * 不抛异常：失败也是一种要显示给用户的结果。
 */
export async function saveImageToDevice(dataUrl: string, filenameBase = 'sullyos'): Promise<SaveImageResult> {
    if (!dataUrl) return { ok: false, method: 'none', message: '这条消息里没有图片' };

    let blob: Blob;
    try {
        blob = dataUrlToBlobSync(dataUrl);
    } catch (e: any) {
        // 不是 data URL（比如外链图），交给浏览器自己开
        try {
            window.open(dataUrl, '_blank');
            return { ok: true, method: 'newtab', message: '已在新页面打开，长按图片即可存到相册' };
        } catch {
            return { ok: false, method: 'none', message: `保存失败：${e?.message || e}` };
        }
    }

    const ext = extensionForMime(blob.type);
    const filename = `${filenameBase}-${Date.now()}.${ext}`;

    // ① Web Share（iOS 的正解：分享面板里有「存储图像」）
    try {
        const file = new File([blob], filename, { type: blob.type });
        const nav = navigator as any;
        if (nav?.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
            await nav.share({ files: [file] });
            return { ok: true, method: 'share', message: '已打开分享面板，选「存储图像」即可存进相册' };
        }
    } catch (e: any) {
        // 用户自己点了取消不算失败，也不该再退到下载去打扰他
        if (e?.name === 'AbortError') return { ok: true, method: 'share', message: '' };
        console.warn('[存图] 分享面板不可用，改走下载：', e);
    }

    // ② <a download>（桌面浏览器 / Android 的正解）
    let objectUrl = '';
    try {
        objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // 立刻 revoke 会让部分浏览器下到空文件，给一拍时间
        setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ } }, 30_000);
        return { ok: true, method: 'download', message: '已开始下载' };
    } catch (e) {
        if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ } }
        console.warn('[存图] 下载失败，改开新页面：', e);
    }

    // ③ 新标签页兜底：至少能长按存图
    try {
        window.open(dataUrl, '_blank');
        return { ok: true, method: 'newtab', message: '已在新页面打开，长按图片即可存到相册' };
    } catch (e: any) {
        return { ok: false, method: 'none', message: `保存失败：${e?.message || e}` };
    }
}

/**
 * 存进 App 自己的相册（IndexedDB gallery 表）。
 * 返回新建的相册记录 id，调用方应把它写回消息 metadata，避免同一张图被反复存进相册。
 */
export async function saveImageToGallery(
    charId: string,
    dataUrl: string,
    options?: { chatContext?: string[]; idPrefix?: string },
): Promise<string> {
    const now = new Date();
    const savedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const id = `${options?.idPrefix || 'img-saved'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await DB.saveGalleryImage({
        id,
        charId,
        url: dataUrl,
        timestamp: Date.now(),
        savedDate,
        chatContext: options?.chatContext,
    });
    return id;
}
