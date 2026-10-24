"use client";

import { DemoCoordinatorBadge, demoDestinationLabel, useDemoDestinations } from "@/components/outreach/DemoCoordinators";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, FileText, Pause, Pencil, Play, Send, TriangleAlert } from "lucide-react";
import {
  AvatarInitials,
  Badge,
  Button,
  Card,
  CardEyebrow,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from "@/components/ui";
import { hasDisclosure } from "@/lib/safety/disclosure";
import type { CaseInput } from "@/lib/contracts";
import { EmptyState } from "@/components/threads/states";
import { SHAREABLE_FIELDS, fieldValue, type ShareableFieldKey } from "./fields";
import {
  approveContactDraft,
  contactLabel,
  createContactDraft,
  loadCase,
  loadDocumentTitles,
  readStoredOutreach,
  type ApiContact,
  type ApiDraft,
} from "./client";
import { loadCaseContacts } from "./case-activity";
import { followUpLabel, formatWhen, titleCase } from "./format";
import { LetterSheet, MessageBody } from "./LetterSheet";
import { ApplicationCard } from "./ApplicationCard";
import { loadApplications, type ApiApplication } from "./applications";
import { getPlan } from "@/components/plan/client";
import { applicationStepContext, draftStepContext, stepContextText } from "@/components/plan/model";
import type { ContactPlan } from "@/lib/plan/contract";

type Row = {
  contact: ApiContact;
  draft: ApiDraft | null;
  approvedAt: string | null;
  sentAt: string | null;
  error: string[] | null;
  held: boolean;
};

type Phase = "loading" | "empty" | "ready";

function sharedLabels(keys: readonly string[]): string[] {
  return keys.map((key) => SHAREABLE_FIELDS.find((field) => field.key === key)?.label ?? key.replaceAll("_", " "));
}

export function OutboxList({ caseId }: { caseId: string }) {
  const demo = useDemoDestinations();
  const [caseRecord, setCaseRecord] = useState<CaseInput | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [docTitles, setDocTitles] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("loading");
  const [pending, setPending] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContactPlan | null>(null);
  const [applications, setApplications] = useState<ApiApplication[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = readStoredOutreach(caseId);
      const live = await loadCaseContacts(caseId);
      const [record, titles, planResult, apps] = await Promise.all([
        loadCase(caseId),
        loadDocumentTitles(caseId),
        getPlan(caseId),
        loadApplications(caseId),
      ]);
      if (!active) return;
      setCaseRecord(record);
      setDocTitles(titles);
      setPlan(planResult.ok ? planResult.plan : null);
      setApplications(apps);
      const people = live && live.length > 0 ? live : stored?.contacts ?? [];
      if (people.length === 0 && apps.length === 0) {
        setPhase("empty");
        return;
      }
      setPhase("ready");
      setPending({ done: 0, total: people.length });
      for (const [index, contact] of people.entries()) {
        const created = await createContactDraft(contact.id);
        if (!active) return;
        const row: Row = {
          contact,
          draft: created.ok ? created.draft : null,
          approvedAt: created.ok && typeof created.draft.approvedAt === "string" ? created.draft.approvedAt : null,
          sentAt: created.ok && typeof created.draft.sentAt === "string" ? created.draft.sentAt : null,
          error: created.ok ? null : created.reasons,
          held: false,
        };
        setRows((current) => [...current, row]);
        setPending({ done: index + 1, total: people.length });
      }
      setPending(null);
    })();
    return () => {
      active = false;
    };
  }, [caseId]);

  function patch(contactId: string, change: Partial<Row>) {
    setRows((current) => current.map((entry) => (entry.contact.id === contactId ? { ...entry, ...change } : entry)));
  }

  async function approve(row: Row) {
    if (!row.draft) return;
    setApprovingId(row.contact.id);
    const result = await approveContactDraft(row.contact.id, row.draft.id);
    setApprovingId(null);
    if (!result.ok) {
      patch(row.contact.id, { approvedAt: null, error: result.reasons });
      setConfirming(null);
      toast.error("The safety check refused this draft", { description: "Nothing was marked approved and nothing was sent." });
      return;
    }
    patch(row.contact.id, { approvedAt: result.approvedAt, sentAt: result.sentAt, error: null });
    setConfirming(null);
    const demoNote = demoDestinationLabel(row.contact.address, demo);
    const isFollowUp = followUpLabel(row.draft.classification) !== null;
    toast.success(isFollowUp ? (result.sentAt ? "Follow-up sent" : "Follow-up approved") : row.contact.channel === "email" ? "Email approved" : "Call approved", {
      description: demoNote
        ? `${demoNote}. The safety check ran as usual; follow it in the tracker.`
        : "The server confirmed your approval. You can follow it in the tracker.",
    });
  }

  if (phase === "loading") {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="grid gap-6">
        <span className="sr-only">Loading drafts</span>
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <EmptyState
        title="No drafts yet"
        detail="Drafts are written after you choose who to contact and what they may see. Start with consent."
        actionHref={`/cases/${caseId}/consent`}
        actionLabel="Open consent"
      />
    );
  }

  const waiting =
    rows.filter((row) => row.draft && !row.approvedAt && !row.held).length +
    applications.filter((app) => app.status === "draft").length;
  const replaceApplication = (next: ApiApplication) =>
    setApplications((current) => current.map((app) => (app.id === next.id ? next : app)));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <p role="status" aria-live="polite" className="m-0 text-body text-ink-2">
        {pending
          ? `Writing drafts: ${pending.done} of ${pending.total} ready.`
          : waiting > 0
            ? `${waiting} ${waiting === 1 ? "draft is" : "drafts are"} waiting for you. Nothing has been sent.`
            : "Nothing is waiting for your approval."}
      </p>
      {applications.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-10 p-0" aria-label="Online applications">
          {applications.map((app) => {
            const ctx = applicationStepContext(plan, app);
            return (
              <li key={app.id}>
                <ApplicationCard
                  caseId={caseId}
                  application={app}
                  stepContext={ctx ? stepContextText(ctx) : null}
                  onChange={replaceApplication}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-10 p-0">
        {rows.map((row) => {
          const draft = row.draft;
          const text = draft?.body ?? "";
          const keys = (draft?.sharedFields ?? []) as ShareableFieldKey[];
          const values = caseRecord ? keys.map((key) => fieldValue(caseRecord, key)) : [];
          const disclosed = text.length > 0 && hasDisclosure(text);
          const name = titleCase(contactLabel(row.contact));
          const isEmail = (draft?.channel ?? row.contact.channel) === "email";
          const approved = Boolean(row.approvedAt);
          const followUp = followUpLabel(draft?.classification);
          const docIds = draft?.contextDocIds ?? [];
          const blocked = !draft || !disclosed || approved || row.held;
          const stepCtx = draftStepContext(plan, { contactId: row.contact.id, channel: draft?.channel ?? row.contact.channel });
          return (
            <li key={row.contact.id}>
              <Card
                variant="raised"
                padding="lg"
                data-channel={draft?.channel ?? row.contact.channel}
                data-approved={approved ? "true" : "false"}
                aria-labelledby={`draft-${row.contact.id}`}
              >
                <div className="mb-6 flex flex-wrap items-center gap-4">
                  <AvatarInitials name={name.replace(/[()]/g, "")} size="lg" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <CardEyebrow>{followUp ? `${followUp}, ${isEmail ? "email" : "call"}` : isEmail ? "Email draft" : "Call script"}</CardEyebrow>
                    <CardTitle id={`draft-${row.contact.id}`} className="break-words">
                      {name}
                    </CardTitle>
                    {draft ? (
                      <span>
                        <DemoCoordinatorBadge address={draft.address} />
                      </span>
                    ) : null}
                  </div>
                  <span className="basis-full sm:basis-auto">
                    {approved ? (
                      <Badge tone="ok" size="md">
                        <CircleCheck aria-hidden /> Approved
                      </Badge>
                    ) : row.held ? (
                      <Badge tone="neutral" size="md">
                        <Pause aria-hidden /> On hold
                      </Badge>
                    ) : draft ? (
                      <Badge tone="gold" size="md" dot>
                        Waiting for you
                      </Badge>
                    ) : (
                      <Badge tone="danger" size="md">
                        No draft
                      </Badge>
                    )}
                  </span>
                </div>

                {stepCtx ? (
                  <p className="m-0 -mt-2 mb-6 text-small font-semibold text-teal" data-plan-step>
                    {stepContextText(stepCtx)}
                  </p>
                ) : null}

                {draft ? (
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
                    <LetterSheet
                      channel={draft.channel}
                      recipient={draft.address}
                      subject={draft.channel === "email" ? draft.subject : null}
                      label={
                        followUp
                          ? `${followUp}, ${approved ? (row.sentAt ? "sent" : "approved") : "not yet sent"}`
                          : approved ? (isEmail ? "Email, approved" : "Call script, approved") : isEmail ? "Email, not yet sent" : "Call script, not yet used"
                      }
                      className={row.held ? "opacity-70" : undefined}
                    >
                      <MessageBody text={text} sharedValues={values} />
                    </LetterSheet>

                    {!disclosed ? (
                      <p role="alert" className="m-0 flex gap-3 rounded-md border border-warn/40 bg-warn-soft p-4 text-body text-warn-ink">
                        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
                        This draft is missing the sentence saying an AI helped. It cannot be approved until it is there.
                      </p>
                    ) : null}

                    <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <dt className="text-micro font-semibold uppercase text-ink-3">Details shared</dt>
                        <dd className="m-0 flex min-w-0 flex-wrap gap-2">
                          {keys.length === 0 ? (
                            <span className="text-small text-ink-2">No case details. Just the request.</span>
                          ) : (
                            sharedLabels(keys).map((label) => (
                              <Badge key={label} tone="sage" size="md">
                                {label}
                              </Badge>
                            ))
                          )}
                        </dd>
                      </div>
                      <div className="grid gap-2">
                        <dt className="text-micro font-semibold uppercase text-ink-3">Documents used</dt>
                        <dd className="m-0 flex min-w-0 flex-wrap gap-2">
                          {docIds.length === 0 ? (
                            <span className="text-small text-ink-2">None. Written from your ticked details only.</span>
                          ) : (
                            docIds.map((id) => (
                              <Badge key={id} tone="outline" size="md" className="min-w-0 max-w-full">
                                <FileText aria-hidden />
                                <span className="truncate">{docTitles[id] ?? "Case document"}</span>
                              </Badge>
                            ))
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-4 text-body text-ink">
                    <p className="m-0 font-semibold">This draft could not be written.</p>
                    <ul className="m-0 mt-2 grid gap-1 pl-5">
                      {(row.error ?? ["No draft."]).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {row.error && draft ? (
                  <div role="alert" className="mt-6 rounded-md border border-danger/30 bg-danger-soft p-4 text-body text-ink">
                    <p className="m-0 font-semibold">The safety check refused this draft. Nothing was approved or sent.</p>
                    <ul className="m-0 mt-2 grid gap-1 pl-5">
                      {row.error.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {approved ? (
                  <p role="status" className="m-0 mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ok">
                    <CircleCheck aria-hidden className="size-5" />
                    Approved {formatWhen(row.approvedAt)}.
                    <Link href={`/cases/${caseId}/tracker`} className="font-semibold text-teal underline underline-offset-4 focus-ring">
                      Follow it in the tracker
                    </Link>
                  </p>
                ) : draft ? (
                  <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-6">
                    <Button disabled={blocked} onClick={() => setConfirming(row.contact.id)}>
                      <Send aria-hidden /> Approve &amp; send
                    </Button>
                    <Button asChild variant="secondary">
                      <Link href={`/cases/${caseId}/consent`}>
                        <Pencil aria-hidden /> Change what it shares
                      </Link>
                    </Button>
                    <Button variant="ghost" onClick={() => patch(row.contact.id, { held: !row.held })}>
                      {row.held ? <Play aria-hidden /> : <Pause aria-hidden />}
                      {row.held ? "Resume" : "Hold"}
                    </Button>
                  </div>
                ) : null}
              </Card>

              {draft ? (
                <Dialog open={confirming === row.contact.id} onOpenChange={(open) => !open && setConfirming(null)}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{isEmail ? "Send this email?" : "Approve this call?"}</DialogTitle>
                      <DialogDescription>
                        {isEmail ? `To ${draft.address}` : `A call to ${draft.address}`}, as written above.{" "}
                        <DemoCoordinatorBadge address={draft.address} />
                      </DialogDescription>
                    </DialogHeader>
                    <ul className="m-0 grid list-none gap-2 p-0 text-body text-ink-2">
                      <li>
                        Shares only: <span className="font-semibold text-ink">{keys.length === 0 ? "no case details" : sharedLabels(keys).join(", ")}</span>.
                      </li>
                      <li>{isEmail ? "It says an AI helped prepare it." : "The call opens by saying an AI assistant is calling for you."}</li>
                      <li>It goes through the safety check first, and may still be refused.</li>
                    </ul>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="ghost" disabled={approvingId === row.contact.id}>
                          Go back
                        </Button>
                      </DialogClose>
                      <Button loading={approvingId === row.contact.id} loadingText="Approving" onClick={() => void approve(row)}>
                        Approve &amp; send
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
