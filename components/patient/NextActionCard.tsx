"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, toast } from "@/components/ui";
import type { PatientStatus } from "@/lib/patient-status/types";
import { ActionError, ActionFrame } from "./actions/ActionFrame";
import { FormCard } from "./actions/FormCard";
import { MessageCard } from "./actions/MessageCard";
import { PickContactsCard } from "./actions/PickContactsCard";
import { ApproveAllCard } from "./actions/ApproveAllCard";
import { ReplyCard } from "./actions/ReplyCard";
import { ShareCard } from "./actions/ShareCard";
import { ConfirmCard } from "./actions/ConfirmCard";
import { PATIENT_HOME_COPY } from "./copy";

function RetryCard({ caseId, onDone, detailsHref }: { caseId: string; onDone: () => Promise<void>; detailsHref: string }) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const copy = PATIENT_HOME_COPY.retry;
  async function retry() {
    setBusy(true);
    setErrors([]);
    const response = await fetch(`/api/cases/${caseId}/research`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setBusy(false);
      setErrors([copy.failed]);
      return;
    }
    toast.success(copy.toast);
    await onDone();
    setBusy(false);
  }
  return (
    <ActionFrame
      kind="retry_search"
      title={copy.title}
      detailsHref={detailsHref}
      action={
        <Button size="lg" loading={busy} loadingText={copy.busy} onClick={() => void retry()}>
          {copy.action}
        </Button>
      }
    >
      {errors.length > 0 ? <ActionError messages={errors} /> : null}
    </ActionFrame>
  );
}

/** Exactly one card: the next thing the patient must do, chosen by patientStatus(). */
export function NextActionCard({
  caseId,
  status,
  onDone,
}: {
  caseId: string;
  status: PatientStatus;
  onDone: () => Promise<void>;
}) {
  const action = status.nextAction;
  if (!action) return null;
  const common = { caseId, onDone, headline: status.headline };
  // Keyed by the action so a new action starts with fresh state.
  const key = [action.kind, action.contactId, action.taskId, action.applicationId, action.followUp ? "f" : ""].join(":");
  switch (action.kind) {
    case "pick_contacts":
      return <PickContactsCard key={key} {...common} detailsHref={action.detailsHref} />;
    case "share_details":
      return <ShareCard key={key} {...common} detailsHref={action.detailsHref} />;
    case "approve_plan":
      return <ApproveAllCard key={key} {...common} detailsHref={action.detailsHref} />;
    case "approve_message":
      return <MessageCard key={key} {...common} action={action} />;
    case "approve_application":
      return <FormCard key={key} {...common} action={action} />;
    case "answer_task":
      return <ReplyCard key={key} {...common} action={action} />;
    case "retry_search":
      return <RetryCard key={key} caseId={caseId} onDone={onDone} detailsHref={action.detailsHref} />;
    case "confirm_details":
      return <ConfirmCard key={key} {...common} />;
    case "try_someone_else":
      return (
        <ActionFrame
          key={key}
          kind={action.kind}
          title={PATIENT_HOME_COPY.trySomeoneElse.title}
          lede={PATIENT_HOME_COPY.trySomeoneElse.lede}
          action={
            <Button asChild size="lg">
              <Link href={action.detailsHref}>{action.label}</Link>
            </Button>
          }
        />
      );
  }
}
