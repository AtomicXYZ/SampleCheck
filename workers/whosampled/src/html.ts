import { load } from 'cheerio';
import { ScrapeError } from './errors.js';

export const MAX_HTML_BYTES = 2_000_000;
export const cleanText = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

export function loadPage(html: string) {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new ScrapeError('PAGE_TOO_LARGE', 'Page exceeds the 2 MB prototype limit');
  }
  if (/_cf_chl_opt|cf-chl-|cf-error-details|challenges\.cloudflare\.com/iu.test(html)
    || /<title[^>]*>\s*(?:Just a moment|Attention Required)/iu.test(html)) {
    throw new ScrapeError('ACCESS_BLOCKED', 'WhoSampled returned a challenge or block page');
  }
  return load(html);
}
