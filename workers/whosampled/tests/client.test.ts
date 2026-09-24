import { describe, expect, it, vi } from 'vitest';
import { WhoSampledClient } from '../src/client.js';
import { MAX_HTML_BYTES } from '../src/html.js';

const url = 'https://www.whosampled.com/Fixture/Track/';
const htmlResponse = (text = '<html><body>Fixture</body></html>') => new Response(text, {
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

describe('HTTP client (mocked network)', () => {
  it('requests HTML with timeout, explicit identity and no automatic redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse());
    const client = new WhoSampledClient({ fetch: fetcher });
    await expect(client.get(url)).resolves.toMatchObject({ url, html: expect.stringContaining('Fixture') });
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({
      redirect: 'manual', signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ 'user-agent': 'SampleCheck-Prototype/0.1' }),
    }));
  });

  it.each([
    [403, 'ACCESS_BLOCKED'], [401, 'ACCESS_BLOCKED'], [429, 'RATE_LIMITED'],
  ])('stops queued requests after status %i', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status }));
    const client = new WhoSampledClient({ fetch: fetcher, intervalMs: 0 });
    const results = await Promise.allSettled([client.get(url), client.get(url)]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code });
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports Retry-After without retrying the blocked request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
      status: 429, headers: { 'retry-after': '120' },
    }));
    await expect(new WhoSampledClient({ fetch: fetcher }).get(url))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfter: '120' } });
  });

  it('detects challenge HTML even with HTTP 200 and stops this client', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => htmlResponse('<title>Just a moment...</title>'));
    const client = new WhoSampledClient({ fetch: fetcher, intervalMs: 0 });
    await expect(client.get(url)).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
    await expect(client.get(url)).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([[302, 'REDIRECT_REJECTED'], [404, 'HTTP_ERROR'], [503, 'HTTP_ERROR']])('reports HTTP %i without retry', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
      status, headers: { location: 'http://127.0.0.1/private' },
    }));
    await expect(new WhoSampledClient({ fetch: fetcher }).get(url)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects non-HTML responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }));
    await expect(new WhoSampledClient({ fetch: fetcher }).get(url)).rejects.toMatchObject({ code: 'UNEXPECTED_CONTENT_TYPE' });
  });

  it('limits actual streamed bytes even without Content-Length', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse('a'.repeat(MAX_HTML_BYTES + 1)));
    await expect(new WhoSampledClient({ fetch: fetcher }).get(url)).rejects.toMatchObject({ code: 'PAGE_TOO_LARGE' });
  });

  it('turns network failures into actionable errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(new WhoSampledClient({ fetch: fetcher }).get(url)).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });

  it('aborts timed-out requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    await expect(new WhoSampledClient({ fetch: fetcher, timeoutMs: 20 }).get(url))
      .rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('serializes requests and spaces their start times', async () => {
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return htmlResponse();
    });
    const client = new WhoSampledClient({ fetch: fetcher, intervalMs: 40 });
    await Promise.all([client.get(url), client.get(url), client.get(url)]);
    expect(maxActive).toBe(1);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(39);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(39);
  });

  it('validates the host before any request', () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new WhoSampledClient({ fetch: fetcher });
    expect(() => client.get('http://localhost:4000/')).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
