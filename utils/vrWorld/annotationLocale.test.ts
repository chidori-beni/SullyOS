import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { annotationLanguageRule, annotationKey, createAnnotationQueue, isCharacterAnnotation } from './annotationLocale';
import type { VRNovelAnnotation } from '../../types';
vi.mock('../safeApi', () => ({ safeFetchJson: vi.fn() }));
const annotation = (id = 'a'): VRNovelAnnotation => ({ id, novelId: 'book', authorId: 'char', authorName: '原角色名', content: '原始批注', segIdx: 1, createdAt: 1 });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const api = { baseUrl: 'https://example.invalid', apiKey: 'fake', model: 'test' };
it('changes only the requested annotation body language and preserves protocol names', () => {
  for (const locale of ['ja-JP', 'zh-CN'] as const) {
    const rule = annotationLanguageRule(locale);
    expect(rule).toContain(locale === 'ja-JP' ? '自然日语' : '简体中文');
    expect(rule).toContain('段落/回应');
    expect(rule).toContain('不改变动态播报或其他房间/聊天的语言');
  }
  const source = readFileSync('utils/vrWorld/runSession.ts', 'utf8');
  expect(source).toContain('libraryLocale = loadUiLocale()');
  expect(source).toContain('annotationLanguageRule(libraryLocale)');
  expect(source).toContain('DB.saveVRAnnotation({ ...ann, contentLocale: libraryLocale })');
  expect(source).toContain('content: pa.content');
});
it('separates source versions and excludes the user without requiring a live character card', () => {
  expect(isCharacterAnnotation(annotation())).toBe(true);
  expect(isCharacterAnnotation({ ...annotation(), authorId: 'user' })).toBe(false);
  expect(annotationKey(annotation())).not.toBe(annotationKey({ ...annotation(), content: '编辑后的批注' }));
  expect(annotationKey(annotation())).not.toBe(annotationKey({ ...annotation(), novelId: 'other' }));
});
it('deduplicates subscribers, removes cancelled queued work and serializes requests', async () => {
  const finish: Array<(value: { archetype: string; summary: string }) => void> = [];
  const translate = vi.fn(() => new Promise<{ archetype: string; summary: string }>(resolve => finish.push(resolve)));
  const subscribe = createAnnotationQueue({ translate });
  const a = vi.fn(), b = vi.fn(), cancelled = vi.fn();
  const close = subscribe(annotation(), api, a, vi.fn());
  subscribe(annotation(), api, b, vi.fn());
  const cancel = subscribe(annotation('cancelled'), api, cancelled, vi.fn());
  subscribe(annotation('last'), api, vi.fn(), vi.fn());
  cancel(); close(); await flush();
  expect(translate).toHaveBeenCalledTimes(1);
  finish[0]({ archetype: '注釈', summary: '訳文' }); await flush();
  expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledWith('訳文');
  expect(cancelled).not.toHaveBeenCalled(); expect(translate).toHaveBeenCalledTimes(2);
  finish[1]({ archetype: '注釈', summary: '最後' }); await flush();
});
it('uses API snapshots and forwards manual retry without mutating or saving annotations', async () => {
  const translate = vi.fn().mockResolvedValue({ archetype: '注釈', summary: '訳文' });
  const subscribe = createAnnotationQueue({ translate });
  const config = { ...api }, note = annotation(), original = JSON.stringify(note);
  subscribe(note, config, vi.fn(), vi.fn(), true); config.model = 'changed'; await flush();
  expect(translate.mock.calls[0][2].model).toBe('test');
  expect(translate.mock.calls[0][3]).toBe(true);
  expect(JSON.stringify(note)).toBe(original);
});
