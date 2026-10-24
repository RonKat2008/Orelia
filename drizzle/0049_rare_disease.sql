-- Rare-disease specialisation: the undiagnosed (diagnostic odyssey) path and patient registries as an organization kind.
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "undiagnosed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "symptom_notes" text;--> statement-breakpoint
ALTER TYPE "organization_kind" ADD VALUE IF NOT EXISTS 'registry';
