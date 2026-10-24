"use client";

import { usePathname } from "next/navigation";
import { StageBar } from "@/components/shell/StageBar";
import type { JourneyPlan } from "./model";

/** Deprecated: the 7-step rail is now the judge StageBar (docs/DESIGN-v2.md 5.3). Kept as a thin wrapper. */
export function JourneyStepper({ plan }: { plan: JourneyPlan }) {
  const pathname = usePathname() ?? "/";
  const caseId = /^\/cases\/([^/]+)\//.exec(plan.documentsHref)?.[1] ?? "";
  return <StageBar plan={plan} caseId={caseId} pathname={pathname} />;
}
