"use client";

import { useEffect, useState } from "react";
import { ActionCard, Button, Field, Input, Skeleton, Surface, toast } from "@/components/ui";
import { approveTask, loadTaskConfirmation, type TaskConfirmation } from "@/components/outreach/client";
import { loadCaseTasks } from "@/components/outreach/case-activity";
import type { OutreachTask } from "@/components/outreach/types";
import type { PatientNextAction } from "@/lib/patient-status/types";
import type { ActionProps } from "./ActionFrame";

/** Every patient-visible string on this card, for the readability check. */
export const REPLY_COPY = {
  replied: (name: string) => `${name} replied`,
  cantHelp: (name: string) => `${name} can't help right now`,
  asked: (name: string, what: string) => `${name} asked for your ${what}`,
  theySaid: "What they said",
  letterNext: "We'll write the reply with only what you agreed to share. You read it before it's sent.",
  declinedNote: "This just closes the request. Nothing is sent.",
  otherNote: "We'll get the next step ready. Any message comes back to you first.",
  confirmLabel: "Type the new address to confirm it",
  confirmHint: (address: string) => `They wrote: ${address}`,
  confirmMissing: "Type the new address, so we know it's right.",
  mismatch: "That address doesn't match what they wrote. Check it and try again.",
  failed: "That didn't work. Nothing was sent. Please try again.",
  saving: "Saving",
  done: "Done",
  doneDetail: "If this needs a message, you'll read it here before it's sent.",
} as const;

/** A reply that needs the patient. Approving lets us prepare the next step; it never sends by itself. */
export function ReplyCard({ caseId, onDone, action }: ActionProps & { action: PatientNextAction; headline?: string }) {
  const [task, setTask] = useState<OutreachTask | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<TaskConfirmation | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const redirect = action.taskKind === "redirect";
  const declined = action.taskKind === "declined";
  const letter = action.taskKind === "records" || action.taskKind === "slides";
  const name = action.name ?? "They";

  useEffect(() => {
    let active = true;
    void loadCaseTasks(caseId).then((rows) => active && setTask(rows?.find((row) => row.id === action.taskId) ?? null));
    if (redirect && action.taskId) void loadTaskConfirmation(action.taskId).then((found) => active && setConfirm(found));
    return () => {
      active = false;
    };
  }, [caseId, action.taskId, redirect]);

  async function approve() {
    if (!action.taskId) return;
    if (redirect && !typed.trim()) {
      setError(REPLY_COPY.confirmMissing);
      document.getElementById("redirect-confirm")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await approveTask(action.taskId, fetch, redirect ? { confirmAddress: typed } : {});
    if (!result.available || !result.approved) {
      setBusy(false);
      setError(result.reasons.includes("address_confirmation_mismatch") ? REPLY_COPY.mismatch : REPLY_COPY.failed);
      return;
    }
    toast.success(REPLY_COPY.done, { description: REPLY_COPY.doneDetail });
    await onDone();
    setBusy(false);
  }

  const title = declined
    ? REPLY_COPY.cantHelp(name)
    : letter
      ? REPLY_COPY.asked(name, action.taskKind === "slides" ? "slides" : "records")
      : REPLY_COPY.replied(name);
  const note = declined ? REPLY_COPY.declinedNote : letter ? REPLY_COPY.letterNext : REPLY_COPY.otherNote;

  return (
    <ActionCard
      data-testid="patient-action"
      data-action="answer_task"
      title={title}
      action={
        <Button size="lg" loading={busy} loadingText={REPLY_COPY.saving} onClick={() => void approve()}>
          {action.label}
        </Button>
      }
      reassurance={note}
    >
      {task === undefined ? <Skeleton className="h-20 w-full" /> : null}
      {task ? (
        <Surface variant="well" radius="md" padding="md" aria-label={REPLY_COPY.theySaid}>
          <p className="m-0 text-body text-ink [overflow-wrap:anywhere]">{task.summary}</p>
        </Surface>
      ) : null}
      {redirect && confirm ? (
        <Field label={REPLY_COPY.confirmLabel} htmlFor="redirect-confirm" hint={REPLY_COPY.confirmHint(confirm.address)} error={error === REPLY_COPY.confirmMissing ? error : undefined}>
          <Input id="redirect-confirm" type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      ) : null}
      {error && error !== REPLY_COPY.confirmMissing ? (
        <p role="alert" className="m-0 text-body text-ink">
          {error}
        </p>
      ) : null}
    </ActionCard>
  );
}
