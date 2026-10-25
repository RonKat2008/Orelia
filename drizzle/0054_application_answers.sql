-- Lane A2: the patient's answers to an online form's own questions (name, date of birth, email...), stored per
-- application. They are consent for that one application only; the outbound gate checks submitted values against them.
ALTER TABLE "web_applications" ADD COLUMN IF NOT EXISTS "answers" jsonb DEFAULT '{}'::jsonb NOT NULL;
