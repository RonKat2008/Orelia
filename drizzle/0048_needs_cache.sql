-- Needs analyst cache: disease-level content only (no case id, no personal fields), keyed by normalized disease
-- (+ subtype), so it outlives any single case. Replaces the case-scoped coordination_records "care_needs_base" rows.
CREATE TABLE IF NOT EXISTS "needs_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"disease_name" text NOT NULL,
	"subtype" text,
	"data" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "needs_cache_expires_idx" ON "needs_cache" ("expires_at");--> statement-breakpoint
DELETE FROM "coordination_records" WHERE "kind" = 'care_needs_base';
