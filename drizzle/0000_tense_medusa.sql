CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'done', 'failed', 'not_implemented');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('email', 'voice');--> statement-breakpoint
CREATE TYPE "public"."contact_state" AS ENUM('drafted', 'sent', 'replied', 'task_open', 'records_sent', 'appointment_booked', 'connected', 'declined', 'stalled');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('second_opinion', 'treatment', 'trial', 'support', 'aid');--> statement-breakpoint
CREATE TYPE "public"."institution_kind" AS ENUM('cancer_center', 'rare_disease_center', 'hospital');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('advocacy', 'financial_aid', 'travel_aid');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('correct', 'incorrect');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('pubmed', 'ctgov', 'nppes', 'nci', 'exa');--> statement-breakpoint
CREATE TYPE "public"."target_kind" AS ENUM('expert', 'institution', 'trial', 'organization');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('referral', 'slides', 'records', 'call', 'redirect', 'unclear', 'declined');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'approved', 'done');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"counts" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"output_summary" text
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"provider_call_id" text,
	"to_number" text NOT NULL,
	"script" text NOT NULL,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"transcript" text,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "case_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"target_kind" "target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"rank" integer,
	"score" integer,
	"score_breakdown" jsonb,
	"selected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"disease_name" text NOT NULL,
	"disease_codes" jsonb,
	"subtype" text,
	"stage_summary" text,
	"home_city" text,
	"home_state" text,
	"insurer" text,
	"plan_id" text,
	"travel_limit_miles" integer,
	"goals" "goal"[] DEFAULT ARRAY[]::goal[] NOT NULL,
	"status" text DEFAULT 'unconfirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"shared_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"target_kind" "target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"address" text NOT NULL,
	"state" "contact_state" DEFAULT 'drafted' NOT NULL,
	"next_follow_up_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" "target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"claim" text NOT NULL,
	"source_url" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npi" text,
	"name" text NOT NULL,
	"credentials" text,
	"specialty" text,
	"institution_id" uuid,
	"disease_paper_count" integer,
	"recent_paper_count" integer,
	"trials_led" integer,
	"verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "institution_kind" NOT NULL,
	"nci_designated" boolean DEFAULT false NOT NULL,
	"programs" jsonb,
	"intake_url" text,
	"intake_contact" text,
	"city" text,
	"state" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"channel" "channel" NOT NULL,
	"provider_thread_id" text,
	"provider_message_id" text,
	"subject" text,
	"body" text NOT NULL,
	"shared_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"classification" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"services" jsonb,
	"contact" jsonb
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"target_kind" "target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"reviewer" text NOT NULL,
	"verdict" "review_verdict" NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "task_kind" NOT NULL,
	"draft_body" text,
	"due_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nct_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text,
	"phase" text,
	"sponsor" text,
	"sites" jsonb,
	"contacts" jsonb
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_candidates" ADD CONSTRAINT "case_candidates_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experts_npi_unique" ON "experts" USING btree ("npi");--> statement-breakpoint
CREATE UNIQUE INDEX "trials_nct_id_unique" ON "trials" USING btree ("nct_id");