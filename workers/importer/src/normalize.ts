import { ScrapeError } from '@samplecheck/whosampled';
import type { ParsedRelation } from '@samplecheck/whosampled';

// The scraper preserves WhoSampled's raw text. The importer is responsible for
// turning that into stable, deduplicated rows. The database performs no fuzzy
// matching, so the canonical key must be stable for a given recording.

export interface NormalizedTrack {
  canonicalKey: string;
  title: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  whosampledUrl: string;
}

export interface NormalizedRelation {
  whosampledRelationId: string;
  whosampledUrl: string;
  sampleType: string;
  sampleElement: string | null;
  source: NormalizedTrack;
  sampled: NormalizedTrack;
  sourceTimestampText: string | null;
  sampledTimestampText: string | null;
  sourceThroughout: boolean;
  sampledThroughout: boolean;
  sourceTimestampsMs: number[];
  sampledTimestampsMs: number[];
}

// Collapse whitespace and normalize unicode so "Kanye West" and "Kanye\u00a0West"
// key the same. The database does not do fuzzy matching, so this is the only
// text normalization applied before the stable key is derived.
export const normalizeText = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

// Stable, unique identity for a recording. We key on the WhoSampled track path
// because it is stable across re-fetches and distinct per recording. A later
// enrichment step can match MusicBrainz/Spotify without changing this key.
export const trackCanonicalKey = (whosampledUrl: string): string => {
  const pathname = new URL(whosampledUrl).pathname.replace(/^\/+|\/+$/gu, '');
  if (!pathname) throw new ScrapeError('TRACK_NAME_NOT_FOUND', 'Cannot derive a canonical key from the track URL');
  return `whosampled:${pathname}`;
};

function normalizeYear(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1000 || value > 9999) return null;
  return value;
}

function normalizeTrack(track: ParsedRelation['source']['track']): NormalizedTrack {
  const title = normalizeText(track.title);
  const artistName = normalizeText(track.artistName);
  if (!title) throw new ScrapeError('TRACK_NAME_NOT_FOUND', 'Track title is blank after normalization');
  if (!artistName) throw new ScrapeError('ARTIST_NOT_FOUND', 'Track artist is blank after normalization');
  return {
    canonicalKey: trackCanonicalKey(track.whosampledUrl),
    title,
    artistName,
    albumName: track.albumName ? normalizeText(track.albumName) : null,
    releaseYear: normalizeYear(track.releaseYear),
    whosampledUrl: track.whosampledUrl,
  };
}

// Pure transformation from the scraper's ParsedRelation to the shape the
// importer persists. No database access, so it is unit-testable in isolation.
export function normalizeRelation(parsed: ParsedRelation): NormalizedRelation {
  if (parsed.source.track.whosampledUrl === parsed.sampled.track.whosampledUrl) {
    throw new ScrapeError('RELATION_PARSE_FAILED', 'Source and sampled track must differ');
  }
  const source = normalizeTrack(parsed.source.track);
  const sampled = normalizeTrack(parsed.sampled.track);
  if (source.canonicalKey === sampled.canonicalKey) {
    throw new ScrapeError('RELATION_PARSE_FAILED', 'Source and sampled track share a canonical key');
  }
  return {
    whosampledRelationId: parsed.whosampledRelationId,
    whosampledUrl: parsed.whosampledUrl,
    sampleType: normalizeText(parsed.sampleType),
    sampleElement: parsed.sampleElement ? normalizeText(parsed.sampleElement) : null,
    source,
    sampled,
    sourceTimestampText: parsed.source.timestamps.rawText,
    sampledTimestampText: parsed.sampled.timestamps.rawText,
    sourceThroughout: parsed.source.timestamps.throughout,
    sampledThroughout: parsed.sampled.timestamps.throughout,
    sourceTimestampsMs: [...parsed.source.timestamps.timestampsMs],
    sampledTimestampsMs: [...parsed.sampled.timestamps.timestampsMs],
  };
}
