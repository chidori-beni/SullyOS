/**
 * 封面压缩：缩到书架够用的尺寸，转 JPEG data URL（通常几十 KB）。
 * 直接存在书房记录里，不走 blobref —— vr_settings 备份时不会把令牌解析回图片，用令牌会丢封面。
 */
const MAX_W = 420;
const MAX_H = 630;

export class CoverError extends Error {}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new CoverError('这张图打不开（格式不支持或文件损坏）')); };
        img.src = url;
    });
}

export async function compressCover(blob: Blob): Promise<string> {
    if (!blob.type.startsWith('image/')) throw new CoverError('请选一张图片');
    const img = await loadImage(blob);
    const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CoverError('压缩封面失败');
    // 透明 PNG 转 JPEG 会变黑底，先铺一层纸色
    ctx.fillStyle = '#fbf8f2';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.82);
}
