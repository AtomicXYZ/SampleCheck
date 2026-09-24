import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRelationPage } from '../src/relation-parser.js';
import { parseTrackPage } from '../src/track-parser.js';
import { relationIdentity, trackUrl, whoSampledUrl } from '../src/urls.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const relationUrl = 'https://www.whosampled.com/sample/900001/Fixture-Producer-Remixed-Loop-Fixture-Band-Original-Loop/';
const trackPageUrl = 'https://www.whosampled.com/Fixture-Producer/Remixed-Loop/';
const multiple = fixture('relation-multiple.html');

describe('relation parser', () => {
  it('reads both roles regardless of DOM order and preserves every timestamp', () => {
    const parsed = parseRelationPage(multiple, relationUrl);
    expect(parsed).toMatchObject({
      whosampledRelationId: '900001', status: 'IMPORTED',
      sampleType: 'Direct Sample', sampleElement: 'Hook / Riff',
      source: {
        track: { title: 'Original & Loop', artistName: 'Fixture Band feat. Guest', releaseYear: 2000, albumName: 'Test Album' },
        timestamps: { timestampsMs: [6000, 8000, 13000, 17000, 70000], throughout: false, rawDataTimings: '6,8,13,17,70' },
      },
      sampled: {
        track: { title: 'Remixed Loop', releaseYear: 2020, albumName: null },
        timestamps: { timestampsMs: [5000, 47000, 92000] },
      },
    });
    expect(parsed.source.timestamps.rawText).toContain('0:17 and 1:10');
    expect(parsed.source.timestamps).not.toHaveProperty('preferredTimestamp');
  });

  it('reads historical WhoSampled markup, including featured artist and throughout', () => {
    const parsed = parseRelationPage(fixture('relation-historical.html'),
      'https://www.whosampled.com/sample/729975/Dua-Lipa-Love-Again-Lew-Stone-%26-the-Monseigneur-Band-Al-Bowlly-My-Woman/');
    expect(parsed.source.track).toMatchObject({ title: 'My Woman', artistName: 'Lew Stone & the Monseigneur Band feat. Al Bowlly', releaseYear: 1932 });
    expect(parsed.source.timestamps.timestampsMs).toEqual([0]);
    expect(parsed.sampled.track).toMatchObject({ title: 'Love Again', artistName: 'Dua Lipa', releaseYear: 2020 });
    expect(parsed.sampled.timestamps).toMatchObject({ timestampsMs: [31000], throughout: true });
  });

  it('allows absent optional metadata and throughout without timing attributes', () => {
    const parsed = parseRelationPage(fixture('relation-throughout.html'), relationUrl);
    expect(parsed.sampleType).toBe('Interpolation (Replayed Sample)');
    expect(parsed.sampled.timestamps).toMatchObject({ timestampsMs: [], throughout: true, rawDataTimings: null });
    expect(parsed.source.timestamps.timestampsMs).toEqual([3804000]);
    expect(parsed.sampled.track.releaseYear).toBeNull();
  });

  it.each([
    [multiple.replace('sampleWrap_source', 'unknown-wrapper'), 'PAGE_STRUCTURE_CHANGED'],
    [multiple.replace('>Original &amp; Loop</a>', '></a>'), 'TRACK_NAME_NOT_FOUND'],
    [multiple.replace(/class="sampleTrackArtists"/gu, 'class="unknown"'), 'ARTIST_NOT_FOUND'],
    [multiple.replace('6,8,13,17,70', '6,8,13,17,71'), 'TIMESTAMP_CONFLICT'],
    [multiple.replace('>2000<', '>Unknown<'), 'RELATION_PARSE_FAILED'],
    [multiple.replace('Direct Sample of Hook / Riff', 'Unknown type'), 'RELATION_PARSE_FAILED'],
    [multiple.replace(/class="timing-wrapper"/gu, 'class="unknown"'), 'TIMESTAMP_NOT_FOUND'],
    [multiple.replace('0:17 and 1:10', '0:17 and unknown'), 'TIMESTAMP_PARSE_FAILED'],
    [multiple.replace('/Fixture-Producer/Remixed-Loop/', '/Fixture-Band/Original-Loop/'), 'RELATION_PARSE_FAILED'],
    ['<html><title>Just a moment...</title></html>', 'ACCESS_BLOCKED'],
    ['<html><h1>Completely changed page</h1></html>', 'RELATION_PARSE_FAILED'],
  ])('rejects incomplete or inconsistent input (case %#)', (html, code) => {
    expect(() => parseRelationPage(html, relationUrl)).toThrow(expect.objectContaining({ code }));
  });
});

describe('track discovery', () => {
  it('deduplicates samples and excludes covers, remixes and recommendations', () => {
    const parsed = parseTrackPage(fixture('track.html'), trackPageUrl);
    expect(parsed.relationUrls).toEqual([relationUrl, 'https://www.whosampled.com/sample/900002/Another-Fixture/']);
    expect(parsed).toMatchObject({ scope: 'THIS_PAGE_ONLY', hasPagination: true });
  });

  it('does not interpret a broken page as a successful empty result', () => {
    expect(() => parseTrackPage('<html></html>', trackPageUrl)).toThrow(expect.objectContaining({ code: 'PAGE_STRUCTURE_CHANGED' }));
    expect(() => parseTrackPage('<article class="trackItem">No samples</article>', trackPageUrl))
      .toThrow(expect.objectContaining({ code: 'RELATION_PARSE_FAILED' }));
  });
});

describe('URL validation', () => {
  it('normalizes host, trailing slash and tracking parameters', () => {
    expect(whoSampledUrl('https://whosampled.com/Artist/Track?ref=x#player')).toBe('https://www.whosampled.com/Artist/Track/');
    expect(trackUrl('/Artist/Track/sampled/')).toBe('https://www.whosampled.com/Artist/Track/sampled/');
    expect(relationIdentity(relationUrl).id).toBe('900001');
  });

  it.each([
    'http://www.whosampled.com/Artist/Track/', 'https://evil.test/sample/1/Test/',
    'https://whosampled.com.evil.test/', 'https://user:pass@www.whosampled.com/',
    'https://www.whosampled.com:4000/', 'file:///etc/passwd', '//localhost/Artist/Track/',
  ])('rejects untrusted URL %s', (url) => {
    expect(() => whoSampledUrl(url)).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
  });

  it('rejects unrelated page kinds', () => {
    expect(() => relationIdentity(trackPageUrl)).toThrow();
    expect(() => relationIdentity('/cover/1/Fixture/')).toThrow();
    expect(() => trackUrl(relationUrl)).toThrow();
  });
});
