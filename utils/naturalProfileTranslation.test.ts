import { expect, it, vi } from 'vitest';
import { createProfileTranslator, profileTranslationKey, PROFILE_TRANSLATION_CACHE } from './naturalProfileTranslation';
vi.mock('./safeApi', () => ({ safeFetchJson: vi.fn() }));
const api = { baseUrl: 'https://example.invalid/v1/', apiKey: 'FAKE_SECRET', model: 'test-model' };
const source = { archetype: '牵挂型', summary: '更容易因挂念主动联系，但仍会克制。' };
const japanese = { archetype: '気にかけるタイプ', summary: '気になって連絡しやすいものの、節度は保ちます。' };
const response = (text = japanese) => ({ choices: [{ message: { content: JSON.stringify(text) } }] });
const memory = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; };
it('deduplicates concurrent requests, sends only two fields and never mutates the original profile', async () => {
  const fetch = vi.fn().mockResolvedValue(response()), store = memory();
  const service = createProfileTranslator(fetch, () => store), before = JSON.stringify(source);
  const results = await Promise.all([service.translate('a', source, api), service.translate('a', source, api)]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(results).toEqual([japanese, japanese]);
  const args = fetch.mock.calls[0];
  expect(args[0]).toBe('https://example.invalid/v1/chat/completions');
  expect(args.slice(2)).toEqual([0, 60000]);
  const body = JSON.parse(args[1].body);
  expect(JSON.parse(body.messages[1].content)).toEqual(source);
  expect(body.stream).toBe(false);
  expect(JSON.stringify(source)).toBe(before);
  expect(store.getItem(PROFILE_TRANSLATION_CACHE)).not.toContain('FAKE_SECRET');
});
it('reuses persistent cache after reload and invalidates on role/source changes, not scoring fields', async () => {
  const fetch = vi.fn().mockResolvedValue(response()), store = memory();
  await createProfileTranslator(fetch, () => store).translate('a', source, api);
  const service = createProfileTranslator(fetch, () => store);
  await service.translate('a', { ...source, threshold: 0.8 } as typeof source, api);
  expect(fetch).toHaveBeenCalledTimes(1);
  await service.translate('b', source, api);
  await service.translate('a', { ...source, summary: '新的说明' }, api);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('latches errors across reopening, permits explicit retry, and redacts credentials', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('HTTP 403 FAKE_SECRET')).mockResolvedValue(response());
  const service = createProfileTranslator(fetch, memory);
  await expect(service.translate('a', source, api)).rejects.toThrow('HTTP 403 [redacted]');
  await expect(service.translate('a', source, api)).rejects.toThrow('HTTP 403 [redacted]');
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(service.translate('a', source, api, true)).resolves.toEqual(japanese);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each(['not JSON', '{"archetype":"","summary":"x"}', '{"archetype":1,"summary":"x"}', '{"archetype":"x","summary":"y","threshold":0.1}'])('rejects malformed result %s without caching or retrying', async content => {
  const fetch = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }), service = createProfileTranslator(fetch, memory);
  await expect(service.translate('a', source, api)).rejects.toThrow();
  expect(service.read(profileTranslationKey('a', source))).toBeUndefined();
  await expect(service.translate('a', source, api)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('falls back to memory when storage is denied and tolerates corrupted cache', async () => {
  const fetch = vi.fn().mockResolvedValue(response());
  const service = createProfileTranslator(fetch, () => { throw new Error('denied'); });
  await service.translate('a', source, api);
  await service.translate('a', source, api);
  expect(fetch).toHaveBeenCalledTimes(1);
  const broken = createProfileTranslator(fetch, () => ({ getItem: () => 'broken', setItem: () => {} }));
  await expect(broken.translate('b', source, api)).resolves.toEqual(japanese);
});
it('keeps late results separated by character and source; config changes do not join old requests', async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  const fetch = vi.fn(() => new Promise(resolve => resolvers.push(resolve)));
  const service = createProfileTranslator(fetch, memory);
  const first = service.translate('a', source, api), second = service.translate('b', source, api), third = service.translate('a', source, { ...api, model: 'new-model' });
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(3);
  resolvers[1](response({ archetype: '別の役', summary: '別の説明' }));
  await second;
  expect(service.read(profileTranslationKey('a', source))).toBeUndefined();
  resolvers[2](response()); await third;
  resolvers[0](response({ archetype: '遅い結果', summary: '古いリクエスト' })); await first;
  expect(service.read(profileTranslationKey('a', source))).toEqual(japanese);
});
it('bounds persistent cache and rejects missing API without a network request', async () => {
  const fetch = vi.fn().mockResolvedValue(response()), store = memory(), service = createProfileTranslator(fetch, () => store);
  await expect(service.translate('a', source, { ...api, apiKey: '' })).rejects.toThrow('incomplete');
  expect(fetch).not.toHaveBeenCalled();
  for (let index = 0; index < 36; index++) await service.translate(String(index), source, api);
  const raw = store.getItem(PROFILE_TRANSLATION_CACHE)!;
  expect(JSON.parse(raw)).toHaveLength(32);
  expect(raw.length * 2).toBeLessThanOrEqual(256 * 1024);
});

it('accepts complete tagged translations with quotes and newlines without JSON escaping', async () => {
  const content = '<profile_label>「気になる」タイプ</profile_label>\n<profile_summary>「元気？」と考えます。\nただし "必ず" 連絡するわけではありません。</profile_summary>';
  const fetch = vi.fn().mockResolvedValue({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  const service = createProfileTranslator(fetch, memory);
  await expect(service.translate('a', source, api)).resolves.toEqual({ archetype: '「気になる」タイプ', summary: '「元気？」と考えます。\nただし "必ず" 連絡するわけではありません。' });
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.max_tokens).toBe(4000);
  expect(body.messages[0].content).toContain('<profile_label>');
  expect(body).not.toHaveProperty('response_format');
});
it.each([
  '<profile_label>分類</profile_label><profile_summary>途中',
  '<profile_label>分類</profile_label><profile_summary>説明</profile_summary>追記',
  '<profile_label>分類</profile_label><profile_label>重複</profile_label><profile_summary>説明</profile_summary>',
  '{"archetype":"分類","summary":"途中',
])('rejects incomplete/ambiguous model text and labels the failure stage: %s', async content => {
  const fetch = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }), service = createProfileTranslator(fetch, memory);
  await expect(service.translate('a', source, api)).rejects.toThrow('MODEL_TEXT');
  expect(service.read(profileTranslationKey('a', source))).toBeUndefined();
  await expect(service.translate('a', source, api)).rejects.toThrow('MODEL_TEXT');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects length-truncated responses even when text looks complete', async () => {
  const data = { ...response(), choices: [{ ...response().choices[0], finish_reason: 'length' }] };
  const service = createProfileTranslator(vi.fn().mockResolvedValue(data), memory);
  await expect(service.translate('a', source, api)).rejects.toThrow('OUTPUT_TRUNCATED');
  expect(service.read(profileTranslationKey('a', source))).toBeUndefined();
});
it('distinguishes an outer API-response parse failure without repeating the request', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('JSON Parse error: Unterminated string'));
  const service = createProfileTranslator(fetch, memory);
  await expect(service.translate('a', source, api)).rejects.toThrow('API_RESPONSE');
  await expect(service.translate('a', source, api)).rejects.toThrow('Unterminated string');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('still accepts a complete fenced JSON result from an older provider', async () => {
  const data = { choices: [{ message: { content: '```json\n' + JSON.stringify(japanese) + '\n```' } }] };
  const service = createProfileTranslator(vi.fn().mockResolvedValue(data), memory);
  await expect(service.translate('a', source, api)).resolves.toEqual(japanese);
});

it('keeps optional note cache/prompt isolated without changing profile defaults', async () => {
  const fetch = vi.fn().mockResolvedValue(response()), store = memory();
  const notes = createProfileTranslator(fetch, () => store, { cacheKey: 'notes-only', systemPrompt: 'Translate only this note' });
  await notes.translate('a', source, api);
  expect(store.getItem('notes-only')).toBeTruthy();
  expect(store.getItem(PROFILE_TRANSLATION_CACHE)).toBeNull();
  expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toBe('Translate only this note');
  expect(createProfileTranslator(fetch, () => store).read(profileTranslationKey('a', source))).toBeUndefined();
});
