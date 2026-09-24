import { ScrapeError } from './errors.js';
import { loadPage } from './html.js';
import { relationIdentity, trackUrl, whoSampledUrl } from './urls.js';

export function parseTrackPage(html: string, pageUrl: string) {
  const url = trackUrl(pageUrl);
  const $ = loadPage(html);
  // Scope to track listings; ignore recommendations, comments, covers and remixes.
  const containers = $('.listEntry.sampleEntry .details-inner, article.trackItem, table.tdata tr');
  if (!containers.length) {
    throw new ScrapeError('PAGE_STRUCTURE_CHANGED', 'No recognized sample listing; cannot infer zero relations');
  }
  const links = new Map<string, string>();
  containers.find('a[href]').each((_, el) => {
    const href = $(el).attr('href')!;
    // Check path first so unrelated external links are ignored.
    let path: string;
    try { path = new URL(href, url).pathname; } catch { return; }
    if (!path.startsWith('/sample/')) return;
    const relation = relationIdentity(href);
    links.set(relation.id, relation.url);
  });
  if (!links.size) {
    throw new ScrapeError('RELATION_PARSE_FAILED', 'No sample relations found in recognized listings');
  }
  const additionalPages = new Set<string>();
  $('a[rel="next"], .pagination a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) additionalPages.add(whoSampledUrl(href));
  });
  const baseTrackPath = new URL(url).pathname.replace(/(?:samples|sampled)\/$/u, '');
  const hasMoreRelations = $('a[href]').toArray().some((el) => {
    const href = $(el).attr('href')!;
    try {
      const target = new URL(whoSampledUrl(href));
      return [`${baseTrackPath}samples/`, `${baseTrackPath}sampled/`].includes(target.pathname)
        && target.pathname !== new URL(url).pathname;
    } catch { return false; }
  });
  return {
    whosampledUrl: url,
    relationUrls: [...links.values()],
    scope: 'THIS_PAGE_ONLY' as const,
    hasPagination: additionalPages.size > 0 || $('.pagination').length > 0,
    hasMoreRelations,
  };
}
