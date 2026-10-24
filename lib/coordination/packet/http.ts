import { z } from 'zod';
import { packetSectionKeySchema, resourceKeySchema } from '../contract';
import { MAX_PATIENT_QUESTIONS } from './extract';

export const buildBodySchema = z.object({ resourceKey: resourceKeySchema }).strict();
export const patchBodySchema = z.object({
  resourceKey: resourceKeySchema,
  version: z.number().int().min(1),
  included: z.partialRecord(packetSectionKeySchema, z.boolean()).optional(),
  questions: z.array(z.string().max(300)).max(MAX_PATIENT_QUESTIONS).optional(),
}).strict();
export const attachBodySchema = z.object({ resourceKey: resourceKeySchema, contactId: z.uuid() }).strict();
