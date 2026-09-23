import { eq } from 'drizzle-orm';
import type { createDatabase } from './client.js';
import { sampleRelations, sampleTimestamps, tracks } from './schema.js';

type Database = ReturnType<typeof createDatabase>['db'];

// Fictional metadata only. No real music, external requests or playable content.
export async function seedDevelopmentData(db: Database) {
  await db.transaction(async (tx) => {
    const sourceKey = 'dev:samplecheck:original-loop';
    const sampledKey = 'dev:samplecheck:remixed-loop';
    await tx.insert(tracks).values([
      { canonicalKey: sourceKey, title: '[DEMO] Original Loop', artistName: 'SampleCheck Fixtures', releaseYear: 2000 },
      { canonicalKey: sampledKey, title: '[DEMO] Remixed Loop', artistName: 'SampleCheck Fixtures', releaseYear: 2020 },
    ]).onConflictDoNothing({ target: tracks.canonicalKey });

    const [source] = await tx.select().from(tracks).where(eq(tracks.canonicalKey, sourceKey));
    const [sampled] = await tx.select().from(tracks).where(eq(tracks.canonicalKey, sampledKey));
    if (!source || !sampled) throw new Error('Development tracks missing');

    // Never overwrite reviewed content or preferred timestamps on a repeated seed.
    const [relation] = await tx.insert(sampleRelations).values({
      sourceTrackId: source.id,
      sampledTrackId: sampled.id,
      sampleType: 'Direct Sample',
      sampleElement: 'Hook / Riff',
      sourceTimestampText: 'Sample appears at 0:06, 0:08, 0:13, 0:17 and 1:10',
      sampledTimestampText: 'Sample appears at 0:05 and 0:47',
    }).onConflictDoNothing({
      target: [sampleRelations.sourceTrackId, sampleRelations.sampledTrackId],
    }).returning();
    if (!relation) return;

    await tx.insert(sampleTimestamps).values([
      ...[6000, 8000, 13000, 17000, 70000].map((timestampMs) => ({
        sampleRelationId: relation.id, trackRole: 'SOURCE' as const, timestampMs,
        isPreferred: timestampMs === 70000,
      })),
      ...[5000, 47000].map((timestampMs) => ({
        sampleRelationId: relation.id, trackRole: 'SAMPLED' as const, timestampMs,
        isPreferred: timestampMs === 5000,
      })),
    ]);
  });
}
