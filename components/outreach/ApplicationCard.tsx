"use client";

import { useState } from "react";
import { CircleCheck, FileText, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/components/ui";
import { approveApplicationRequest, displayValue, docIdsOf, requiredMissing, sourceLabel, type ApiApplication } from "./applications";
import { formatWhen } from "./format";
import { DemoCoordinatorBadge } from "./DemoCoordinators";
import { isDemoFormUrl } from "@/lib/outreach/demo-destinations-shared";
import { CASE_SECTION_HEADING } from "./CasePage";

const SectionH = CASE_SECTION_HEADING;

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Status word + tone for the outbox row and the detail pane (colour never alone: the word carries it). */
export const STATUS_COPY: Record<ApiApplication["status"], { label: string; tone: "teal" | "ok" | "neutral" | "warn" | "danger" }> = {
  draft: { label: "Waiting for you", tone: "teal" },
  approved: { label: "Approved", tone: "ok" },
  submitting: { label: "Submitting", tone: "neutral" },
  submitted: { label: "Submitted", tone: "ok" },
  stale: { label: "Form changed", tone: "warn" },
  refused: { label: "Refused", tone: "danger" },
  failed: { label: "Not submitted", tone: "danger" },
};

interface ApplicationCardProps {
  caseId: string;
  application: ApiApplication;
  /** "Step 1 of 2 in the plan for ..." when the plan names this form. */
  stepContext: string | null;
  onChange: (next: ApiApplication) => void;
}

/**
 * "Review application" detail (outbox judge pane): the filled (never submitted) form, every value with its source,
 * then approve and submit. Renders as pane content, not a card; the outbox row carries the status badge.
 */
export function ApplicationCard({ caseId, application, stepContext, onChange }: ApplicationCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const host = hostOf(application.url);
  const demoForm = isDemoFormUrl(application.url);
  const status = STATUS_COPY[application.status];
  const open = requiredMissing(application.missing);
  const canApprove = application.status === "draft" && application.fields.length > 0;
  const titleId = `application-${application.id}`;

  async function approve() {
    setBusy(true);
    const result = await approveApplicationRequest(caseId, application.id, docIdsOf(application.fields));
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setErrors(result.reasons);
      toast.error("The safety check refused this application", { description: "Nothing was submitted." });
      return;
    }
    setErrors(null);
    onChange({ ...application, status: "submitted", submittedAt: result.submittedAt, approvedAt: result.submittedAt });
    toast.success("Application submitted", {
      description: demoForm ? "Demo: delivered to Wayfinder test form after the safety check." : `Sent to ${host} after the safety check.`,
    });
  }

  return (
    <div data-channel="web_form" aria-labelledby={titleId} role="group" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionH id={titleId} className="m-0 break-words font-display text-h3 font-normal text-ink display-soft">
            Review application
          </SectionH>
          <Badge tone={status.tone}>
            {application.status === "submitted" ? <CircleCheck aria-hidden /> : null}
            {status.label}
          </Badge>
        </div>
        <p className="m-0 flex flex-wrap items-center gap-2 break-words text-small text-ink-2">
          <FileText aria-hidden className="size-4 shrink-0 text-ch-apply" />
          Online form · {demoForm ? "Wayfinder demo intake form" : host}
          <DemoCoordinatorBadge address={application.url} />
        </p>
        {stepContext ? <p className="m-0 text-small text-ink-2">{stepContext}</p> : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="min-w-0 self-start overflow-x-auto rounded-md bg-paper-2">
          <table className="w-full border-collapse text-left text-small">
            <caption className="sr-only">What will be typed into the form, and where each value came from</caption>
            <thead className="text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Field</th>
                <th scope="col" className="px-3 py-2 font-semibold">Value</th>
                <th scope="col" className="px-3 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {application.fields.map((field) => (
                <tr key={field.fieldKey} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-2 font-semibold text-ink">{field.label || field.fieldKey}</th>
                  <td className="max-w-[22ch] break-words px-3 py-2 text-ink">{displayValue(field)}</td>
                  <td className="break-words px-3 py-2 text-ink-2">{sourceLabel(field)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {application.screenshot ? (
          <figure className="m-0 grid gap-2 self-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- base64 screenshot of the filled, unsubmitted form */}
            <img
              src={`data:image/png;base64,${application.screenshot}`}
              alt={`The ${host} form as filled in, not yet submitted`}
              className="h-auto max-h-[36rem] w-full rounded-md border border-line bg-card object-contain object-top"
              loading="lazy"
              width={640}
              height={800}
            />
            <figcaption className="text-small text-ink-2">Filled in a private browser. Not submitted.</figcaption>
          </figure>
        ) : null}
      </div>

      {application.missing.length > 0 ? (
        <div className="grid gap-2">
          <p className="m-0 font-semibold text-ink">Left blank for you</p>
          <ul className="m-0 grid gap-1 pl-5 text-small text-ink-2">
            {application.missing.map((m) => (
              <li key={m.fieldKey}>
                <span className="font-semibold text-ink">{m.label || m.fieldKey}</span>
                {m.required ? " (required)" : ""}: {m.question}
              </li>
            ))}
          </ul>
          {open.length > 0 ? (
            <p className="m-0 text-small text-ink-2">
              Required answers stay blank, so the form may ask for them. Health questions are never filled in for you.
            </p>
          ) : null}
        </div>
      ) : null}

      {errors ? (
        <div role="alert" className="flex gap-3 rounded-md border border-danger/30 bg-danger-soft p-4 text-body text-ink">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <ul className="m-0 grid list-none gap-1 pl-0">
            {errors.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {application.status === "submitted" ? (
        <p role="status" className="m-0 flex items-center gap-2 text-body text-ok">
          <CircleCheck aria-hidden className="size-5" /> Submitted {formatWhen(application.submittedAt)}.
        </p>
      ) : canApprove ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <Button onClick={() => setConfirming(true)}>Approve and submit this form</Button>
          <p className="m-0 text-small text-ink-2">Nothing is sent without your OK. The safety check runs first.</p>
        </div>
      ) : null}

      <Dialog open={confirming} onOpenChange={(next) => !next && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit this application?</DialogTitle>
            <DialogDescription>To {host}, exactly as listed above.</DialogDescription>
          </DialogHeader>
          <ul className="m-0 grid list-none gap-2 p-0 text-body text-ink-2">
            <li>Only the {application.fields.length} values in the table are typed in.</li>
            <li>A note says an AI helped prepare it.</li>
            <li>If the form changed since it was filled, nothing is submitted.</li>
          </ul>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>Go back</Button>
            </DialogClose>
            <Button loading={busy} loadingText="Submitting" onClick={() => void approve()}>
              Submit this form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
