"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Skeleton, toast } from "@/components/ui";
import { approveTask, loadTaskConfirmation, type TaskConfirmation } from "@/components/outreach/client";
import { loadCaseTasks } from "@/components/outreach/case-activity";
import type { OutreachTask } from "@/components/outreach/types";
import type { PatientNextAction } from "@/lib/patient-status/types";
import { ActionError, ActionFrame, type ActionProps } from "./ActionFrame";

/** A reply that needs the patient. Approving lets us prepare the next message; it never sends by itself. */
export function ReplyCard({ caseId, onDone, action, headline }: ActionProps & { action: PatientNextAction; headline: string }) {
  const [task, setTask] = useState<OutreachTask | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<TaskConfirmation | null>(null);
  const [typed, setTyped] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const redirect = action.taskKind === "redirect";

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
    setBusy(true);
    setErrors([]);
    const result = await approveTask(action.taskId, fetch, redirect ? { confirmAddress: typed } : {});
    if (!result.available || !result.approved) {
      setBusy(false);
      setErrors(result.reasons);
      return;
    }
    toast.success("Done", { description: "If this needs a message, you'll read it here before it's sent." });
    await onDone();
    setBusy(false);
  }

  const declined = action.taskKind === "declined";
  return (
    <ActionFrame kind="answer_task" title={declined ? `${action.name ?? "They"} can't help right now` : `${action.name ?? "They"} replied`} lede={headline} detailsHref={action.detailsHref}>
      {task === undefined ? <Skeleton className="h-20 w-full" /> : null}
      {task ? <p className="m-0 rounded-md border border-line bg-paper-2 p-4 text-body text-ink [overflow-wrap:anywhere]">{task.summary}</p> : null}
      {redirect && confirm ? (
        <Field label="Type the new address to confirm it" htmlFor="redirect-confirm" hint={`They wrote: ${confirm.address}`}>
          <Input id="redirect-confirm" type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      ) : null}
      <p className="m-0 text-small text-ink-2">
        {declined ? "This just closes the request. Nothing is sent." : "Approving lets us prepare the next step. Any message comes back to you to read first."}
      </p>
      <ActionError messages={errors} />
      <div>
        <Button size="lg" loading={busy} loadingText="Saving" disabled={redirect && !typed.trim()} onClick={() => void approve()}>
          {action.label}
        </Button>
      </div>
    </ActionFrame>
  );
}
