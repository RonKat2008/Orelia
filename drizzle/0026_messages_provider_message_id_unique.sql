CREATE UNIQUE INDEX IF NOT EXISTS "messages_provider_message_id_unique" ON "messages" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;
