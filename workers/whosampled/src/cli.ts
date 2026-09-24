import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { WhoSampledClient } from './client.js';
import { BrowserWhoSampledClient } from './browser-client.js';
import { ScrapeError } from './errors.js';
import { parseRelationPage } from './relation-parser.js';
import { parseTrackPage } from './track-parser.js';
import { parseTimestamps } from './timestamp-parser.js';
import { relationIdentity, trackUrl } from './urls.js';

const help = `SampleCheck scraper prototype

pnpm scrape timestamps "Sample appears at 0:06 and 1:10"
pnpm scrape relation <WhoSampled relation URL> [--html <file>] [--out <new-json-file>]
pnpm scrape track <WhoSampled track URL> [--html <file>] [--out <new-json-file>]

--html parses a local UTF-8 file without network access.
--browser uses a visible Edge/Chrome browser and a separate SampleCheck profile.
--browser-executable <path> selects a specific installed Chromium browser.
--save-html <new-file> saves the fetched HTML for inspection or offline parsing.
Output is JSON metadata only; no database writes or audio downloads.
Track discovery covers one page, not an entire catalogue.
--out refuses to overwrite an existing file.
`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      html: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' },
      browser: { type: 'boolean' }, 'browser-executable': { type: 'string' }, 'save-html': { type: 'string' },
    },
  });
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, input] = positionals;
  if (!input || positionals.length !== 2 || !['timestamps', 'relation', 'track'].includes(command!)) {
    throw new ScrapeError('INVALID_ARGUMENT', help);
  }
  let result: unknown;
  if ((values.html && values.browser) || (values['browser-executable'] && !values.browser)) {
    throw new ScrapeError('INVALID_ARGUMENT', '--html and --browser are exclusive; --browser-executable requires --browser');
  }
  if (command === 'timestamps') {
    if (values.html || values.browser || values['save-html']) throw new ScrapeError('INVALID_ARGUMENT', 'HTML/browser options require track or relation');
    result = parseTimestamps(input);
  } else {
    const url = command === 'relation' ? relationIdentity(input).url : trackUrl(input);
    let html: string;
    if (values.html) html = await readFile(values.html, 'utf8');
    else if (values.browser) {
      const client = new BrowserWhoSampledClient({ executablePath: values['browser-executable'] });
      const shutdown = () => { void client.close().finally(() => process.exit(130)); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      try { html = (await client.get(url)).html; }
      finally {
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
        await client.close();
      }
    } else html = (await new WhoSampledClient().get(url)).html;
    if (values['save-html']) await writeFile(values['save-html'], html, { encoding: 'utf8', flag: 'wx' });
    result = command === 'relation' ? parseRelationPage(html, url) : parseTrackPage(html, url);
  }
  const json = JSON.stringify(result, null, 2) + '\n';
  if (values.out) await writeFile(values.out, json, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(json);
}

main().catch((error: unknown) => {
  const payload = error instanceof ScrapeError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: 'CLI_ERROR', message: error instanceof Error ? error.message : String(error) };
  process.stderr.write(JSON.stringify({ error: payload }, null, 2) + '\n');
  process.exitCode = 1;
});
