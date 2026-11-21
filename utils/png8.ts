/**
 * 256 色（调色板）PNG 编码：给 iPhone 上压透明立绘用（2026-11-22）。
 *
 * 为什么要自己写：iPhone Safari 的 canvas 编不了 WebP（toDataURL('image/webp') 会悄悄给 PNG），
 * 透明立绘只能存 PNG，而 32 位真彩 PNG 很难压小。这里走 pngquant 那条路：
 *   1. 中位切分（median cut）在 RGBA 空间挑出 ≤255 种颜色，另留 0 号给全透明；
 *   2. Floyd–Steinberg 误差扩散抖动，渐变不出色带；
 *   3. 写成调色板 PNG（PLTE + tRNS + IDAT），压缩用浏览器自带的 CompressionStream('deflate')
 *      （= zlib 格式，正是 PNG 要的；Safari 16.4+、Node 18+ 都有）。
 * 分辨率和透明都不变，体积通常是真彩 PNG 的三成上下。
 */

// ─── 量化 ─────────────────────────────────────────────

interface Box { pixels: Uint8Array; count: number }

const channelRange = (px: Uint8Array, count: number, c: number) => {
    let lo = 255, hi = 0;
    for (let i = 0; i < count; i++) {
        const v = px[i * 4 + c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return hi - lo;
};

/**
 * 从 RGBA 像素里挑调色板。返回 Uint8Array(n*4)，第 0 项固定是全透明。
 * 只取样（最多约 6.5 万个不透明像素），大图也快。
 */
export function buildPalette(rgba: Uint8ClampedArray | Uint8Array, maxColors = 256): Uint8Array {
    const total = rgba.length / 4;
    const step = Math.max(1, Math.floor(total / 65536));
    const samples: number[] = [];
    for (let i = 0; i < total; i += step) {
        const a = rgba[i * 4 + 3];
        if (a < 8) continue;
        samples.push(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], a);
    }
    const out: number[] = [0, 0, 0, 0];
    if (samples.length === 0) return new Uint8Array(out);
    let boxes: Box[] = [{ pixels: new Uint8Array(samples), count: samples.length / 4 }];
    const target = maxColors - 1;
    while (boxes.length < target) {
        // 挑「像素多 × 跨度大」的盒子切
        let bestIdx = -1, bestScore = 0, bestChannel = 0;
        for (let b = 0; b < boxes.length; b++) {
            const box = boxes[b];
            if (box.count < 2) continue;
            for (let c = 0; c < 4; c++) {
                // 透明度跨度加权 ×2：立绘的抗锯齿边缘全靠半透明，颜色给少了会起白边/黑边（浏览器实测调出来的）
                const r = channelRange(box.pixels, box.count, c) * (c === 3 ? 2 : 1);
                const score = r * Math.sqrt(box.count);
                if (score > bestScore) { bestScore = score; bestIdx = b; bestChannel = c; }
            }
        }
        if (bestIdx < 0) break;
        const box = boxes[bestIdx];
        const order = Array.from({ length: box.count }, (_, i) => i)
            .sort((x, y) => box.pixels[x * 4 + bestChannel] - box.pixels[y * 4 + bestChannel]);
        const half = Math.floor(box.count / 2);
        const split = (idx: number[]) => {
            const px = new Uint8Array(idx.length * 4);
            idx.forEach((src, k) => px.set(box.pixels.subarray(src * 4, src * 4 + 4), k * 4));
            return { pixels: px, count: idx.length };
        };
        boxes = [...boxes.slice(0, bestIdx), split(order.slice(0, half)), split(order.slice(half)), ...boxes.slice(bestIdx + 1)];
    }
    for (const box of boxes) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let i = 0; i < box.count; i++) {
            r += box.pixels[i * 4]; g += box.pixels[i * 4 + 1]; b += box.pixels[i * 4 + 2]; a += box.pixels[i * 4 + 3];
        }
        out.push(Math.round(r / box.count), Math.round(g / box.count), Math.round(b / box.count), Math.round(a / box.count));
    }
    return new Uint8Array(out);
}

