import { eq } from 'drizzle-orm';
import { sampleRelations, sampleTimestamps, tracks, type createDatabase } from '@samplecheck/database';
import { ScrapeError, type ParsedRelation } from '@samplecheck/whosampled';
import { normalizeRelation, type NormalizedRelation } from './normalize.js';

// The full database object, which can start transactions.
export type Database = ReturnType<typeof createDatabase>['db'];
// The live transaction handed to db.transaction(), inferred from its own type.
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
// Anything exposing insert/select: either the database or a live transaction.
type Queryable = Database | Tx;

export interface ImportSummary {
  /** The WhoSampled relation id, or null when parsing failed. */
  whosampledRelationId: string | null;
  /** True when a new relation row was written. */
  created: boolean;
  tracksCreated: number;
  timestampsCreated: number;
  /** Present when this relation failed to import. */
  error?: { code: string; message: string };
}

export interface ImportResult {
  /** Relations in the order they were given. */
  relations: ImportSummary[];
  total: number;
  created: number;
  existing: number;
  failed: number;
}

// Upsert one track, deduplicating on the WhoSampled URL (1:1 with the
// canonical key). Returns the existing row when it is already present so a
// repeated import never creates a second recording.
async function upsertTrack(db: Queryable, track: NormalizedRelation['source']) {
  const [existing] = await db.select().from(tracks).where(eq(tracks.whosampledUrl, track.whosampledUrl));
  if (existing) return { id: existing.id, created: false };
  const [inserted] = await db
    .insert(tracks)
    .values({
      canonicalKey: track.canonicalKey,
      title: track.title,
      artistName: track.artistName,
      albumName: track.albumName,
      releaseYear: track.releaseYear,
      whosampledUrl: track.whosampledUrl,
    })
    .onConflictDoNothing({ target: tracks.canonicalKey })
    .returning();
  if (inserted) return { id: inserted.id, created: true };
  // A concurrent import created the same key between our select and insert.
  const [fallback] = await db.select().from(tracks).where(eq(tracks.canonicalKey, track.canonicalKey));
  if (!fallback) throw new Error(`Track ${track.whosampledUrl} could not be resolved`);
  return { id: fallback.id, created: false };
}

// Persist one parsed relation inside a single transaction. A failure rolls the
// whole relation back, so the database never holds a half-written relation.
// Accepts either a database or an already-open transaction (nested transactions
// use a savepoint, which keeps the per-relation atomicity inside a test).
export async function importRelation(db: Queryable, parsed: ParsedRelation): Promise<ImportSummary> {
  const normalized = normalizeRelation(parsed);
  const summary: ImportSummary = {
    whosampledRelationId: normalized.whosampledRelationId,
    created: false,
    tracksCreated: 0,
    timestampsCreated: 0,
  };
  await db.transaction(async (tx) => {
    const source = await upsertTrack(tx, normalized.source);
    const sampled = await upsertTrack(tx, normalized.sampled);
    summary.tracksCreated = (source.created ? 1 : 0) + (sampled.created ? 1 : 0);

    const [relation] = await tx
      .insert(sampleRelations)
      .values({
        sourceTrackId: source.id,
        sampledTrackId: sampled.id,
        sampleType: normalized.sampleType,
        sampleElement: normalized.sampleElement,
        whosampledUrl: normalized.whosampledUrl,
        whosampledRelationId: normalized.whosampledRelationId,
        status: 'IMPORTED',
        sourceTimestampText: normalized.sourceTimestampText,
        sampledTimestampText: normalized.sampledTimestampText,
        sourceThroughout: normalized.sourceThroughout,
        sampledThroughout: normalized.sampledThroughout,
      })
      .onConflictDoNothing({ target: sampleRelations.whosampledRelationId })
      .returning();
    // Re-importing the same relation is a no-op, never an error.
    if (!relation) return;
    summary.created = true;

    const rows = [
      ...normalized.sourceTimestampsMs.map((timestampMs) => ({
        sampleRelationId: relation.id, trackRole: 'SOURCE' as const, timestampMs,
      })),
      ...normalized.sampledTimestampsMs.map((timestampMs) => ({
        sampleRelationId: relation.id, trackRole: 'SAMPLED' as const, timestampMs,
      })),
    ];
    const inserted = await tx
      .insert(sampleTimestamps)
      .values(rows)
      .onConflictDoNothing({ target: [sampleTimestamps.sampleRelationId, sampleTimestamps.trackRole, sampleTimestamps.timestampMs] })
      .returning();
    summary.timestampsCreated = inserted.length;
  });
  return summary;
}

// Import many parsed relations. Each relation is independent: a failure records
// its error and the batch continues, so one bad page does not abort the rest.
export async function importRelations(db: Queryable, parsed: ParsedRelation[]): Promise<ImportResult> {
  const relations: ImportSummary[] = [];
  for (const candidate of parsed) {
    try {
      relations.push(await importRelation(db, candidate));
    } catch (error) {
      const code = error instanceof ScrapeError ? error.code : 'IMPORT_FAILED';
      relations.push({
        whosampledRelationId: null,
        created: false,
        tracksCreated: 0,
        timestampsCreated: 0,
        error: { code, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return {
    relations,
    total: relations.length,
    created: relations.filter((r) => r.created).length,
    existing: relations.filter((r) => !r.created && !r.error).length,
    failed: relations.filter((r) => r.error).length,
  };
}
