// @vitest-environment node
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPalette, crc32, encodeIndexedPng, mapToPalette, rgbaToPng8DataUrl } from './png8';

/** 测试用：一块带透明边的渐变立绘 */
const makeImage = (w: number, h: number) => {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inside = (x - w / 2) ** 2 / (w / 2.4) ** 2 + (y - h / 2) ** 2 / (h / 2.2) ** 2 < 1;
    px[i] = (x * 255) / w; px[i + 1] = (y * 255) / h; px[i + 2] = 180; px[i + 3] = inside ? 255 : 0;
  }
  return px;
};

const readChunks = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  let at = 8;
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    const crc = view.getUint32(at + 8 + len);
    chunks.push({ type, data, crcOk: crc === crc32(png.subarray(at + 4, at + 8 + len)) });
    at += 12 + len;
  }
  return chunks;
};

describe('256 色 PNG', () => {
  it('调色板不超过 256 色，0 号是全透明', () => {
    const img = makeImage(64, 80);
    const palette = buildPalette(img);
    expect(palette.length / 4).toBeLessThanOrEqual(256);
    expect(Array.from(palette.subarray(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('透明像素一律映射到 0 号，不透明像素不会落到 0 号', () => {
    const w = 64, h = 80, img = makeImage(w, h);
    const palette = buildPalette(img);
    const idx = mapToPalette(img, w, h, palette);
    for (let i = 0; i < w * h; i++) {
      if (img[i * 4 + 3] === 0) expect(idx[i]).toBe(0);
      else expect(idx[i]).not.toBe(0);
    }
  });

  it('编出来的是合法 PNG：签名、块顺序、CRC 全对，解压后逐字节还原下标', async () => {
    const w = 37, h = 23, img = makeImage(w, h);
    const palette = buildPalette(img);
    const idx = mapToPalette(img, w, h, palette);
    const png = await encodeIndexedPng(w, h, palette, idx);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = readChunks(png);
    expect(chunks.map(c => c.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
    expect(chunks.every(c => c.crcOk)).toBe(true);
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0].data[8], chunks[0].data[9]]).toEqual([w, h, 8, 3]);
    const raw = inflateSync(chunks[3].data);
    expect(raw.length).toBe((w + 1) * h);
    for (let y = 0; y < h; y++) {
      expect(raw[y * (w + 1)]).toBe(0);
      expect(Array.from(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)))).toEqual(Array.from(idx.subarray(y * w, (y + 1) * w)));
    }
  });

  it('data URL 比同尺寸真彩 RGBA 原始数据小得多', async () => {
    const w = 200, h = 260, img = makeImage(w, h);
    const url = await rgbaToPng8DataUrl(img, w, h);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeLessThan(w * h * 4 * 0.5);
  });
});
