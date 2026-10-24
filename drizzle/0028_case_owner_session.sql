ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "owner_session_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_owner_session_id_idx" ON "cases" USING btree ("owner_session_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "details" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "case_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_case_id_idx" ON "tasks" USING btree ("case_id");--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
	FOR r IN SELECT id, draft_body FROM "tasks" WHERE draft_body IS NOT NULL AND draft_body ~ '^\s*\{' AND title IS NULL LOOP
		BEGIN
			UPDATE "tasks" SET
				title = (r.draft_body::jsonb->>'title'),
				details = jsonb_build_object('letter', r.draft_body::jsonb->'letter', 'details', r.draft_body::jsonb->'details'),
				case_id = (SELECT c.id FROM "cases" c WHERE c.id::text = (r.draft_body::jsonb->>'caseId'))
			WHERE id = r.id;
		EXCEPTION WHEN OTHERS THEN
			NULL;
		END;
	END LOOP;
END $$;
