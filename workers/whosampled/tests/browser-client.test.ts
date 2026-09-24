import { mkdtemp, open, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BrowserWhoSampledClient } from '../src/browser-client.js';

const url = 'https://www.whosampled.com/Fixture/Track/';

describe('BrowserWhoSampledClient (no real browser)', () => {
  it('rejects invalid timing configuration', () => {
    expect(() => new BrowserWhoSampledClient({ intervalMs: -1 })).toThrowError(/timing configuration/);
    expect(() => new BrowserWhoSampledClient({ blockedWaitMs: 0 })).toThrowError(/timing configuration/);
    expect(() => new BrowserWhoSampledClient({ intervalMs: Number.NaN })).toThrowError(/timing configuration/);
  });

  it('reports BROWSER_UNAVAILABLE when no executable can be found', async () => {
    const client = new BrowserWhoSampledClient({
      executablePath: fileURLToPath(new URL('./does-not-exist-browser.exe', import.meta.url)),
      profileDirectory: join(tmpdir(), `samplecheck-bc-${Date.now()}`),
    });
    await expect(client.get(url)).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
  });

  it('reports BROWSER_BUSY when another process holds the profile lock', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'samplecheck-bc-busy-'));
    // Hold the lock exactly as a concurrent client would, using a real file handle.
    const foreign: FileHandle = await open(join(profile, 'samplecheck.lock'), 'wx');
    try {
      const client = new BrowserWhoSampledClient({
        // process.execPath exists, so findBrowser passes and we reach the lock step.
        executablePath: process.execPath,
        profileDirectory: profile,
      });
      await expect(client.get(url)).rejects.toMatchObject({ code: 'BROWSER_BUSY' });
      // The foreign lock must survive the failed attempt.
      await expect(foreign.close()).resolves.toBeUndefined();
    } finally {
      await foreign.close().catch(() => undefined);
    }
  });
});
