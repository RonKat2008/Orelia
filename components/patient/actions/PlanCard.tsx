"use client";

import { useEffect, useState } from "react";
import { Mail, PhoneCall, MousePointerClick } from "lucide-react";
import { Button, Skeleton, toast } from "@/components/ui";
import { useDemoDestinations } from "@/components/outreach/DemoCoordinators";
import { getOrBuildPlan, patchPlan } from "@/components/plan/client";
import type { ContactPlan } from "@/lib/plan/contract";
import { planLine } from "@/lib/patient-status/plain";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

const ICONS = { email: Mail, voice: PhoneCall, web_form: MousePointerClick } as const;

/** How we'll reach each person, in one plain line each. "Looks good" is the patient's approval of the plan. */
export function PlanCard({ caseId, onDone, detailsHref, headline }: ActionProps & { detailsHref: string; headline: string }) {
  const demo = useDemoDestinations();
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

  async function approve() {
    if (!plan) return;
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
      return;
    }
    toast.success("Plan approved", { description: "Next, you'll read each message before it's sent." });
    await onDone();
    setBusy(false);
  }

  return (
    <ActionFrame kind="approve_plan" title="How we'll reach them" lede={headline} detailsHref={detailsHref}>
      {!plan && errors.length === 0 ? (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">Working out the best way to reach each one</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {plan ? (
        <>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
            {plan.resources.map((resource) => {
              const firstStep = [...resource.steps].filter((s) => s.enabled).sort((a, b) => a.order - b.order)[0];
              const Icon = firstStep ? ICONS[firstStep.channel] : Mail;
              return (
                <li key={resource.resourceKey} className="flex gap-3 rounded-md border border-line bg-card p-4">
                  <Icon aria-hidden className="mt-1 size-5 shrink-0 text-teal" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-body font-semibold text-ink [overflow-wrap:anywhere]">{resource.name}</span>
                    <span className="text-body text-ink-2">{planLine(resource.steps)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {demo.enabled ? (
            <p className="m-0 rounded-md border border-line bg-paper-2 p-3 text-small text-ink-2">
              Demo mode: messages go to Wayfinder&apos;s own test inbox and test phone, not to the real clinics.
            </p>
          ) : null}
          <p className="m-0 text-small text-ink-2">Approving this plan doesn&apos;t send anything. You&apos;ll read every message first.</p>
        </>
      ) : null}
      <ActionError messages={errors} />
      {plan ? (
        <div>
          <Button size="lg" loading={busy} loadingText="Saving" onClick={() => void approve()}>
            Looks good
          </Button>
        </div>
      ) : null}
    </ActionFrame>
  );
}
