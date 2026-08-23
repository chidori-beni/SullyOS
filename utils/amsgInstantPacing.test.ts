import { describe, expect, it } from 'vitest';
import {
  getInstantChunkIndex,
  getInstantChunkPacingDelay,
  getInstantChunkSessionId,
  INSTANT_CHUNK_PACING_MS,
} from './amsgInstantPacing';

describe('instant chunk pacing', () => {
  it('默认间隔保持在更自然的 1.2 秒', () => {
    expect(INSTANT_CHUNK_PACING_MS).toBe(1_200);
  });

  it('读取顶层或 metadata 的 session / 段号', () => {
    expect(getInstantChunkSessionId({ sessionId: 's-1', metadata: { sessionId: 'old' } })).toBe('s-1');
    expect(getInstantChunkSessionId({ metadata: { sessionId: 's-2' } })).toBe('s-2');
    expect(getInstantChunkIndex({ metadata: { messageIndex: 3 } })).toBe(3);
    expect(getInstantChunkIndex({ metadata: { messageIndex: 'bad' } })).toBe(0);
  });

  it('首段不等待，后段只补足相邻段间隔', () => {
    expect(getInstantChunkPacingDelay(null, 10_000)).toBe(0);
    expect(getInstantChunkPacingDelay(10_000, 10_200)).toBe(INSTANT_CHUNK_PACING_MS - 200);
    expect(getInstantChunkPacingDelay(10_000, 11_200)).toBe(0);
  });
});
