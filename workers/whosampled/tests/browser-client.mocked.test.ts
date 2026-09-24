import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWhoSampledClient } from '../src/browser-client.js';

// Replace the browser process launch and Playwright connection so no real
// browser starts. The fake page mimics navigation responses closely enough to
// exercise status, challenge and cleanup handling in BrowserWhoSampledClient.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    // The fake "browser" announces itself the way a real one would: after a
    // short delay it writes the debugging port into its user-data directory.
    spawn: vi.fn((_executable: string, args: string[] = []) => {
      const match = args.find((arg) => arg.startsWith('--user-data-dir='));
      if (match) {
        const profile = match.slice('--user-data-dir='.length);
        const timer = setTimeout(async () => {
          await writeFile(join(profile, 'DevToolsActivePort'), '4123\n/devtools/browser', 'utf8').catch(() => undefined);
        }, 50);
        timer.unref();
      }
      return { once: vi.fn(), unref: vi.fn(), kill: vi.fn(() => true), exitCode: null };
    }),
  };
});
vi.mock('playwright-core', () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

const trackUrl = 'https://www.whosampled.com/Fixture/Track/';
const otherUrl = 'https://www.whosampled.com/Somewhere-Else/Other/';
const challengeHtml = '<html><head><title>Just a moment...</title></head><body>Checking...</body></html>';
const trackHtml = '<html><head><title>Fixture Track</title></head><body>track page</body></html>';

type ContentMode = 'recover' | 'blocked' | 'ok';

function makePage(contentMode: ContentMode, finalUrl: string) {
  const mainFrameObject = Symbol('mainFrame');
  let contentCalls = 0;
  const page = {
    // Playwright exposes mainFrame as a method; the client compares against it.
    mainFrame: vi.fn(() => mainFrameObject),
    on: vi.fn(),
    goto: vi.fn(async () => undefined),
    url: vi.fn(() => finalUrl),
    content: vi.fn(async () => {
      contentCalls += 1;
      if (contentMode === 'blocked') return challengeHtml;
      if (contentMode === 'ok') return trackHtml;
      return contentCalls === 1 ? challengeHtml : trackHtml;
    }),
    isClosed: vi.fn(() => false),
    close: vi.fn(async () => undefined),
  };
  return page;
}

function navigate(page: ReturnType<typeof makePage>, status: number) {
  page.on.mockImplementation((event: string, handler: (response: unknown) => void) => {
    if (event === 'response') {
      queueMicrotask(() => handler({
        status: () => status,
        request: () => ({ isNavigationRequest: () => true, frame: () => page.mainFrame() }),
      }));
    }
  });
}

describe('BrowserWhoSampledClient (mocked browser)', () => {
  let client: BrowserWhoSampledClient;

  beforeEach(async () => {
    const profile = await mkdtemp(join(tmpdir(), 'samplecheck-bc-mock-'));
    // 900 ms fits one 500 ms challenge poll plus the follow-up that sees the
    // resolved page; a permanently blocked page still gives up in under a second.
    client = new BrowserWhoSampledClient({
      executablePath: process.execPath,
      profileDirectory: profile,
      intervalMs: 0,
      blockedWaitMs: 900,
    });
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    vi.clearAllMocks();
  });

  async function connectWithPage(page: ReturnType<typeof makePage>) {
    const { chromium } = await import('playwright-core');
    const browser = {
      contexts: () => [{ newPage: vi.fn(async () => page) }],
      newBrowserCDPSession: vi.fn(async () => ({ send: vi.fn() })),
      close: vi.fn(),
    };
    vi.mocked(chromium.connectOverCDP).mockImplementation(async () => browser as never);
  }

  it('waits through a 403 challenge and returns the real page after a 200 navigation', async () => {
    const page = makePage('recover', trackUrl);
    await connectWithPage(page);
    navigate(page, 200);
    await expect(client.get(trackUrl)).resolves.toMatchObject({
      url: trackUrl,
      html: expect.stringContaining('track page'),
    });
  });

  it('throws ACCESS_BLOCKED while the page stays on the challenge and stops the client', async () => {
    const page = makePage('blocked', trackUrl);
    await connectWithPage(page);
    navigate(page, 200);
    await expect(client.get(trackUrl)).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
    await expect(client.get(trackUrl)).rejects.toMatchObject({ code: 'ACCESS_BLOCKED' });
  });

  it('throws RATE_LIMITED on a 429 navigation and stops the client', async () => {
    const page = makePage('ok', trackUrl);
    await connectWithPage(page);
    navigate(page, 429);
    await expect(client.get(trackUrl)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(client.get(trackUrl)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('throws REDIRECT_REJECTED when the browser lands on a different page', async () => {
    const page = makePage('ok', otherUrl);
    await connectWithPage(page);
    navigate(page, 200);
    await expect(client.get(trackUrl)).rejects.toMatchObject({ code: 'REDIRECT_REJECTED' });
  });
});
