ALTER TABLE "contacts" ADD COLUMN "first_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "follow_ups_sent" integer DEFAULT 0 NOT NULL;