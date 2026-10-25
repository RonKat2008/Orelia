-- Live call state (Vapi): provider status, end reason, summary and the listen-only monitor URL, one row per call.
CREATE TABLE IF NOT EXISTS "call_live" (
	"call_id" uuid PRIMARY KEY NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"status" text,
	"ended_reason" text,
	"summary" text,
	"listen_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Live transcript turns, stored as each final utterance arrives so the UI can show a call in progress.
CREATE TABLE IF NOT EXISTS "call_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
	"seq" bigint NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"spoken_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_turns_dedupe_key_unique" UNIQUE("dedupe_key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_turns_call_seq_idx" ON "call_turns" ("call_id","seq");
