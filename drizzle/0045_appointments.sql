-- Calendar lane: appointments (proposed from replies, confirmed only by the patient), private ICS feeds and
-- Google Calendar connections (tokens sealed with AES-256-GCM). Everything cascades with the case.
CREATE TABLE IF NOT EXISTS "appointments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "owner_key" text,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE set null,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "timezone" text NOT NULL,
  "location" text,
  "telehealth_url" text,
  "phone" text,
  "with_whom" text,
  "status" text NOT NULL,
  "source" text NOT NULL,
  "source_message_id" text,
  "candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "quote" text,
  "prep_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reminders" jsonb DEFAULT '[1440,120]'::jsonb NOT NULL,
  "reminded_at" timestamp with time zone,
  "google_event_id" text,
  "request_message_id" uuid,
  "sequence" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_case_idx" ON "appointments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_owner_idx" ON "appointments" USING btree ("owner_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_source_unique" ON "appointments" USING btree ("case_id", "source_message_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_feeds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_key" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_fetched_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_feeds_owner_idx" ON "calendar_feeds" USING btree ("owner_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_connections" (
  "owner_key" text NOT NULL,
  "provider" text NOT NULL,
  "scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "refresh_token_sealed" text,
  "access_token_sealed" text,
  "access_expires_at" timestamp with time zone,
  "calendar_id" text DEFAULT 'primary' NOT NULL,
  "free_busy_opt_in" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_connections_pk" PRIMARY KEY ("owner_key", "provider")
);
