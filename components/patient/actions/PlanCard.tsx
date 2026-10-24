"use client";

import { PlanView } from "../flows/plan/PlanView";
import type { ActionProps } from "./ActionFrame";

/** How we'll reach each person, on the case home. "OK this plan" is the patient's approval; it sends nothing. */
export function PlanCard({ caseId, onDone, detailsHref }: ActionProps & { detailsHref: string; headline?: string }) {
  return <PlanView caseId={caseId} layout="card" detailsHref={detailsHref} onDone={onDone} />;
}
