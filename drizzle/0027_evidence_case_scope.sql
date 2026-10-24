-- Scope evidence to the case whose research produced it (one case must never read another's evidence).
-- Existing rows have no case; copy each one to every case that has a candidate for its target (what those cases
-- could already see), then drop rows that belong to no case. Key becomes (case_id, id).
ALTER TABLE "evidence" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" DROP CONSTRAINT "evidence_pkey";--> statement-breakpoint
INSERT INTO "evidence" ("id", "case_id", "target_kind", "target_id", "claim_type", "claim", "source_url", "source_kind", "fetched_at")
SELECT DISTINCT e."id", cc."case_id", e."target_kind", e."target_id", e."claim_type", e."claim", e."source_url", e."source_kind", e."fetched_at"
FROM "evidence" e JOIN "case_candidates" cc ON cc."target_id" = e."target_id" AND cc."target_kind" = e."target_kind"
WHERE e."case_id" IS NULL;--> statement-breakpoint
DELETE FROM "evidence" WHERE "case_id" IS NULL;--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "case_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_case_id_id_pk" PRIMARY KEY("case_id","id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;
