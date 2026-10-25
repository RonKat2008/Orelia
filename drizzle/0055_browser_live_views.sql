-- Kernel cloud-browser live view: one row per launched session (fill or submit), judge console only.
-- The url is a session capability: it is never served to the patient view and dies when the browser is deleted.
CREATE TABLE IF NOT EXISTS "browser_live_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "host" text NOT NULL,
  "phase" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "browser_live_views_case_idx" ON "browser_live_views" ("case_id");
