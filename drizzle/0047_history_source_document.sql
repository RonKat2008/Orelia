-- Link case-history copies of account library documents by id (was: matched by "title (date)").
-- ON DELETE CASCADE matches library-delete semantics: deleting a library document removes its case copies.
ALTER TABLE "history_documents" ADD COLUMN IF NOT EXISTS "source_document_id" uuid REFERENCES "public"."account_documents"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "history_documents_source_document_idx" ON "history_documents" ("source_document_id");--> statement-breakpoint
-- Backfill only unambiguous pairs: within an account-owned case, exactly one library document of that account has the
-- copy's title, and exactly one history record in that case has that title. Anything else stays unlinked.
WITH candidates AS (
	SELECT h.id AS history_id, h.case_id, h.title, ad.id AS document_id
	FROM "history_documents" h
	JOIN "cases" c ON c.id = h.case_id AND c.account_id IS NOT NULL
	JOIN "account_documents" ad ON ad.account_id = c.account_id
		AND h.title = left(CASE WHEN ad.date_of_service IS NULL OR ad.date_of_service = '' THEN ad.title
			ELSE ad.title || ' (' || ad.date_of_service || ')' END, 200)
	WHERE h.source_document_id IS NULL
), unambiguous AS (
	SELECT history_id, min(document_id::text)::uuid AS document_id
	FROM candidates
	GROUP BY history_id
	HAVING count(*) = 1
), single_copy AS (
	SELECT u.history_id, u.document_id
	FROM unambiguous u
	JOIN "history_documents" h ON h.id = u.history_id
	WHERE (SELECT count(*) FROM "history_documents" h2 WHERE h2.case_id = h.case_id AND h2.title = h.title) = 1
)
UPDATE "history_documents" h SET "source_document_id" = s.document_id
FROM single_copy s WHERE h.id = s.history_id;
