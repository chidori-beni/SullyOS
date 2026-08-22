import { describe, it, expect } from 'vitest';
import { blobsAreIdentical, speedJitterForAttempt } from './blobEquals';

const blobOf = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });

describe('blobsAreIdentical', () => {
  it('同一个引用直接判等', async () => {
    const b = blobOf([1, 2, 3]);
    expect(await blobsAreIdentical(b, b)).toBe(true);
  });

  it('字节相同但不是同一个对象也判等', async () => {
    expect(await blobsAreIdentical(blobOf([1, 2, 3]), blobOf([1, 2, 3]))).toBe(true);
  });

  it('长度不同判不等', async () => {
    expect(await blobsAreIdentical(blobOf([1, 2, 3]), blobOf([1, 2, 3, 4]))).toBe(false);
  });

  it('长度相同内容不同判不等', async () => {
    expect(await blobsAreIdentical(blobOf([1, 2, 3]), blobOf([1, 2, 4]))).toBe(false);
  });

  it('任一侧为空判不等（没有「上一条」时不触发重试）', async () => {
    expect(await blobsAreIdentical(null, blobOf([1]))).toBe(false);
    expect(await blobsAreIdentical(blobOf([1]), undefined)).toBe(false);
  });

  it('两个空 blob 判等', async () => {
    expect(await blobsAreIdentical(blobOf([]), blobOf([]))).toBe(true);
  });
});

describe('speedJitterForAttempt', () => {
  it('幅度始终在 ±0.04 以内（听不出快慢差别）', () => {
    for (let i = 0; i < 20; i++) {
      expect(Math.abs(speedJitterForAttempt(i))).toBeLessThanOrEqual(0.04);
    }
  });

  it('相邻两次取到不同的值，不会连着两次发同一个请求体', () => {
    expect(speedJitterForAttempt(0)).not.toBe(speedJitterForAttempt(1));
    expect(speedJitterForAttempt(1)).not.toBe(speedJitterForAttempt(2));
  });

  it('永远不返回 0（0 等于没抖动，重试就白打了）', () => {
    for (let i = 0; i < 20; i++) expect(speedJitterForAttempt(i)).not.toBe(0);
  });

  it('负数 / 越界的 attempt 也能拿到合法值', () => {
    expect(typeof speedJitterForAttempt(-3)).toBe('number');
    expect(Math.abs(speedJitterForAttempt(999))).toBeLessThanOrEqual(0.04);
  });
});
