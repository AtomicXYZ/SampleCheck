import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, open, readFile, unlink, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from 'playwright-core';
import { ScrapeError } from './errors.js';
import { loadPage } from './html.js';
import { whoSampledUrl } from './urls.js';

export interface BrowserClientOptions {
  executablePath?: string;
  profileDirectory?: string;
  /** Minimum milliseconds between the start of successive fetches. */
  intervalMs?: number;
  /** How long to keep waiting for a challenge to resolve before giving up. */
  blockedWaitMs?: number;
}

async function findBrowser(explicit?: string): Promise<string> {
  const candidates = explicit ? [explicit] : [
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  for (const path of candidates) {
    try { await access(path); return path; } catch { /* Try next installed browser. */ }
  }
  throw new ScrapeError('BROWSER_UNAVAILABLE', 'Install Edge/Chrome or pass --browser-executable <path>');
}

// A visible, ordinary browser with a separate project profile. No personal browser
// profile, copied cookies, credential extraction or browser-fingerprint changes.
export class BrowserWhoSampledClient {
  private browser?: Browser;
  private child?: ChildProcess;
  private lock?: FileHandle;
  private readonly profile: string;
  private tail: Promise<unknown> = Promise.resolve();
  private lastStarted = 0;
  private stopped?: ScrapeError;
  private readonly intervalMs: number;
  private readonly blockedWaitMs: number;

  constructor(private readonly options: BrowserClientOptions = {}) {
    this.profile = resolve(options.profileDirectory ?? '.local/whosampled-browser');
    this.intervalMs = options.intervalMs ?? 2000;
    this.blockedWaitMs = options.blockedWaitMs ?? 45_000;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 0
      || !Number.isFinite(this.blockedWaitMs) || this.blockedWaitMs <= 0) {
      throw new ScrapeError('INVALID_ARGUMENT', 'Invalid browser client timing configuration');
    }
  }

  private async connect(): Promise<Browser> {
    if (this.browser) return this.browser;
    const executable = await findBrowser(this.options.executablePath);
    await mkdir(this.profile, { recursive: true });
    try { this.lock = await open(join(this.profile, 'samplecheck.lock'), 'wx'); }
    catch {
      throw new ScrapeError('BROWSER_BUSY', 'SampleCheck browser profile is in use; close the other capture first');
    }
    try {
      // A stale port must never attach this process to an unrelated browser.
      await unlink(join(this.profile, 'DevToolsActivePort')).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      this.child = spawn(executable, [
        `--user-data-dir=${this.profile}`,
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--no-first-run', 'about:blank',
      ], { stdio: 'ignore' });
      let launchError: Error | undefined;
      this.child.once('error', (error) => { launchError = error; });
      this.child.unref();
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (launchError || this.child.exitCode !== null) {
          throw new ScrapeError('BROWSER_UNAVAILABLE', 'Browser could not start');
        }
        let port: number | undefined;
        try { port = Number((await readFile(join(this.profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
        catch { /* Browser is still starting. */ }
        if (port && port >= 1 && port <= 65535) {
          this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
          return this.browser;
        }
        await delay(100);
      }
      throw new ScrapeError('BROWSER_UNAVAILABLE', 'Browser startup timed out');
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  get(input: string): Promise<{ url: string; html: string }> {
    const url = whoSampledUrl(input);
    const operation = this.tail.then(async () => {
      if (this.stopped) throw this.stopped;
      const browser = await this.connect();
      const wait = this.intervalMs - (Date.now() - this.lastStarted);
      if (wait > 0) await delay(wait);
      this.lastStarted = Date.now();
      const context = browser.contexts()[0];
      if (!context) throw new ScrapeError('BROWSER_UNAVAILABLE', 'Browser context missing');
      const page = await context.newPage();
      let status: number | undefined;
      page.on('response', (response) => {
        const request = response.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) status = response.status();
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // A first 403 can be a challenge followed by a real 200 navigation.
        // Wait for the browser to finish that navigation, without clicking a CAPTCHA.
        const deadline = Date.now() + this.blockedWaitMs;
        while (Date.now() < deadline) {
          if (status === 429) throw new ScrapeError('RATE_LIMITED', 'WhoSampled rate limit reached');
          let html: string;
          try { html = await page.content(); } catch {
            if (page.isClosed()) throw new ScrapeError('BROWSER_UNAVAILABLE', 'Browser page was closed');
            await delay(300);
            continue;
          }
          try {
            loadPage(html);
            if (status !== undefined && status >= 200 && status < 300) {
              if (whoSampledUrl(page.url()) !== url) {
                throw new ScrapeError('REDIRECT_REJECTED', 'Browser landed on a different page; use its canonical URL');
              }
              return { url, html };
            }
            if (status !== undefined && status >= 400 && ![401, 403].includes(status)) {
              throw new ScrapeError('HTTP_ERROR', 'WhoSampled request failed', { status });
            }
          } catch (error) {
            if (!(error instanceof ScrapeError) || error.code !== 'ACCESS_BLOCKED') throw error;
          }
          await delay(500);
        }
        throw new ScrapeError('ACCESS_BLOCKED', 'Browser access remained blocked. Complete any verification in the visible browser and retry.');
      } catch (error) {
        if (error instanceof ScrapeError) {
          if (error.code === 'ACCESS_BLOCKED' || error.code === 'RATE_LIMITED') this.stopped = error;
          throw error;
        }
        throw new ScrapeError('FETCH_FAILED', 'Browser navigation failed or timed out');
      } finally { await page.close().catch(() => undefined); }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.browser) {
      // CDP disconnect alone leaves a separately launched native browser running.
      try {
        const session = await this.browser.newBrowserCDPSession();
        await session.send('Browser.close');
      } catch {
        // Only the process this client launched, never other user browser windows.
        if (this.child?.exitCode === null) this.child.kill();
      }
      await this.browser.close().catch(() => undefined);
      this.browser = undefined;
    } else if (this.child && this.child.exitCode === null) {
      this.child.kill();
    }
    this.child = undefined;
    // Only remove the lock this client acquired; a foreign lock must stay in place.
    if (this.lock) {
      await this.lock.close();
      this.lock = undefined;
      await unlink(join(this.profile, 'samplecheck.lock')).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}
