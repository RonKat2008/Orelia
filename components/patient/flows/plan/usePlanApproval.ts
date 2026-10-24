"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui";
import { getOrBuildPlan, patchPlan } from "@/components/plan/client";
import type { ContactPlan } from "@/lib/plan/contract";
import { PLAN_COPY as COPY } from "./copy";

export interface PlanApproval {
  plan: ContactPlan | null;
  errors: string[];
  busy: boolean;
  /** The patient's OK of the plan (same patch PlanCard always sent). Resolves true on success. Sends nothing. */
  approve: () => Promise<boolean>;
}

export function usePlanApproval(caseId: string): PlanApproval {
  const [plan, setPlan] = useState<ContactPlan | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getOrBuildPlan(caseId).then((result) => {
      if (!active) return;
      if (result.ok) setPlan(result.plan);
      else setErrors([result.message]);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  async function approve(): Promise<boolean> {
    if (!plan) return false;
    setBusy(true);
    setErrors([]);
    let result = await patchPlan(caseId, plan.version, [{ type: "approve" }]);
    if (!result.ok && result.status === 409) {
      const fresh = await getOrBuildPlan(caseId);
      if (fresh.ok) result = await patchPlan(caseId, fresh.plan.version, [{ type: "approve" }]);
    }
    if (!result.ok) {
      setBusy(false);
      setErrors([result.message]);
      return false;
    }
    toast.success(COPY.toast, { description: COPY.toastDetail });
    setBusy(false);
    return true;
  }

  return { plan, errors, busy, approve };
}
