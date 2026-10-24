-- Task 58: web_form application drafts. Apply with drizzle-kit migrate (not run by this task).
ALTER TYPE "task_kind" ADD VALUE IF NOT EXISTS 'application';
--> statement-breakpoint
CREATE TABLE "web_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "cases"("id"),
  "contact_id" uuid REFERENCES "contacts"("id"),
  "task_id" uuid REFERENCES "tasks"("id"),
  "url" text NOT NULL,
  "fields" jsonb NOT NULL,
  "missing" jsonb NOT NULL,
  "form_fingerprint" text NOT NULL,
  "screenshot" text,
  "shared_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "shared_doc_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "result" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "web_applications_case_idx" ON "web_applications" ("case_id");
