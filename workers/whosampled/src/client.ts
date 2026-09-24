import { setTimeout as delay } from 'node:timers/promises';
import { ScrapeError } from './errors.js';
import { loadPage, MAX_HTML_BYTES } from './html.js';
import { whoSampledUrl } from './urls.js';

interface ClientOptions {
  fetch?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
}

export class WhoSampledClient {
  private readonly fetcher: typeof fetch;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private tail: Promise<unknown> = Promise.resolve();
  private lastStarted = 0;
  private stopped: ScrapeError | undefined;

  constructor(options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.intervalMs = options.intervalMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 0
      || !Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ScrapeError('INVALID_ARGUMENT', 'Invalid client timing configuration');
    }
  }

  get(input: string): Promise<{ url: string; html: string }> {
    const url = whoSampledUrl(input);
    const operation = this.tail.then(() => this.request(url));
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private async request(url: string) {
    if (this.stopped) throw this.stopped;
    const wait = this.intervalMs - (Date.now() - this.lastStarted);
    if (wait > 0) await delay(wait);
    this.lastStarted = Date.now();
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        redirect: 'manual', signal,
        headers: {
          'user-agent': 'SampleCheck-Prototype/0.1',
          accept: 'text/html',
        },
      });
      let responseError: ScrapeError | undefined;
      if ([401, 403].includes(response.status)) {
        responseError = new ScrapeError('ACCESS_BLOCKED', 'WhoSampled denied access; stopping this client', { status: response.status });
      } else if (response.status === 429) {
        responseError = new ScrapeError('RATE_LIMITED', 'WhoSampled rate limit reached; stopping this client', {
          retryAfter: response.headers.get('retry-after'),
        });
      } else if (response.status >= 300 && response.status < 400) {
        responseError = new ScrapeError('REDIRECT_REJECTED', 'Use the final WhoSampled page URL; redirects are not followed');
      } else if (!response.ok) {
        responseError = new ScrapeError('HTTP_ERROR', 'WhoSampled request failed', { status: response.status });
      } else if (!/^text\/html(?:;|$)/iu.test(response.headers.get('content-type') ?? '')) {
        responseError = new ScrapeError('UNEXPECTED_CONTENT_TYPE', 'Expected an HTML response');
      }
      if (responseError) {
        await response.body?.cancel();
        throw responseError;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ScrapeError('PAGE_STRUCTURE_CHANGED', 'Empty response body');
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_HTML_BYTES) {
            await reader.cancel();
            throw new ScrapeError('PAGE_TOO_LARGE', 'Page exceeds the 2 MB prototype limit');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const html = Buffer.concat(chunks).toString('utf8');
      loadPage(html); // Catch challenge pages even when the HTTP status is 200.
      return { url, html };
    } catch (error) {
      if (error instanceof ScrapeError) {
        if (error.code === 'ACCESS_BLOCKED' || error.code === 'RATE_LIMITED') this.stopped = error;
        throw error;
      }
      if (signal.aborted) throw new ScrapeError('REQUEST_TIMEOUT', 'WhoSampled request timed out');
      throw new ScrapeError('FETCH_FAILED', 'Could not fetch WhoSampled page');
    }
  }
}
