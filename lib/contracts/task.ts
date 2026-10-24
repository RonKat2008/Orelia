import { z } from "zod";

export const taskKindSchema = z.enum([
  "referral",
  "slides",
  "records",
  "call",
  "redirect",
  "unclear",
  "declined",
  "application",
]);

export const taskStatusSchema = z.enum(["open", "approved", "done"]);

export type TaskKind = z.infer<typeof taskKindSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
