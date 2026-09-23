CREATE TYPE "public"."content_status" AS ENUM('IMPORTED', 'REVIEW_NEEDED', 'VERIFIED', 'PUBLISHED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('EASY', 'MEDIUM', 'HARD');--> statement-breakpoint
CREATE TYPE "public"."track_role" AS ENUM('SOURCE', 'SAMPLED');--> statement-breakpoint
CREATE TABLE "sample_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_track_id" uuid NOT NULL,
	"sampled_track_id" uuid NOT NULL,
	"sample_type" text NOT NULL,
	"sample_element" text,
	"whosampled_url" text,
	"whosampled_relation_id" text,
	"status" "content_status" DEFAULT 'IMPORTED' NOT NULL,
	"difficulty" "difficulty",
	"verified_at" timestamp with time zone,
	"source_timestamp_text" text,
	"sampled_timestamp_text" text,
	"source_throughout" boolean DEFAULT false NOT NULL,
	"sampled_throughout" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sample_relations_whosampled_url_unique" UNIQUE("whosampled_url"),
	CONSTRAINT "sample_relations_whosampled_relation_id_unique" UNIQUE("whosampled_relation_id"),
	CONSTRAINT "sample_relations_track_pair_unique" UNIQUE("source_track_id","sampled_track_id"),
	CONSTRAINT "sample_relations_distinct_tracks" CHECK ("sample_relations"."source_track_id" <> "sample_relations"."sampled_track_id"),
	CONSTRAINT "sample_relations_type_not_blank" CHECK (length(btrim("sample_relations"."sample_type")) > 0),
	CONSTRAINT "sample_relations_verification_required" CHECK ("sample_relations"."status" not in ('VERIFIED', 'PUBLISHED') or "sample_relations"."verified_at" is not null),
	CONSTRAINT "sample_relations_published_difficulty_required" CHECK ("sample_relations"."status" <> 'PUBLISHED' or "sample_relations"."difficulty" is not null)
);
--> statement-breakpoint
CREATE TABLE "sample_timestamps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sample_relation_id" uuid NOT NULL,
	"track_role" "track_role" NOT NULL,
	"timestamp_ms" integer NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sample_timestamps_position_unique" UNIQUE("sample_relation_id","track_role","timestamp_ms"),
	CONSTRAINT "sample_timestamps_nonnegative" CHECK ("sample_timestamps"."timestamp_ms" >= 0),
	CONSTRAINT "sample_timestamps_confidence_range" CHECK ("sample_timestamps"."confidence" >= 0 and "sample_timestamps"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_key" text NOT NULL,
	"title" text NOT NULL,
	"artist_name" text NOT NULL,
	"album_name" text,
	"release_year" integer,
	"musicbrainz_id" uuid,
	"spotify_id" text,
	"apple_music_id" text,
	"whosampled_url" text,
	"artwork_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_canonical_key_unique" UNIQUE("canonical_key"),
	CONSTRAINT "tracks_musicbrainz_id_unique" UNIQUE("musicbrainz_id"),
	CONSTRAINT "tracks_spotify_id_unique" UNIQUE("spotify_id"),
	CONSTRAINT "tracks_apple_music_id_unique" UNIQUE("apple_music_id"),
	CONSTRAINT "tracks_whosampled_url_unique" UNIQUE("whosampled_url"),
	CONSTRAINT "tracks_canonical_key_not_blank" CHECK (length(btrim("tracks"."canonical_key")) > 0),
	CONSTRAINT "tracks_title_not_blank" CHECK (length(btrim("tracks"."title")) > 0),
	CONSTRAINT "tracks_artist_not_blank" CHECK (length(btrim("tracks"."artist_name")) > 0),
	CONSTRAINT "tracks_release_year_range" CHECK ("tracks"."release_year" between 1000 and 9999)
);
--> statement-breakpoint
ALTER TABLE "sample_relations" ADD CONSTRAINT "sample_relations_source_track_id_tracks_id_fk" FOREIGN KEY ("source_track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_relations" ADD CONSTRAINT "sample_relations_sampled_track_id_tracks_id_fk" FOREIGN KEY ("sampled_track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_timestamps" ADD CONSTRAINT "sample_timestamps_sample_relation_id_sample_relations_id_fk" FOREIGN KEY ("sample_relation_id") REFERENCES "public"."sample_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sample_relations_sampled_track_idx" ON "sample_relations" USING btree ("sampled_track_id");--> statement-breakpoint
CREATE INDEX "sample_relations_status_difficulty_idx" ON "sample_relations" USING btree ("status","difficulty");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_timestamps_one_preferred_per_role" ON "sample_timestamps" USING btree ("sample_relation_id","track_role") WHERE "sample_timestamps"."is_preferred" = true;