CREATE TABLE "condition_briefs" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"brief" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "condition_briefs" ADD CONSTRAINT "condition_briefs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
