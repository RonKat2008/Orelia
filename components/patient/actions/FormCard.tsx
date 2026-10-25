"use client";

import { useEffect, useState } from "react";
import { Button, Skeleton, SummaryList, toast } from "@/components/ui";
import { approveApplicationRequest, displayValue, docIdsOf, loadApplications, requiredMissing, type ApiApplication } from "@/components/outreach/applications";
import type { PatientNextAction } from "@/lib/patient-status/types";
import { FormQuestionsCard } from "@/components/outreach/FormQuestionsCard";
import { PATIENT_HOME_COPY } from "../copy";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

const COPY = PATIENT_HOME_COPY.form;

/** A filled-in online form, field by field, with one OK button. The server submits once, after the gate. */
export function FormCard({ caseId, onDone, action }: ActionProps & { action: PatientNextAction; headline?: string }) {
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
    toast.success(COPY.toast, { description: COPY.toastDetail });
    await onDone();
    setBusy(false);
  }

  return (
    <ActionFrame
      kind="approve_application"
      title={COPY.title(action.name ?? COPY.fallbackName)}
      detailsHref={action.detailsHref}
      action={
        application ? (
          <Button size="lg" loading={busy} loadingText={COPY.busy} onClick={() => void approve()}>
            {COPY.action}
          </Button>
        ) : undefined
      }
      reassurance={application ? COPY.reassurance : undefined}
    >
      {application === undefined ? <Skeleton className="h-40 w-full" /> : null}
      {application === null ? <ActionError messages={[COPY.loadFailed]} /> : null}
      <ActionError messages={errors} />
      {application ? (
        <>
          <SummaryList rows={application.fields.map((field) => ({ label: field.label || field.fieldKey, value: displayValue(field) }))} />
          <FormQuestionsCard caseId={caseId} application={application} onSaved={(next) => { setErrors([]); setApplication(next); }} />
          {missing.length > 0 ? <p className="m-0 text-small text-ink-2">{COPY.blank(missing.length)}</p> : null}
        </>
      ) : null}
    </ActionFrame>
  );
}
