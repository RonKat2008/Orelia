import { z } from "zod";

export const draftSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("email"),
    to: z.email(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    channel: z.literal("voice"),
    toNumber: z.string().min(1),
    script: z.string().min(1),
  }),
]);

export const inboundEventSchema = z.object({
  channel: z.enum(["email", "voice"]),
  contactId: z.uuid(),
  body: z.string(),
  receivedAt: z.iso.datetime(),
  providerId: z.string().optional(),
});

export type Draft = z.infer<typeof draftSchema>;
export type InboundEvent = z.infer<typeof inboundEventSchema>;
