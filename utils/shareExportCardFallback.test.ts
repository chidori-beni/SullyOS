import { afterEach, describe, expect, it, vi } from 'vitest';

// 模拟「部署更新后旧页面还开着」：分享卡 chunk 的旧文件名已经 404，Safari 报这句。
vi.mock('../components/share/ShareCardDialog', () => {
  throw new TypeError('Importing a module script failed.');
});

// vitest 会把工厂里抛的错再包一层（原错在 cause 里），这里拆开再交给真的判定函数。
vi.mock('./chunkLoadRecovery', async (importOriginal) => {
  const real = await importOriginal<typeof import('./chunkLoadRecovery')>();
  return { ...real, isChunkLoadError: (e: any) => real.isChunkLoadError(e) || real.isChunkLoadError(e?.cause) };
});

import { shareOrDownloadBlob } from './shareExport';

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');

afterEach(() => {
  if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
  else Reflect.deleteProperty(navigator, 'share');
  if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
  else Reflect.deleteProperty(navigator, 'canShare');
});

describe('shareOrDownloadBlob 分享卡加载失败', () => {
  it('退回普通分享，文件照样导出', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) });

    const result = await shareOrDownloadBlob({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      fileName: 'appearance_可可点点.zip',
      card: { kind: 'appearance', title: '可可点点' },
    });

    expect(result).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0] as ShareData).files?.[0]?.name).toBe('appearance_可可点点.zip');
  });
});
