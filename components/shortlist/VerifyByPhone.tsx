"use client";

import { useState } from "react";
import { PhoneCall } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  ChoiceRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui";
import type { VerificationRequest } from "@/lib/verification/contract";
import { approveVerification, prepareVerification } from "./verify-client";
import { sharedFieldsFor, statusText, verifyQuestions } from "./verify-model";

interface Props {
  caseId: string;
  resourceKey: string;
  name: string;
  insurer: string | null;
  onChanged: () => void;
}

export function VerifyByPhone({ caseId, resourceKey, name, insurer, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [shareInsurer, setShareInsurer] = useState(false);
  const [request, setRequest] = useState<VerificationRequest | null>(null);
  const [busy, setBusy] = useState<"prepare" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approved = request !== null && request.status !== "awaiting_approval";

  async function prepare() {
    setBusy("prepare");
    setError(null);
    const result = await prepareVerification(caseId, { resourceKey, sharedFields: sharedFieldsFor(shareInsurer && insurer !== null) });
    setBusy(null);
    if (result.ok) setRequest(result.value);
    else setError(result.status === 422 ? `${result.message} Nobody was called.` : result.message);
  }

  async function approve() {
    if (!request) return;
    setBusy("approve");
    setError(null);
    const result = await approveVerification(caseId, request.id);
    setBusy(null);
    if (result.ok) {
      setRequest(result.value);
      onChanged();
    } else {
      setError(result.message);
      if (result.status === 422) {
        setRequest({ ...request, status: "blocked", blockedReasons: result.reasons });
        onChanged();
      }
    }
  }

  function handleOpen(next: boolean) {
    setOpen(next);
    if (!next && approved) {
      setRequest(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Verify ${name} by phone`}>
          <PhoneCall aria-hidden /> Verify by phone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {name} by phone</DialogTitle>
          <DialogDescription>
            A short AI call that says it is an AI and asks only the six questions below. Nothing is dialed until you
            press &ldquo;Approve and call&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="verify-questions" className="grid gap-2">
          <h3 id="verify-questions" className="m-0 text-micro font-semibold uppercase text-ink-3">
            The six questions
          </h3>
          <ol className="m-0 grid gap-1 pl-5 text-small text-ink">
            {verifyQuestions().map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="verify-shared" className="grid gap-3">
          <h3 id="verify-shared" className="m-0 text-micro font-semibold uppercase text-ink-3">
            What is shared
          </h3>
          <ChoiceRow title="Diagnosis" description="Required, so the practice knows which condition you are asking about.">
            <Checkbox checked disabled aria-label="Diagnosis (required)" />
          </ChoiceRow>
          {insurer ? (
            <ChoiceRow title="Insurance" description={`Optional. Shares the insurer name (${insurer}) so they can say if it is accepted.`}>
              <Checkbox
                checked={shareInsurer}
                disabled={request !== null}
                onCheckedChange={(v) => setShareInsurer(v === true)}
                aria-label="Share insurance"
              />
            </ChoiceRow>
          ) : null}
          <p className="m-0 text-small text-ink-2">Nothing else about you is shared.</p>
        </section>

        {request ? (
          <section aria-labelledby="verify-script" className="grid gap-2">
            <h3 id="verify-script" className="m-0 text-micro font-semibold uppercase text-ink-3">
              Exactly what the caller will say
            </h3>
            <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-paper-2 p-4 font-sans text-small text-ink">
              {request.script}
            </pre>
            <p className="m-0 flex flex-wrap items-center gap-2 text-small text-ink-2" role="status">
              <Badge tone={request.status === "blocked" || request.status === "failed" ? "warn" : request.status === "completed" ? "ok" : "neutral"}>
                {request.status.replaceAll("_", " ")}
              </Badge>
              {statusText(request)}
            </p>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="m-0 rounded-md border border-line bg-card px-4 py-3 text-small text-ink">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {!request ? (
            <Button onClick={() => void prepare()} loading={busy === "prepare"} loadingText="Preparing">
              Prepare call
            </Button>
          ) : request.status === "awaiting_approval" ? (
            <Button onClick={() => void approve()} loading={busy === "approve"} loadingText="Starting the call">
              Approve and call
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => handleOpen(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
