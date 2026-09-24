import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDatabase, getDatabaseUrl } from '@samplecheck/database';
import {
  BrowserWhoSampledClient, parseRelationPage, relationIdentity,
  ScrapeError, WhoSampledClient, type ParsedRelation,
} from '@samplecheck/whosampled';
import { importRelation, type ImportSummary } from './importer.js';

const help = `SampleCheck relation importer

Reads WhoSampled sample relations and writes them to PostgreSQL. Every relation is
stored in its own transaction; a failure rolls that relation back and the batch
continues. Imported content is IMPORTED and never automatically playable.

pnpm import relations <WhoSampled relation URL>... [--browser] [--out <summary-json>]
  Fetches each relation (direct HTTP, or a visible browser with --browser), parses it
  and imports it. Use --browser when WhoSampled blocks plain requests.

pnpm import file <json-file> [--out <summary-json>]
  Imports relations from a saved JSON file (a single ParsedRelation object or an
  array of them, as produced by "pnpm scrape relation ... --out"). No network.

--out writes the JSON import summary; the parent directory must exist and an
existing file is not overwritten. Without --out the summary is printed to stdout.
`;

interface FetchOptions {
  browser?: boolean;
  browserExecutable?: string;
}

// Fetch and parse every relation URL in order. A fetch or parse failure is
// recorded for that URL and the remaining URLs are still attempted, so one
// blocked or malformed page does not abort the batch.
async function fetchRelations(urls: string[], options: FetchOptions): Promise<(ParsedRelation | ImportSummary)[]> {
  const results: (ParsedRelation | ImportSummary)[] = [];
  if (options.browser) {
    const client = new BrowserWhoSampledClient({ executablePath: options.browserExecutable });
    const shutdown = () => { void client.close().finally(() => process.exit(130)); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    try {
      for (const rawUrl of urls) {
        const url = relationIdentity(rawUrl).url;
        try {
          const { html } = await client.get(url);
          results.push(parseRelationPage(html, url));
        } catch (error) {
          results.push(failure(error, relationIdentity(rawUrl).id));
        }
      }
    } finally {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      await client.close();
    }
    return results;
  }
  const client = new WhoSampledClient();
  for (const rawUrl of urls) {
    const url = relationIdentity(rawUrl).url;
    try {
      const { html } = await client.get(url);
      results.push(parseRelationPage(html, url));
    } catch (error) {
      results.push(failure(error, relationIdentity(rawUrl).id));
    }
  }
  return results;
}

function failure(error: unknown, relationId: string | null): ImportSummary {
  const code = error instanceof ScrapeError ? error.code : 'IMPORT_FAILED';
  return {
    whosampledRelationId: relationId,
    created: false,
    tracksCreated: 0,
    timestampsCreated: 0,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  };
}

async function loadParsed(file: string): Promise<ParsedRelation[]> {
  const json = JSON.parse(await readFile(file, 'utf8')) as unknown;
  const value = Array.isArray(json) ? json : [json];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || typeof (item as { whosampledRelationId?: unknown }).whosampledRelationId !== 'string'
      || typeof (item as { source?: unknown }).source !== 'object' || typeof (item as { sampled?: unknown }).sampled !== 'object') {
      throw new ScrapeError('INVALID_ARGUMENT', 'Expected a ParsedRelation object or an array of them');
    }
  }
  return value as ParsedRelation[];
}

// Run a callback with a database connection and always close the pool.
async function withDatabase<T>(fn: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>): Promise<T> {
  const { db, pool } = createDatabase(getDatabaseUrl());
  try {
    return await fn(db);
  } finally {
    await pool.end();
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      browser: { type: 'boolean' },
      'browser-executable': { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || positionals.length < 2) {
    console.log(help);
    if (positionals.length < 2) process.exitCode = 1;
    return;
  }
  const [command, first, ...rest] = positionals;
  if (command === 'relations') {
    if (!first || rest.length === 0 && !first) throw new ScrapeError('INVALID_ARGUMENT', 'At least one relation URL is required');
    const urls = [first, ...rest];
    const fetched = await fetchRelations(urls, {
      browser: values.browser,
      browserExecutable: values['browser-executable'],
    });
    const summaries = await withDatabase(async (db) => {
      const list: ImportSummary[] = [];
      for (const item of fetched) {
        list.push(isParsedRelation(item) ? await importRelation(db, item) : item);
      }
      return list;
    });
    await report(summaries, values.out);
  } else if (command === 'file') {
    if (!first) throw new ScrapeError('INVALID_ARGUMENT', 'A JSON file path is required');
    const parsed = await loadParsed(first);
    const summaries = await withDatabase(async (db) => {
      const list: ImportSummary[] = [];
      for (const item of parsed) list.push(await importRelation(db, item));
      return list;
    });
    await report(summaries, values.out);
  } else {
    throw new ScrapeError('INVALID_ARGUMENT', help);
  }
}

function isParsedRelation(value: ParsedRelation | ImportSummary): value is ParsedRelation {
  return 'source' in value && 'sampled' in value;
}

async function report(summaries: ImportSummary[], out?: string): Promise<void> {
  const result = {
    total: summaries.length,
    created: summaries.filter((s) => s.created).length,
    existing: summaries.filter((s) => !s.created && !s.error).length,
    failed: summaries.filter((s) => s.error).length,
    relations: summaries,
  };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (out) await writeFile(out, json, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(json);
}

main().catch((error: unknown) => {
  const payload = error instanceof ScrapeError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: 'CLI_ERROR', message: error instanceof Error ? error.message : String(error) };
  process.stderr.write(JSON.stringify({ error: payload }, null, 2) + '\n');
  process.exitCode = 1;
});