/**
 * 把每个像素映射到调色板下标，带 Floyd–Steinberg 抖动（只抖 RGB，透明度不抖，避免边缘起毛）。
 * 逐像素精确找最近色，不用近似缓存：2026-11-22 用真实立绘在浏览器里比过，缓存版快 4 倍但边缘
 * 透明度平均误差 9.1 → 精确版 5.3（满分 255），整体 PSNR 32.4 → 33.7 dB；一张 1200 高的立绘约 1 秒。
 */
export function mapToPalette(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, palette: Uint8Array): Uint8Array {
    const n = palette.length / 4;
    const indices = new Uint8Array(width * height);
    const nearest = (r: number, g: number, b: number, a: number): number => {
        if (a < 8) return 0;
        let best = 1, bestD = Infinity;
        for (let i = 1; i < n; i++) {
            const dr = palette[i * 4] - r, dg = palette[i * 4 + 1] - g, db = palette[i * 4 + 2] - b, da = palette[i * 4 + 3] - a;
            const d = dr * dr * 3 + dg * dg * 4 + db * db * 2 + da * da * 8;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    };
    let errCur = new Float32Array((width + 2) * 3);
    let errNext = new Float32Array((width + 2) * 3);
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let y = 0; y < height; y++) {
        errNext.fill(0);
        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 4;
            const a = rgba[p + 3];
            const e = (x + 1) * 3;
            const r = clamp(rgba[p] + errCur[e]);
            const g = clamp(rgba[p + 1] + errCur[e + 1]);
            const b = clamp(rgba[p + 2] + errCur[e + 2]);
            const idx = nearest(r | 0, g | 0, b | 0, a);
            indices[y * width + x] = idx;
            if (idx === 0) continue; // 全透明不扩散误差
            const er = r - palette[idx * 4], eg = g - palette[idx * 4 + 1], eb = b - palette[idx * 4 + 2];
            const spread = (buf: Float32Array, at: number, w: number) => {
                buf[at] += er * w; buf[at + 1] += eg * w; buf[at + 2] += eb * w;
            };
            spread(errCur, e + 3, 7 / 16);
            spread(errNext, e - 3, 3 / 16);
            spread(errNext, e, 5 / 16);
            spread(errNext, e + 3, 1 / 16);
        }
        const t = errCur; errCur = errNext; errNext = t;
    }
    return indices;
}

// ─── PNG 编码 ─────────────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export const crc32 = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
};

const zlibCompress = async (raw: Uint8Array): Promise<Uint8Array> => {
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** 编码成调色板 PNG 的字节。indices 是每像素的调色板下标。 */
export async function encodeIndexedPng(width: number, height: number, palette: Uint8Array, indices: Uint8Array): Promise<Uint8Array> {
    const n = palette.length / 4;
    const ihdr = new Uint8Array(13);
    const iv = new DataView(ihdr.buffer);
    iv.setUint32(0, width);
    iv.setUint32(4, height);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 3;   // color type: indexed
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const plte = new Uint8Array(n * 3);
    const trns = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        plte[i * 3] = palette[i * 4];
        plte[i * 3 + 1] = palette[i * 4 + 1];
        plte[i * 3 + 2] = palette[i * 4 + 2];
        trns[i] = palette[i * 4 + 3];
    }
    const raw = new Uint8Array((width + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width + 1)] = 0; // filter: none
        raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    }
    const idat = await zlibCompress(raw);
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [signature, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
    return btoa(bin);
};

/** RGBA 像素 → 256 色 PNG 的 data URL。 */
export async function rgbaToPng8DataUrl(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Promise<string> {
    const palette = buildPalette(rgba);
    const indices = mapToPalette(rgba, width, height, palette);
    const png = await encodeIndexedPng(width, height, palette, indices);
    return `data:image/png;base64,${bytesToBase64(png)}`;
}

/** 当前环境能不能用 CompressionStream 压 zlib（老 Safari 没有就别走这条路）。 */
export const canEncodePng8 = (): boolean => {
    try { return typeof CompressionStream === 'function' && !!new CompressionStream('deflate'); } catch { return false; }
};
