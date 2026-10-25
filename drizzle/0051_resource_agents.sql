-- Agent factory: one persistent ResourceAgent per selected resource, plus its decision log.
CREATE TABLE IF NOT EXISTS "resource_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
	"contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
	"resource_key" text NOT NULL,
	"name" text NOT NULL,
	"goal" text NOT NULL,
	"strategy" jsonb NOT NULL,
	"strategy_step" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'planning' NOT NULL,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inbox_mode" text DEFAULT 'pending' NOT NULL,
	"inbox_id" text,
	"inbox_address" text,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_agents_case_resource_key" ON "resource_agents" ("case_id","resource_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_agents_contact_key" ON "resource_agents" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_agents_due_idx" ON "resource_agents" ("next_action_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_agents_inbox_idx" ON "resource_agents" ("inbox_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "resource_agents"("id") ON DELETE CASCADE,
	"case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"trigger" text,
	"reason" text,
	"action" text,
	"result" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_case_idx" ON "agent_events" ("case_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_agent_idx" ON "agent_events" ("agent_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid REFERENCES "resource_agents"("id") ON DELETE CASCADE,
	"case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"via" text DEFAULT 'app' NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_agent_idx" ON "agent_messages" ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_case_idx" ON "agent_messages" ("case_id","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_approval_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "resource_agents"("id") ON DELETE CASCADE,
	"draft_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
