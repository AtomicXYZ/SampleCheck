import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDatabaseUrl } from '../src/env.js';

// Real PostgreSQL tests. Every test uses its own transaction and rolls it back.
const pool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL ?? getDatabaseUrl(),
  connectionTimeoutMillis: 5_000,
});
let client: pg.PoolClient | undefined;
let sourceId: string;
let sampledId: string;
let relationId: string;

function query(sql: string, values: unknown[] = []) {
  if (!client) throw new Error('Test database connection missing');
  return client.query(sql, values);
}

async function violates(sql: string, values: unknown[], code: string, constraint?: string) {
  await query('SAVEPOINT expected_failure');
  try {
    await expect(query(sql, values)).rejects.toMatchObject({
      code, ...(constraint ? { constraint } : {}),
    });
  } finally {
    await query('ROLLBACK TO SAVEPOINT expected_failure');
    await query('RELEASE SAVEPOINT expected_failure');
  }
}

beforeEach(async () => {
  client = await pool.connect();
  await query('BEGIN');
  sourceId = randomUUID();
  sampledId = randomUUID();
  relationId = randomUUID();
  await query(`INSERT INTO tracks (id, canonical_key, title, artist_name)
    VALUES ($1, $3, 'Test original', 'Test artist'), ($2, $4, 'Test remix', 'Test artist')`,
  [sourceId, sampledId, sourceId, sampledId]);
  await query(`INSERT INTO sample_relations (id, source_track_id, sampled_track_id, sample_type)
    VALUES ($1, $2, $3, 'Direct Sample')`, [relationId, sourceId, sampledId]);
});

afterEach(async () => {
  if (!client) return;
  try { await client.query('ROLLBACK'); } finally { client.release(); client = undefined; }
});
afterAll(async () => { await pool.end(); });

describe('content database invariants', () => {
  it('imports unverified content by default', async () => {
    const { rows } = await query('SELECT status, verified_at FROM sample_relations WHERE id = $1', [relationId]);
    expect(rows[0]).toEqual({ status: 'IMPORTED', verified_at: null });
  });

  it('deduplicates canonical tracks and external provider IDs', async () => {
    await violates(`INSERT INTO tracks (canonical_key, title, artist_name) VALUES ($1, 'Duplicate', 'Artist')`,
      [sourceId], '23505', 'tracks_canonical_key_unique');
    await query('UPDATE tracks SET spotify_id = $1 WHERE id = $2', [sourceId, sourceId]);
    await violates('UPDATE tracks SET spotify_id = $1 WHERE id = $2',
      [sourceId, sampledId], '23505', 'tracks_spotify_id_unique');
  });

  it('rejects blank track titles', async () => {
    await violates("UPDATE tracks SET title = '   ' WHERE id = $1", [sourceId],
      '23514', 'tracks_title_not_blank');
  });

  it('rejects duplicate relationships', async () => {
    await violates(`INSERT INTO sample_relations (source_track_id, sampled_track_id, sample_type)
      VALUES ($1, $2, 'Direct Sample')`, [sourceId, sampledId],
    '23505', 'sample_relations_track_pair_unique');
  });

  it('rejects self-samples and missing tracks', async () => {
    await violates('UPDATE sample_relations SET sampled_track_id = $1 WHERE id = $2',
      [sourceId, relationId], '23514', 'sample_relations_distinct_tracks');
    await violates('UPDATE sample_relations SET sampled_track_id = $1 WHERE id = $2',
      [randomUUID(), relationId], '23503');
  });

  it('requires verification and difficulty before publication', async () => {
    for (const status of ['VERIFIED', 'PUBLISHED']) {
      await violates('UPDATE sample_relations SET status = $1 WHERE id = $2',
        [status, relationId], '23514');
    }
    await query("UPDATE sample_relations SET status = 'VERIFIED', verified_at = now() WHERE id = $1", [relationId]);
    await violates("UPDATE sample_relations SET status = 'PUBLISHED' WHERE id = $1", [relationId],
      '23514', 'sample_relations_published_difficulty_required');
    await query("UPDATE sample_relations SET status = 'PUBLISHED', difficulty = 'EASY' WHERE id = $1", [relationId]);
    const { rows } = await query('SELECT status FROM sample_relations WHERE id = $1', [relationId]);
    expect(rows[0].status).toBe('PUBLISHED');
  });

  it('preserves raw text and throughout without inventing a timestamp', async () => {
    const raw = 'Sample appears throughout';
    await query('UPDATE sample_relations SET source_timestamp_text = $1, source_throughout = true WHERE id = $2', [raw, relationId]);
    const { rows } = await query(`SELECT source_timestamp_text, source_throughout,
      (SELECT count(*)::int FROM sample_timestamps WHERE sample_relation_id = $1) AS timestamps
      FROM sample_relations WHERE id = $1`, [relationId]);
    expect(rows[0]).toEqual({ source_timestamp_text: raw, source_throughout: true, timestamps: 0 });
  });

  it('keeps both sides and allows one preferred timestamp per side', async () => {
    await query(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms, is_preferred)
      VALUES ($1, 'SOURCE', 6000, false), ($1, 'SOURCE', 70000, true), ($1, 'SAMPLED', 5000, true)`, [relationId]);
    await violates(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms, is_preferred)
      VALUES ($1, 'SOURCE', 8000, true)`, [relationId], '23505', 'sample_timestamps_one_preferred_per_role');
    const { rows } = await query(`SELECT track_role, timestamp_ms FROM sample_timestamps
      WHERE sample_relation_id = $1 ORDER BY timestamp_ms`, [relationId]);
    expect(rows).toEqual([
      { track_role: 'SAMPLED', timestamp_ms: 5000 },
      { track_role: 'SOURCE', timestamp_ms: 6000 },
      { track_role: 'SOURCE', timestamp_ms: 70000 },
    ]);
  });

  it('rejects repeated positions on the same side but accepts them on the other side', async () => {
    await query(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms)
      VALUES ($1, 'SOURCE', 0), ($1, 'SAMPLED', 0)`, [relationId]);
    await violates(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms)
      VALUES ($1, 'SOURCE', 0)`, [relationId], '23505', 'sample_timestamps_position_unique');
  });

  it('rejects negative timestamps and confidence outside 0..1', async () => {
    await violates(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms)
      VALUES ($1, 'SOURCE', -1)`, [relationId], '23514', 'sample_timestamps_nonnegative');
    for (const confidence of [-0.1, 1.1, 'NaN']) {
      await violates(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms, confidence)
        VALUES ($1, 'SOURCE', 6000, $2)`, [relationId, confidence], '23514', 'sample_timestamps_confidence_range');
    }
  });

  it('protects referenced tracks and removes timestamps when a relation is deleted', async () => {
    await violates('DELETE FROM tracks WHERE id = $1', [sourceId], '23001');
    await query(`INSERT INTO sample_timestamps (sample_relation_id, track_role, timestamp_ms)
      VALUES ($1, 'SOURCE', 6000)`, [relationId]);
    await query('DELETE FROM sample_relations WHERE id = $1', [relationId]);
    const { rows } = await query('SELECT count(*)::int AS count FROM sample_timestamps WHERE sample_relation_id = $1', [relationId]);
    expect(rows[0].count).toBe(0);
  });
});
