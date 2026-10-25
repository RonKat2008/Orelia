-- Lane K: one document space per case. share_with_resources defaults to off; document_uses records which documents an
-- agent read (titles only) so the judge view can show "Used 2 of your documents".
ALTER TABLE "account_documents" ADD COLUMN IF NOT EXISTS "share_with_resources" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
	"agent" text NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_uses_case_idx" ON "document_uses" ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_uses_case_agent_doc_key" ON "document_uses" ("case_id","agent","document_id");
