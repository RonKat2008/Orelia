import { z } from 'zod';
import { resourceKeySchema } from '../contract';

export const newConsultBodySchema = z.object({
  resourceKey: resourceKeySchema,
  doctorId: z.uuid(),
  packetId: z.uuid().nullable().optional(),
  sharedFields: z.array(z.string().min(1).max(60)).max(20),
});

export const consultPatchBodySchema = z.object({
  version: z.number().int().min(1),
  action: z.enum(['edit', 'send_to_doctor', 'consent', 'send', 'cancel']),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
});
