# Case documents

`ingest`, `search`, and `getDocumentStore` are exported from `lib/case-docs`.
`hooks.ts` exports `ingestCaseSummary`, `ingestEvidence`, and `ingestInbound`;
callers choose when to invoke them. `tool.ts` exports `caseDocsTool` for `runAgent`.
The tool fixes case/contact/consent in its closure; model arguments cannot widen scope.
Search snippets are untrusted context and do not bypass minimize, human approval, or OutboundGate.

Patient text requires a canonical SHARED_FIELDS key. Missing metadata is stored as
`unshared` and cannot be retrieved. Raw intake uses `intakeReport` and is excluded
from outreach search even if callers accidentally include that key in allowedFields.
Only evidence/resource_page chunks can be public with a null field. Inbound text is
private by default; callers must explicitly classify field-specific text to share it.
Ingest one summary per consent field; do not concatenate multiple patient fields into
one consent-tagged chunk. Consent arrays must come from the contact's current consent.

Embeddings are tagged with their model, with a separate `wayfinder-hashed-bow-v1`
space for offline data. Search ignores other models; reingest documents when changing
embedding models or moving from offline to live. Memory storage is process-local and
intended for tests/offline runs. Live embedding requests require both gateway env vars.

`drizzle/0025_case_documents.sql` is a standalone SQL migration (not registered in the
existing Drizzle journal, per task ownership of new migration files only). Apply it
explicitly to Postgres before enabling the database store. It creates pgvector, the
table, and the HNSW cosine index. No migration has been applied by this task.

GET documents returns `{documents: [{id, kind, title, sharedField, contactId, createdAt}]}`.
POST `{title, text, sharedField}` adds patient_note chunks, returns their metadata
with status 201, and accepts at most 20,000 characters. Titles are limited to 200.
Lists are for the patient's document panel; outreach agents must use filtered search.
