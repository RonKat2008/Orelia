ALTER TABLE "agent_runs" ADD COLUMN "tokens_in" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "tokens_out" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cache_read" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cache_creation" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;
