-- rd-experts: own migration so the enum ADD VALUE is not mixed with statements that use it.
ALTER TYPE "public"."source_kind" ADD VALUE IF NOT EXISTS 'phone_call';
