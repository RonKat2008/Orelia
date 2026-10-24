-- Medical history lane (placeholder number; integrator renumbers and registers in meta/_journal.json).
ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'medical_record';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "history_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL REFERENCES "public"."cases"("id") ON DELETE cascade,
	"title" text NOT NULL,
	"doc_type" text NOT NULL,
	"text" text NOT NULL,
	"extracted_by" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "history_documents_case_idx" ON "history_documents" ("case_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "history_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL REFERENCES "public"."cases"("id") ON DELETE cascade,
	"sections" text[] NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "history_shares_case_idx" ON "history_shares" ("case_id");
