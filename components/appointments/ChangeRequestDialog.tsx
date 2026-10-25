"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  RadioGroup,
  RadioGroupItem,
  ChoiceRow,
  Textarea,
  toast,
} from "@/components/ui";
import { telLink } from "@/lib/appointments/links";
import { approveChangeRequest, draftChangeRequest, type RequestDraftView } from "./client";
import { reasonText, type ApptView } from "./model";

type Kind = "reschedule" | "cancel";

/**
 * Reschedule or cancel: Orelia drafts a short message, the patient reads it and approves it. Sending runs the
 * normal outbound gate (allowlist, consent fields, AI disclosure, pacing, cap). Calling the office is always offered.
 */
export function ChangeRequestDialog({ appointment, onChange }: { appointment: ApptView; onChange: (next: ApptView) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("reschedule");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<RequestDraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tel = telLink(appointment.phone);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setDraft(null);
      setProblem(null);
      setNote("");
    }
  }

  async function prepare() {
    setBusy(true);
    setProblem(null);
    const result = await draftChangeRequest(appointment.id, kind, note);
    setBusy(false);
    if (!result.ok) return setProblem(reasonText(result.reasons));
    setDraft(result.data.request);
  }

  async function approve() {
    setBusy(true);
    setProblem(null);
    const result = await approveChangeRequest(appointment.id, kind);
    setBusy(false);
    if (!result.ok) return setProblem(reasonText(result.reasons));
    onChange(result.data.appointment);
    reset(false);
    toast.success(kind === "cancel" ? "Cancellation sent" : "Reschedule request sent", { description: "Their reply will show up here and in your threads." });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="link" className="min-h-11 text-small">Reschedule or cancel</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft ? "Read it, then approve" : "Change this appointment"}</DialogTitle>
          <DialogDescription>
            {draft ? "Nothing is sent until you approve. The office sees that an AI assistant wrote it for you." : "Orelia drafts a short message to the office for you to approve."}
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-2 rounded-md bg-paper-2 p-4">
            <p className="m-0 text-small font-semibold text-ink">{draft.subject}</p>
            <p className="m-0 whitespace-pre-wrap break-words text-small text-ink-2">{draft.body}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} aria-label="What do you need?">
              <ChoiceRow title="Ask for another time" description="The office is asked to suggest a new time.">
                <RadioGroupItem value="reschedule" aria-label="Ask for another time" />
              </ChoiceRow>
              <ChoiceRow title="Cancel it" description="The office is told you can't make it.">
                <RadioGroupItem value="cancel" aria-label="Cancel it" />
              </ChoiceRow>
            </RadioGroup>
            <Field label="Anything to add?" htmlFor={`note-${appointment.id}`} optional hint="Optional. Keep health details out; it goes to the office.">
              <Textarea id={`note-${appointment.id}`} value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
        {problem ? (
          <p role="alert" className="m-0 border-l-2 border-danger pl-3 text-small text-ink">{problem}</p>
        ) : null}
        {tel ? (
          <p className="m-0 text-small text-ink-2">
            Faster by phone? <a href={tel} className="font-semibold text-teal underline decoration-teal/35 underline-offset-4">Call the office</a>.
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Not now</Button>
          </DialogClose>
          {draft ? (
            <Button loading={busy} loadingText="Sending" onClick={() => void approve()}>
              <Send aria-hidden /> Approve and send
            </Button>
          ) : (
            <Button loading={busy} loadingText="Drafting" onClick={() => void prepare()}>
              Draft the message
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
