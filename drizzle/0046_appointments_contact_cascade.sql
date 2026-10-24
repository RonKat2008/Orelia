-- Appointments cascade with their contact (as every case-scoped row does); 0045 first shipped ON DELETE SET NULL.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_contact_id_fkey";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade;
