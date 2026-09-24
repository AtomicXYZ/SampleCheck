import { ScrapeError } from './errors.js';

export const ORIGIN = 'https://www.whosampled.com';

export function whoSampledUrl(input: string): string {
  let url: URL;
  try { url = new URL(input, ORIGIN); } catch {
    throw new ScrapeError('INVALID_URL', 'Invalid WhoSampled URL');
  }
  if (url.protocol !== 'https:' || !['www.whosampled.com', 'whosampled.com'].includes(url.hostname)
    || url.username || url.password || url.port || input.includes('\\')) {
    throw new ScrapeError('INVALID_URL', 'Only HTTPS WhoSampled URLs are supported');
  }
  url.hostname = 'www.whosampled.com';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/u, '') + '/';
  return url.toString();
}

export function relationIdentity(input: string) {
  const url = whoSampledUrl(input);
  const match = /^\/sample\/([1-9]\d*)\/[^/]+\/$/u.exec(new URL(url).pathname);
  if (!match) throw new ScrapeError('INVALID_URL', 'Expected a /sample/<id>/<slug>/ relation URL');
  return { url, id: match[1]! };
}

export function trackUrl(input: string): string {
  const url = whoSampledUrl(input);
  const path = new URL(url).pathname;
  if (!/^\/[^/]+\/[^/]+\/(?:samples\/|sampled\/)?$/u.test(path)
    || /^\/(?:sample|cover|remix|news|browse|album|static)\//iu.test(path)) {
    throw new ScrapeError('INVALID_URL', 'Expected an /artist/track/ URL');
  }
  return url;
}
