import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase, getDatabaseUrl, sampleRelations, sampleTimestamps, tracks,
} from '@samplecheck/database';
import type { ParsedRelation } from '@samplecheck/whosampled';
import { importRelation, importRelations } from '../src/importer.js';

// Real PostgreSQL tests. Each test runs inside an outer transaction and rolls
// it back, so no imported content persists. Nested per-relation transactions
// use savepoints, which keep the importer's atomicity intact inside the test.
let db: ReturnType<typeof createDatabase>['db'];
let pool: ReturnType<typeof createDatabase>['pool'];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const ROLLBACK = '__ROLLBACK_TEST__';

async function withRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (outer) => {
    await fn(outer);
    throw new Error(ROLLBACK);
  })).rejects.toThrow(ROLLBACK);
}

function makeParsed(overrides: Partial<ParsedRelation> = {}): ParsedRelation {
  return {
    whosampledUrl: 'https://www.whosampled.com/sample/500/Alpha-Into-Beta/',
    whosampledRelationId: '500',
    status: 'IMPORTED',
    sampleType: 'Direct Sample',
    sampleElement: 'Bassline',
    source: {
      track: {
        title: 'Alpha', artistName: 'Artist A',
        whosampledUrl: 'https://www.whosampled.com/Artist-A/Alpha/',
        albumName: 'Album A', releaseYear: 1999,
      },
      timestamps: { rawText: 'Sample appears at 0:03', timestampsMs: [3000], throughout: false, rawDataTimings: null },
    },
    sampled: {
      track: {
        title: 'Beta', artistName: 'Artist B',
        whosampledUrl: 'https://www.whosampled.com/Artist-B/Beta/',
        albumName: null, releaseYear: null,
      },
      timestamps: { rawText: 'Sample appears at 0:05 and 0:07', timestampsMs: [5000, 7000], throughout: false, rawDataTimings: null },
    },
    ...overrides,
  };
}

beforeEach(() => {
  const created = createDatabase(getDatabaseUrl());
  db = created.db;
  pool = created.pool;
});

afterAll(async () => { await pool.end(); });

describe('importer (PostgreSQL, rolled back)', () => {
  it('creates two tracks, one relation and all timestamps as IMPORTED', async () => {
    await withRollback(async (tx) => {
      const summary = await importRelation(tx, makeParsed());
      expect(summary).toMatchObject({ whosampledRelationId: '500', created: true, tracksCreated: 2, timestampsCreated: 3 });

      const [relation] = await tx.select().from(sampleRelations).where(
        { whosampledRelationId: '500' } as never,
      );
      // Use a plain filter so we do not depend on the generated where type.
      expect(relation).toBeTruthy();
      expect(relation?.status).toBe('IMPORTED');

      const source = await tx.select().from(tracks).where({ whosampledUrl: 'https://www.whosampled.com/Artist-A/Alpha/' } as never);
      const sampled = await tx.select().from(tracks).where({ whosampledUrl: 'https://www.whosampled.com/Artist-B/Beta/' } as never);
      expect(source).toHaveLength(1);
      expect(sampled).toHaveLength(1);
      expect(source[0]?.releaseYear).toBe(1999);

      const timestamps = await tx.select().from(sampleTimestamps);
      expect(timestamps.map((t) => `${t.trackRole}:${t.timestampMs}`).sort())
        .toEqual(['SAMPLED:5000', 'SAMPLED:7000', 'SOURCE:3000']);
    });
  });

  it('is idempotent: re-importing the same relation adds nothing', async () => {
    await withRollback(async (tx) => {
      await importRelation(tx, makeParsed());
      const again = await importRelation(tx, makeParsed());
      expect(again).toMatchObject({ created: false, tracksCreated: 0, timestampsCreated: 0 });

      const rels = await tx.select().from(sampleRelations);
      expect(rels).toHaveLength(1);
      const allTracks = await tx.select().from(tracks);
      expect(allTracks).toHaveLength(2);
      const allTimestamps = await tx.select().from(sampleTimestamps);
      expect(allTimestamps).toHaveLength(3);
    });
  });

  it('reuses a shared track across two different relations', async () => {
    const beta = makeParsed().sampled;
    await withRollback(async (tx) => {
      const first = await importRelation(tx, makeParsed()); // Alpha -> Beta
      expect(first.tracksCreated).toBe(2);

      const second = await importRelation(tx, makeParsed({
        whosampledUrl: 'https://www.whosampled.com/sample/501/Beta-Into-Gamma/',
        whosampledRelationId: '501',
        source: beta, // Beta is now the source (already imported)
        sampled: {
          track: {
            title: 'Gamma', artistName: 'Artist C',
            whosampledUrl: 'https://www.whosampled.com/Artist-C/Gamma/',
            albumName: null, releaseYear: 2010,
          },
          timestamps: { rawText: 'Sample appears at 0:01', timestampsMs: [1000], throughout: false, rawDataTimings: null },
        },
      }));
      expect(second.tracksCreated).toBe(1); // only Gamma is new

      const allTracks = await tx.select().from(tracks);
      expect(allTracks).toHaveLength(3); // Alpha, Beta, Gamma
      const allRelations = await tx.select().from(sampleRelations);
      expect(allRelations).toHaveLength(2);
    });
  });

  it('records a failed relation and continues the batch without partial writes', async () => {
    const goodA = makeParsed();
    const bad = makeParsed({
      whosampledUrl: 'https://www.whosampled.com/sample/600/Bad-Into-Also-Bad/',
      whosampledRelationId: '600',
    });
    bad.sampled.track.title = '   '; // blank after normalisation -> failure
    const goodB = makeParsed({
      whosampledUrl: 'https://www.whosampled.com/sample/700/Clean-Into-Other/',
      whosampledRelationId: '700',
      source: makeParsed({}).sampled,
    });

    await withRollback(async (tx) => {
      const result = await importRelations(tx, [goodA, bad, goodB]);
      expect(result).toMatchObject({ total: 3, created: 2, existing: 0, failed: 1 });
      const badSummary = result.relations.find((r) => r.whosampledRelationId === null);
      expect(badSummary?.error?.code).toBe('TRACK_NAME_NOT_FOUND');

      // The failed relation left no traces.
      const badTracks = await tx.select().from(tracks).where({ whosampledUrl: 'https://www.whosampled.com/Artist-B/Beta/' } as never);
      // Beta still exists only via goodA and goodB, never from the failed one.
      expect(badTracks).toHaveLength(1);
      const relCount = await tx.select().from(sampleRelations);
      expect(relCount).toHaveLength(2);
    });
  });

  it('stores a throughout relation with no fabricated timestamps', async () => {
    await withRollback(async (tx) => {
      await importRelation(tx, makeParsed({
        whosampledUrl: 'https://www.whosampled.com/sample/800/Through-Into-All/',
        whosampledRelationId: '800',
        source: {
          track: makeParsed().source.track,
          timestamps: { rawText: 'Sample appears throughout', timestampsMs: [], throughout: true, rawDataTimings: null },
        },
      }));
      const [relation] = await tx.select().from(sampleRelations).where({ whosampledRelationId: '800' } as never);
      expect(relation?.sourceThroughout).toBe(true);
      const timestamps = await tx.select().from(sampleTimestamps);
      expect(timestamps).toHaveLength(0);
    });
  });
});
