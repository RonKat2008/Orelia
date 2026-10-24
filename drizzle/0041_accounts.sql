-- Accounts lane: Neon Auth users (neon_auth schema, managed by Neon) own a profile and a medical-document library.
-- account_id is the Neon Auth user id (text). No cross-schema FK: Neon manages neon_auth; deleting an account deletes
-- these rows explicitly (and cases cascade from cases.id).
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "account_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_account_id_idx" ON "cases" USING btree ("account_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_profiles" (
  "account_id" text PRIMARY KEY NOT NULL,
  "profile" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" text NOT NULL,
  "title" text NOT NULL,
  "doc_type" text NOT NULL,
  "date_of_service" text,
  "provider" text,
  "notes" text,
  "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "blob_pathname" text NOT NULL,
  "status" text DEFAULT 'pending_upload' NOT NULL,
  "status_detail" text,
  "page_count" integer,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_documents_account_idx" ON "account_documents" USING btree ("account_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_documents_blob_pathname_key" ON "account_documents" USING btree ("blob_pathname");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" text NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "account_documents"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "page" integer,
  "section" text,
  "content" text NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "embed_model" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_document_chunks_scope_idx" ON "account_document_chunks" USING btree ("account_id", "embed_model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_document_chunks_document_idx" ON "account_document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_document_chunks_embedding_idx" ON "account_document_chunks" USING hnsw ("embedding" vector_cosine_ops);
