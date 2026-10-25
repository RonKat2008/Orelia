-- Web-form-only resources get a contact row (channel 'web', address = the form URL) so consent and the plan work.
ALTER TYPE "channel" ADD VALUE IF NOT EXISTS 'web';
