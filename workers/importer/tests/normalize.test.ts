import { describe, expect, it } from 'vitest';
import { ScrapeError, type ParsedRelation } from '@samplecheck/whosampled';
import { normalizeRelation, normalizeText, trackCanonicalKey } from '../src/normalize.js';

function makeSide(overrides: Partial<{
  title: string; artistName: string; whosampledUrl: string;
  albumName: string | null; releaseYear: number | null;
  rawText: string; timestampsMs: number[]; throughout: boolean;
}> = {}): ParsedRelation['source'] {
  return {
    track: {
      title: overrides.title ?? 'Sampled Track',
      artistName: overrides.artistName ?? 'Some Artist',
      whosampledUrl: overrides.whosampledUrl ?? 'https://www.whosampled.com/Some-Artist/Sampled-Track/',
      albumName: overrides.albumName ?? null,
      releaseYear: overrides.releaseYear ?? null,
    },
    timestamps: {
      rawText: overrides.rawText ?? 'Sample appears at 0:06 and 1:10',
      timestampsMs: overrides.timestampsMs ?? [6000, 70000],
      throughout: overrides.throughout ?? false,
      rawDataTimings: null,
    },
  };
}

function makeRelation(overrides: Partial<ParsedRelation> = {}): ParsedRelation {
  return {
    whosampledUrl: 'https://www.whosampled.com/sample/123/Rel/',
    whosampledRelationId: '123',
    status: 'IMPORTED',
    sampleType: 'Direct Sample',
    sampleElement: 'Instrumental',
    source: makeSide({
      title: 'Original Hook', artistName: 'Producer',
      whosampledUrl: 'https://www.whosampled.com/Producer/Original-Hook/',
    }),
    sampled: makeSide(),
    ...overrides,
  };
}

describe('normalizeText', () => {
  it('collapses whitespace and normalises unicode', () => {
    expect(normalizeText('  Kanye\u00a0West  ')).toBe('Kanye West');
    expect(normalizeText('a\t\nb')).toBe('a b');
  });
});

describe('trackCanonicalKey', () => {
  it('derives a stable key from the track path', () => {
    expect(trackCanonicalKey('https://www.whosampled.com/Kanye-West/Stronger/'))
      .toBe('whosampled:Kanye-West/Stronger');
    // Trailing slashes and a leading path do not change the key.
    expect(trackCanonicalKey('https://www.whosampled.com/Kanye-West/Stronger'))
      .toBe('whosampled:Kanye-West/Stronger');
  });
});

describe('normalizeRelation', () => {
  it('normalises both sides and copies the timestamp data', () => {
    const result = normalizeRelation(makeRelation());
    expect(result.source).toMatchObject({
      canonicalKey: 'whosampled:Producer/Original-Hook',
      title: 'Original Hook', artistName: 'Producer',
    });
    expect(result.sampled.canonicalKey).toBe('whosampled:Some-Artist/Sampled-Track');
    expect(result.sourceTimestampsMs).toEqual([6000, 70000]);
    expect(result.sampledTimestampText).toBe('Sample appears at 0:06 and 1:10');
    expect(result.sourceThroughout).toBe(false);
  });

  it('rejects an out-of-range release year', () => {
    const parsed = makeRelation();
    parsed.source.track.releaseYear = 99;
    expect(() => normalizeRelation(parsed)).toThrowError(ScrapeError);
  });

  it('rejects a blank title after normalisation', () => {
    const parsed = makeRelation();
    parsed.sampled.track.title = '   ';
    expect(() => normalizeRelation(parsed)).toThrowError(/title is blank/i);
  });

  it('rejects identical source and sampled tracks', () => {
    const parsed = makeRelation();
    parsed.sampled.track.whosampledUrl = parsed.source.track.whosampledUrl;
    parsed.sampled.track.title = 'Original Hook';
    expect(() => normalizeRelation(parsed)).toThrowError(/must differ/);
  });
});
