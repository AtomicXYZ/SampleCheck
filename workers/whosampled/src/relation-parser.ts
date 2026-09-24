import { ScrapeError } from './errors.js';
import { cleanText, loadPage } from './html.js';
import { parseDataTimings, parseTimestamps } from './timestamp-parser.js';
import { relationIdentity, trackUrl } from './urls.js';

export function parseRelationPage(html: string, pageUrl: string) {
  const identity = relationIdentity(pageUrl);
  const $ = loadPage(html);
  const headers = $('h2.section-header-title').toArray()
    .map((el) => cleanText($(el).text()))
    .filter((text) => /^(Direct Sample|Interpolation(?: \(Replayed Sample\))?|Replay Sample) of /iu.test(text));
  if (headers.length !== 1) {
    throw new ScrapeError('RELATION_PARSE_FAILED', 'Expected exactly one sample type / element heading');
  }
  const header = headers[0]!;
  const separator = header.toLowerCase().indexOf(' of ');

  function parseSide(role: 'source' | 'dest') {
    const marker = $(`[id="sampleWrap_${role}"]`);
    const box = marker.closest('.sampleEntryBox');
    if (marker.length !== 1 || box.length !== 1
      || box.find('[id="sampleWrap_source"], [id="sampleWrap_dest"]').length !== 1) {
      throw new ScrapeError('PAGE_STRUCTURE_CHANGED', 'Cannot unambiguously identify both track roles', { role });
    }
    const name = box.find('.sampleTrackMetadata a.trackName');
    const title = cleanText(name.text());
    if (name.length !== 1 || !title || !name.attr('href')) {
      throw new ScrapeError('TRACK_NAME_NOT_FOUND', 'Track title or URL is missing or ambiguous', { role });
    }
    const artist = box.find('.sampleTrackArtists');
    const artistName = cleanText(artist.text());
    if (artist.length !== 1 || !artistName) {
      throw new ScrapeError('ARTIST_NOT_FOUND', 'Track artist is missing or ambiguous', { role });
    }
    const year = box.find('.sampleReleaseDetails [itemprop="datePublished"]');
    const yearText = cleanText(year.text());
    if (year.length > 1 || (year.length === 1 && !/^[1-9]\d{3}$/u.test(yearText))) {
      throw new ScrapeError('RELATION_PARSE_FAILED', 'Invalid release year', { role, yearText });
    }
    const timing = box.find('.timing-wrapper');
    if (timing.length !== 1) {
      throw new ScrapeError('TIMESTAMP_NOT_FOUND', 'Expected one timestamp block per track', { role });
    }
    const timestamps = parseTimestamps(timing.text());
    const dataNodes = timing.find('[data-timings]');
    if (dataNodes.length > 1) {
      throw new ScrapeError('PAGE_STRUCTURE_CHANGED', 'Ambiguous timing attributes', { role });
    }
    const rawDataTimings = dataNodes.attr('data-timings') ?? null;
    if (rawDataTimings !== null) {
      const attributeTimes = parseDataTimings(rawDataTimings);
      if (JSON.stringify(attributeTimes) !== JSON.stringify(timestamps.timestampsMs)) {
        throw new ScrapeError('TIMESTAMP_CONFLICT', 'Visible timestamps disagree with data-timings', { role });
      }
    }
    return {
      track: {
        title, artistName,
        whosampledUrl: trackUrl(name.attr('href')!),
        albumName: cleanText(box.find('.sampleReleaseDetails .release-name').text()) || null,
        releaseYear: yearText ? Number(yearText) : null,
      },
      timestamps: { ...timestamps, rawDataTimings },
    };
  }

  const source = parseSide('source');
  const sampled = parseSide('dest');
  if (source.track.whosampledUrl === sampled.track.whosampledUrl) {
    throw new ScrapeError('RELATION_PARSE_FAILED', 'Source and sampled track must differ');
  }
  return {
    whosampledUrl: identity.url,
    whosampledRelationId: identity.id,
    status: 'IMPORTED' as const,
    sampleType: header.slice(0, separator),
    sampleElement: header.slice(separator + 4),
    source, sampled,
  };
}

export type ParsedRelation = ReturnType<typeof parseRelationPage>;
