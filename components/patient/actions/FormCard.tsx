"use client";

import { useEffect, useState } from "react";
import { Button, Skeleton, toast } from "@/components/ui";
import { approveApplicationRequest, displayValue, docIdsOf, loadApplications, requiredMissing, type ApiApplication } from "@/components/outreach/applications";
import type { PatientNextAction } from "@/lib/patient-status/types";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

/** A filled-in online form, field by field, with one Approve button. The server submits once, after the gate. */
export function FormCard({ caseId, onDone, action, headline }: ActionProps & { action: PatientNextAction; headline: string }) {
  const [application, setApplication] = useState<ApiApplication | null | undefined>(undefined);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void loadApplications(caseId).then((rows) => active && setApplication(rows.find((row) => row.id === action.applicationId) ?? null));
    return () => {
      active = false;
    };
  }, [caseId, action.applicationId]);

  const missing = application ? requiredMissing(application.missing) : [];

  async function approve() {
    if (!application) return;
    setBusy(true);
    setErrors([]);
    const result = await approveApplicationRequest(caseId, application.id, docIdsOf(application.fields));
    if (!result.ok) {
      setBusy(false);
      setErrors(result.reasons);
      return;
    }
    toast.success("Form sent", { description: "We'll tell you when they answer." });
    await onDone();
    setBusy(false);
  }

  return (
    <ActionFrame kind="approve_application" title={`Online form for ${action.name ?? "this program"}`} lede={headline} detailsHref={action.detailsHref}>
      {application === undefined ? <Skeleton className="h-40 w-full" /> : null}
      {application === null ? <ActionError messages={["We couldn't load this form. The detailed view has it."]} /> : null}
      {application ? (
        <>
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-0 rounded-md border border-line bg-card">
            {application.fields.map((field) => (
              <div key={field.fieldKey} className="grid gap-0.5 border-t border-line px-4 py-3 first:border-t-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-small font-semibold text-ink-2">{field.label || field.fieldKey}</dt>
                <dd className="m-0 text-body text-ink [overflow-wrap:anywhere]">{displayValue(field)}</dd>
              </div>
            ))}
          </dl>
          {missing.length > 0 ? (
            <p className="m-0 text-small text-ink-2">
              {missing.length} required {missing.length === 1 ? "question was" : "questions were"} left blank because you didn&apos;t share that detail.
            </p>
          ) : null}
          <ActionError messages={errors} />
          <div>
            <Button size="lg" loading={busy} loadingText="Sending" onClick={() => void approve()}>
              Approve and send the form
            </Button>
          </div>
        </>
      ) : null}
    </ActionFrame>
  );
}
