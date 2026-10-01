import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The deployed Worker entry is intentionally plain runtime JavaScript.
import worker from '../index.js';

const COOKIE = `a1=${'a'.repeat(52)}; web_session=test-session`;
// 1x1 PNG header is enough for imageSize().
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0xad, 0, 0, 6, 0x88]);
const FILE_ID = 'oss-sg/spectrum/TestFileId123';

const publish = (platform: string, body: Record<string, unknown>) =>
  worker.fetch(
    new Request('https://local.test/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-xhs-cookie': COOKIE, 'x-xhs-platform': platform },
      body: JSON.stringify(body),
    }),
    {},
    { waitUntil() {} },
  );

const mockRednote = (putStatuses: number[] = [200]) => {
  const calls: { url: URL; method: string; headers: Headers; body?: string }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const headers = new Headers(init.headers);
    calls.push({ url, method, headers, body: typeof init.body === 'string' ? init.body : undefined });
    if (url.hostname === 'img.test') return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    if (url.hostname === 'creator.rednote.com' && url.pathname === '/api/media/v1/upload/creator/permit') {
      return Response.json({ success: true, data: { uploadTempPermits: [{ token: 'tok:policy', uploadAddr: 'upload.rnote.com', expireTime: 1790964248936, fileIds: [FILE_ID] }] } });
    }
    if (url.hostname === 'upload.rnote.com') return new Response('', { status: putStatuses.shift() ?? 200 });
    if (url.hostname === 'webapi.rednote.com' && url.pathname === '/web_api/sns/v2/note') {
      return Response.json({ success: true, data: { id: '6abea0ab000000001901e0e0' } });
    }
    return new Response('unexpected', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
};

describe('RedNote image publish', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses creator.rednote.com permit, upload.rnote.com full path, and webapi.rednote.com note', async () => {
    const calls = mockRednote();
    const res = await publish('rednote', { title: '测试', content: 'hi', images: ['https://img.test/a.png'], visibility: 'private' });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.note_id).toBe('6abea0ab000000001901e0e0');

    const img = calls.find((c) => c.url.hostname === 'img.test')!;
    expect(img.headers.get('user-agent')).toMatch(/Mozilla/);

    const put = calls.find((c) => c.url.hostname === 'upload.rnote.com')!;
    expect(put.method).toBe('PUT');
    expect(put.url.pathname).toBe(`/${FILE_ID}`);
    expect(put.headers.get('x-cos-security-token')).toBe('tok:policy');
    expect(put.headers.get('cookie')).toBeNull();

    const note = calls.find((c) => c.url.pathname === '/web_api/sns/v2/note')!;
    expect(note.url.hostname).toBe('webapi.rednote.com');
    expect(note.headers.get('origin')).toBe('https://creator.rednote.com');
    expect(note.headers.get('x-rap-param')).toBeTruthy();
    const payload = JSON.parse(note.body!);
    expect(payload.image_info.images[0].file_id).toBe(FILE_ID);
    expect(payload.common.privacy_info.type).toBe(1);
    expect(payload.common.business_binds).toContain('noteCopyBind');
    expect(calls.some((c) => c.url.hostname.endsWith('xiaohongshu.com'))).toBe(false);
  });

  it('retries the upload once with a COS signature when the bare token is rejected', async () => {
    const calls = mockRednote([403, 200]);
    const json = await (await publish('rednote', { title: 't', images: ['https://img.test/a.png'] })).json();
    expect(json.success).toBe(true);
    const puts = calls.filter((c) => c.url.hostname === 'upload.rnote.com');
    expect(puts).toHaveLength(2);
    expect(puts[0].headers.get('authorization')).toBeNull();
    expect(puts[1].headers.get('authorization')).toMatch(/^q-sign-algorithm=sha1/);
  });

  it('reports the upload failure text instead of a generic error', async () => {
    mockRednote([403, 403]);
    const json = await (await publish('rednote', { title: 't', images: ['https://img.test/a.png'] })).json();
    expect(JSON.stringify(json)).toContain('图片上传失败 403');
  });
});
