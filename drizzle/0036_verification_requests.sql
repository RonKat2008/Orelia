-- rd-experts: AI verification calls.
CREATE TABLE IF NOT EXISTS "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"resource_key" text NOT NULL,
	"target_kind" "target_kind" NOT NULL,
	"target_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"phone_evidence_id" text NOT NULL,
	"shared_fields" jsonb NOT NULL,
	"script" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"call_id" text,
	"result" jsonb,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_requests_case_idx" ON "verification_requests" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verification_requests_call_id_unique" ON "verification_requests" USING btree ("call_id");
