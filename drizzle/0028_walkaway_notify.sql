ALTER TABLE "cases" ADD COLUMN "patient_email" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "patient_notify_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "patient_notify_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "patient_notify_digest_on" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "approval_fingerprint" text;
