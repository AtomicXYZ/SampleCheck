import { ScrapeError } from './errors.js';

export interface ParsedTimestamps {
  rawText: string;
  timestampsMs: number[];
  throughout: boolean;
}

const MAX_TIMESTAMP_MS = 2_147_483_647; // PostgreSQL integer.
const orderedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

function invalid(rawText: string): never {
  throw new ScrapeError('TIMESTAMP_PARSE_FAILED', 'Unsupported or invalid timestamp text', { rawText });
}

function checkedMs(value: number, rawText: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP_MS) invalid(rawText);
  return value;
}

export function parseTimestamps(rawText: string): ParsedTimestamps {
  let text = rawText.replace(/\s+/gu, ' ').trim().replace(/\.$/u, '');
  if (!text) throw new ScrapeError('TIMESTAMP_NOT_FOUND', 'No timestamp text found');
  text = text.replace(/^sample appears\s+(?:at\s+)?/iu, '');
  if (/^throughout$/iu.test(text)) return { rawText, timestampsMs: [], throughout: true };

  const throughout = /\s*\(and throughout\)$/iu.test(text);
  if (throughout) text = text.replace(/\s*\(and throughout\)$/iu, '').trim();
  const tokens = text.split(/\s*(?:,\s*(?:and\s+)?|\band\b|&|;)\s*/iu);
  const timestampsMs = tokens.map((token) => {
    const match = /^(\d+):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/u.exec(token);
    if (!match) invalid(rawText);
    const first = Number(match[1]);
    const second = Number(match[2]);
    const third = match[3] === undefined ? undefined : Number(match[3]);
    if (second >= 60 || (third !== undefined && third >= 60)) invalid(rawText);
    const seconds = third === undefined ? first * 60 + second : first * 3600 + second * 60 + third;
    const fraction = Number((match[4] ?? '').padEnd(3, '0'));
    return checkedMs(seconds * 1000 + fraction, rawText);
  });
  return { rawText, timestampsMs: orderedUnique(timestampsMs), throughout };
}

// Historical WhoSampled data-timings attributes contain seconds, not milliseconds.
export function parseDataTimings(raw: string): number[] {
  if (!raw.trim()) return [];
  return orderedUnique(raw.split(',').map((part) => {
    const token = part.trim();
    if (!/^\d+(?:\.\d{1,3})?$/u.test(token)) invalid(raw);
    const [seconds, fraction = ''] = token.split('.');
    return checkedMs(Number(seconds) * 1000 + Number(fraction.padEnd(3, '0')), raw);
  }));
}
