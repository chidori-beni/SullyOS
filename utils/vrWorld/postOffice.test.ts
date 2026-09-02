import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertCompleteLetterReceipt,
    DEFAULT_POST_OFFICE_BASE,
    getPostOfficeBase,
    normalizePostOfficeBase,
    probePostOfficeBase,
    PostOfficeError,
} from './postOffice';

describe('post office endpoint configuration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('keeps the default and normalizes a trusted HTTPS base', () => {
        expect(getPostOfficeBase()).toBe(DEFAULT_POST_OFFICE_BASE);
        expect(normalizePostOfficeBase(' https://example.test/po/// ')).toBe('https://example.test/po');
    });

    it('rejects insecure or credential-bearing endpoint values', () => {
        expect(() => normalizePostOfficeBase('http://example.test/po')).toThrow('必须使用 HTTPS');
        expect(() => normalizePostOfficeBase('https://user:pass@example.test/po')).toThrow('不能包含账号或密码');
        expect(() => normalizePostOfficeBase('https://example.test/po?token=secret')).toThrow('不能包含查询参数');
    });

    it('probes a candidate without changing the current saved endpoint', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Load failed'));

        const result = await probePostOfficeBase('https://blocked.example/po');

        expect(result.status).toBe('network_unreachable');
        expect(result.message).toContain('blocked.example');
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(getPostOfficeBase()).toBe(DEFAULT_POST_OFFICE_BASE);
    });

    it('accepts only the expected SullyOS health response', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, service: 'sullyos-post-office' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(probePostOfficeBase('https://worker.example/po')).resolves.toMatchObject({
            status: 'reachable',
            base: 'https://worker.example/po',
            host: 'worker.example',
        });
    });

    it('reports an HTTP block and a wrong service separately', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>blocked</html>', { status: 403 }));
        await expect(probePostOfficeBase('https://blocked.example/po')).resolves.toMatchObject({ status: 'http_error', httpStatus: 403 });

        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: 'other-service' }), { status: 200 }));
        await expect(probePostOfficeBase('https://wrong.example/po')).resolves.toMatchObject({ status: 'invalid_service' });
    });
});

describe('post office letter receipts', () => {
    it('requires the complete set of unique non-empty remote IDs', () => {
        expect(assertCompleteLetterReceipt(['remote-a', 'remote-b'], 2)).toEqual(['remote-a', 'remote-b']);

        for (const receipt of [[], ['remote-a'], ['remote-a', 'remote-a'], ['remote-a', '']]) {
            try {
                assertCompleteLetterReceipt(receipt, 2);
                throw new Error('expected receipt validation to fail');
            } catch (error) {
                expect(error).toBeInstanceOf(PostOfficeError);
                expect((error as PostOfficeError).kind).toBe('protocol');
            }
        }
    });
});
