"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { ConditionCardResponse } from "@/app/api/cases/[id]/condition-card/load";

const sourceSchema = z.object({ label: z.string(), href: z.string() });
const factSchema = z.object({
  kind: z.enum(["name", "code", "prevalence", "experts", "centers", "nearest"]),
  id: z.string(),
  label: z.string(),
  value: z.string(),
  plain: z.string().optional(),
  source: sourceSchema,
  system: z.enum(["orpha", "omim", "mesh", "icd10"]).optional(),
  count: z.number().optional(),
  miles: z.number().optional(),
  travelLimitMiles: z.number().optional(),
  withinTravelLimit: z.boolean().optional(),
});
const nearestSchema = z.object({ name: z.string(), miles: z.number(), travelLimitMiles: z.number(), withinTravelLimit: z.boolean(), href: z.string() });

/** Shape check for GET /api/cases/[id]/condition-card (never trust the wire). */
export const conditionCardResponseSchema = z.object({
  card: z.object({ caseId: z.string(), undiagnosed: z.boolean(), facts: z.array(factSchema) }),
  symptoms: z.object({ quotes: z.array(z.object({ text: z.string(), citation: sourceSchema })) }).nullable(),
  travel: z.object({
    items: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["travel_aid", "financial_aid"]), href: z.string() })),
    nearest: nearestSchema.nullable(),
    show: z.boolean(),
  }),
});

export type ConditionCardState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: ConditionCardResponse };

export function useConditionCard(caseId: string): ConditionCardState {
  const [state, setState] = useState<ConditionCardState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cases/${encodeURIComponent(caseId)}/condition-card`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const parsed = res.ok ? conditionCardResponseSchema.safeParse(await res.json()) : null;
        setState(parsed?.success ? { kind: "ready", data: parsed.data } : { kind: "error" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [caseId]);
  return state;
}
