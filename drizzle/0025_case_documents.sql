-- Task 25 standalone migration. Apply explicitly; no live database was changed.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TYPE document_kind AS ENUM ('intake_report', 'case_summary', 'resource_page', 'evidence', 'inbound_message', 'call_transcript', 'patient_note');
CREATE TABLE case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  contact_id uuid REFERENCES contacts(id),
  kind document_kind NOT NULL,
  title text NOT NULL,
  source_url text,
  shared_field text,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1024) NOT NULL,
  embed_model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_documents_scope_idx ON case_documents (case_id, contact_id);
CREATE INDEX case_documents_embedding_idx ON case_documents USING hnsw (embedding vector_cosine_ops);
