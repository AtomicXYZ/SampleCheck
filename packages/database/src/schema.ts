import { contentStatuses, difficulties, trackRoles } from '@samplecheck/shared';
import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, pgEnum, pgTable, real, text,
  timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

export const contentStatus = pgEnum('content_status', contentStatuses);
export const difficulty = pgEnum('difficulty', difficulties);
export const trackRole = pgEnum('track_role', trackRoles);

const auditColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
});

export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Stable recording identity, assigned by the importer; not a display title.
  canonicalKey: text('canonical_key').notNull().unique(),
  title: text('title').notNull(),
  artistName: text('artist_name').notNull(),
  albumName: text('album_name'),
  releaseYear: integer('release_year'),
  musicbrainzId: uuid('musicbrainz_id').unique(),
  spotifyId: text('spotify_id').unique(),
  appleMusicId: text('apple_music_id').unique(),
  whosampledUrl: text('whosampled_url').unique(),
  artworkUrl: text('artwork_url'),
  ...auditColumns(),
}, (t) => [
  check('tracks_canonical_key_not_blank', sql`length(btrim(${t.canonicalKey})) > 0`),
  check('tracks_title_not_blank', sql`length(btrim(${t.title})) > 0`),
  check('tracks_artist_not_blank', sql`length(btrim(${t.artistName})) > 0`),
  check('tracks_release_year_range', sql`${t.releaseYear} between 1000 and 9999`),
]);

export const sampleRelations = pgTable('sample_relations', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceTrackId: uuid('source_track_id').notNull()
    .references(() => tracks.id, { onDelete: 'restrict' }),
  sampledTrackId: uuid('sampled_track_id').notNull()
    .references(() => tracks.id, { onDelete: 'restrict' }),
  sampleType: text('sample_type').notNull(),
  sampleElement: text('sample_element'),
  whosampledUrl: text('whosampled_url').unique(),
  whosampledRelationId: text('whosampled_relation_id').unique(),
  status: contentStatus('status').notNull().default('IMPORTED'),
  difficulty: difficulty('difficulty'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  // Preserve raw text for each side, including "throughout" and unparsed text.
  sourceTimestampText: text('source_timestamp_text'),
  sampledTimestampText: text('sampled_timestamp_text'),
  sourceThroughout: boolean('source_throughout').notNull().default(false),
  sampledThroughout: boolean('sampled_throughout').notNull().default(false),
  ...auditColumns(),
}, (t) => [
  unique('sample_relations_track_pair_unique').on(t.sourceTrackId, t.sampledTrackId),
  index('sample_relations_sampled_track_idx').on(t.sampledTrackId),
  index('sample_relations_status_difficulty_idx').on(t.status, t.difficulty),
  check('sample_relations_distinct_tracks', sql`${t.sourceTrackId} <> ${t.sampledTrackId}`),
  check('sample_relations_type_not_blank', sql`length(btrim(${t.sampleType})) > 0`),
  check('sample_relations_verification_required',
    sql`${t.status} not in ('VERIFIED', 'PUBLISHED') or ${t.verifiedAt} is not null`),
  check('sample_relations_published_difficulty_required',
    sql`${t.status} <> 'PUBLISHED' or ${t.difficulty} is not null`),
]);

export const sampleTimestamps = pgTable('sample_timestamps', {
  id: uuid('id').primaryKey().defaultRandom(),
  sampleRelationId: uuid('sample_relation_id').notNull()
    .references(() => sampleRelations.id, { onDelete: 'cascade' }),
  trackRole: trackRole('track_role').notNull(),
  timestampMs: integer('timestamp_ms').notNull(),
  isPreferred: boolean('is_preferred').notNull().default(false),
  // Unknown confidence is NULL, never an invented certainty.
  confidence: real('confidence'),
  ...auditColumns(),
}, (t) => [
  unique('sample_timestamps_position_unique').on(t.sampleRelationId, t.trackRole, t.timestampMs),
  uniqueIndex('sample_timestamps_one_preferred_per_role')
    .on(t.sampleRelationId, t.trackRole).where(sql`${t.isPreferred} = true`),
  check('sample_timestamps_nonnegative', sql`${t.timestampMs} >= 0`),
  check('sample_timestamps_confidence_range', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
]);

export type Track = typeof tracks.$inferSelect;
export type SampleRelation = typeof sampleRelations.$inferSelect;
export type SampleTimestamp = typeof sampleTimestamps.$inferSelect;
