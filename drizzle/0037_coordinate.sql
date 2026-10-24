CREATE TABLE "coordination_records" (
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"token_hash" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordination_records_case_id_kind_key_pk" PRIMARY KEY("case_id","kind","key")
);--> statement-breakpoint
ALTER TABLE "coordination_records" ADD CONSTRAINT "coordination_records_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordination_records_token_hash_idx" ON "coordination_records" USING btree ("token_hash");
