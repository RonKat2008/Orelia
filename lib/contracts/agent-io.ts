import { z } from "zod";
import { evidenceSchema } from "./evidence";
import { resourceSchema } from "./resource";

export const agentNameSchema = z.enum([
  "literature",
  "trials",
  "identity",
  "centers",
  "advocacy",
  "aid",
  "contact_finder",
  "network",
  "logistics",
]);

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "not_implemented",
]);

export const scoreBreakdownItemSchema = z.object({
  factor: z.string().min(1),
  points: z.number(),
  text: z.string(),
  evidenceIds: z.array(z.string()),
});

export const researchResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    records: z.array(resourceSchema),
    evidence: z.array(evidenceSchema),
  }),
  z.object({
    status: z.literal("not_implemented"),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string(),
  }),
]);

export type AgentName = z.infer<typeof agentNameSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type ScoreBreakdownItem = z.infer<typeof scoreBreakdownItemSchema>;
export type ResearchResult = z.infer<typeof researchResultSchema>;
