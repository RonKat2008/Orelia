CREATE TABLE "expert_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"traced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "expert_traces" ADD CONSTRAINT "expert_traces_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expert_traces_case_idx" ON "expert_traces" USING btree ("case_id");
