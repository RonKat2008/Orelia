-- Recoverable webhook ingest. The inbound message / transcript row is stored before ingest (classification ->
-- tasks, contact state). These columns record whether ingest completed, so a provider retry after a failed ingest
-- re-runs it instead of stopping at the provider-id duplicate check; tasks.source_id makes the re-run idempotent.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ingested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ingest_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "transcript_ingested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "transcript_ingest_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_source_id_idx" ON "tasks" USING btree ("source_id");--> statement-breakpoint
-- Rows that predate the ledger were handled by the old path; never re-ingest them on a stray redelivery.
UPDATE "messages" SET "ingested_at" = COALESCE("received_at", now()) WHERE "direction" = 'inbound' AND "ingested_at" IS NULL;--> statement-breakpoint
UPDATE "calls" SET "transcript_ingested_at" = COALESCE("ended_at", now()) WHERE "transcript" IS NOT NULL AND "transcript_ingested_at" IS NULL;
