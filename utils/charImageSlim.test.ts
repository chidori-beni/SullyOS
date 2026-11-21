import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ DB: {} }));
vi.mock('./blobRef', () => ({ getBlobForRef: vi.fn(), putImageBlob: vi.fn() }));

import { buildSlimPatch, collectSlimTargets, totalSlimChars } from './charImageSlim';
import type { SkinSet } from '../types';

const png = (n: number) => `data:image/png;base64,${'A'.repeat(n)}`;

describe('立绘瘦身：找图', () => {
  it('只收内联图片：立绘、皮肤立绘、见面背景；跳过 blobref / 网络图 / gif', () => {
    const targets = collectSlimTargets({
      sprites: { normal: png(10), happy: png(20), chibi: 'blobref:img_1', web: 'https://x/y.png', gif: 'data:image/gif;base64,AAA' },
      dateSkinSets: [{ id: 's1', name: '夏装', sprites: { normal: png(5), url: 'https://x/z.png' } }],
      dateBackground: png(30),
    });
    expect(targets.map(t => t.path)).toEqual(['sprites/normal', 'sprites/happy', 'skin/s1/normal', 'dateBackground']);
    expect(targets.find(t => t.path === 'dateBackground')?.kind).toBe('background');
    expect(targets.find(t => t.path === 'skin/s1/normal')?.label).toBe('皮肤 夏装 · normal');
    expect(totalSlimChars(targets)).toBe(targets.reduce((s, t) => s + t.value.length, 0));
  });

  it('什么都没有时返回空', () => {
    expect(collectSlimTargets({})).toEqual([]);
  });
});

describe('立绘瘦身：合成补丁', () => {
  const char = {
    sprites: { normal: png(10), happy: png(20) } as Record<string, string>,
    dateSkinSets: [
      { id: 's1', name: '夏装', sprites: { normal: png(5) } as Record<string, string> },
      { id: 's2', name: '冬装', sprites: { sad: png(6) } as Record<string, string> },
    ] as SkinSet[],
    dateBackground: png(30),
  };

  it('只替换点名的位置，其它原样保留，不改原对象', () => {
    const patch = buildSlimPatch(char, new Map([
      ['sprites/happy', 'NEW_HAPPY'],
      ['skin/s2/sad', 'NEW_SAD'],
      ['dateBackground', 'NEW_BG'],
    ]));
    expect(patch.sprites).toEqual({ normal: char.sprites.normal, happy: 'NEW_HAPPY' });
    expect(patch.dateSkinSets?.[0].sprites.normal).toBe(char.dateSkinSets[0].sprites.normal);
    expect(patch.dateSkinSets?.[1].sprites.sad).toBe('NEW_SAD');
    expect(patch.dateBackground).toBe('NEW_BG');
    expect(char.sprites.happy).toBe(png(20));
    expect(char.dateSkinSets[1].sprites.sad).toBe(png(6));
  });

  it('没改到的字段不出现在补丁里', () => {
    const patch = buildSlimPatch(char, new Map([['sprites/normal', 'X']]));
    expect(Object.keys(patch)).toEqual(['sprites']);
  });

  it('角色里已经没有的位置（还原时立绘被删过）不会被凭空加回来', () => {
    const patch = buildSlimPatch(char, new Map([['sprites/gone', 'X'], ['skin/nope/normal', 'Y']]));
    expect(patch.sprites).toEqual(char.sprites);
    expect(patch.dateSkinSets?.map(s => s.sprites)).toEqual(char.dateSkinSets.map(s => s.sprites));
  });
});
