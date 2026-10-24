"use client";

import { DemoCoordinatorBadge, demoDestinationLabel, useDemoDestinations } from "@/components/outreach/DemoCoordinators";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, CircleDashed, FileText, Mail, PhoneCall, TriangleAlert } from "lucide-react";
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
  EmptyState,
  JudgeOnly,
  List,
  ListRow,
  LoadingState,
  Skeleton,
  TwoPane,
  toast,
} from "@/components/ui";
import { hasDisclosure } from "@/lib/safety/disclosure";
import type { CaseInput } from "@/lib/contracts";
import { SHAREABLE_FIELDS, fieldValue, type ShareableFieldKey } from "./fields";
import {
  REFUSAL_LABELS,
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
import { ApplicationCard, STATUS_COPY, hostOf } from "./ApplicationCard";
import { loadApplications, type ApiApplication } from "./applications";
import { getPlan } from "@/components/plan/client";
import { applicationStepContext, draftStepContext, stepContextText } from "@/components/plan/model";
import type { ContactPlan } from "@/lib/plan/contract";
import { isDemoFormUrl } from "@/lib/outreach/demo-destinations-shared";
import { cn } from "@/lib/ui/cn";

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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
      <LoadingState label="Loading drafts">
        <Skeleton className="h-64 w-full rounded-lg" />
      </LoadingState>
    );
  }

  if (phase === "empty") {
    return (
      <EmptyState
        titleAs="h3"
        title="No drafts yet"
        description="Drafts are written after you choose who to contact and what they may see."
        action={
          <Button asChild>
            <Link href={`/cases/${caseId}/consent`}>Choose what to share</Link>
          </Button>
        }
      />
    );
  }

  const waiting =
    rows.filter((row) => row.draft && !row.approvedAt && !row.held).length +
    applications.filter((app) => app.status === "draft").length;
  const blockedCount = rows.filter((row) => !row.draft).length;
  const replaceApplication = (next: ApiApplication) =>
    setApplications((current) => current.map((app) => (app.id === next.id ? next : app)));

  const keys = [
    ...applications.map((app) => `app:${app.id}`),
    ...rows.map((row) => `draft:${row.contact.id}`),
  ];
  const firstWaiting =
    applications.find((app) => app.status === "draft")?.id ?? rows.find((row) => row.draft && !row.approvedAt)?.contact.id;
  const fallbackKey = firstWaiting
    ? applications.some((app) => app.id === firstWaiting)
      ? `app:${firstWaiting}`
      : `draft:${firstWaiting}`
    : keys[0];
  const activeKey = selectedKey && keys.includes(selectedKey) ? selectedKey : fallbackKey;
  const select = (key: string) => {
    setSelectedKey(key);
    setDetailOpen(true);
  };

  const selectedApp = activeKey?.startsWith("app:") ? applications.find((app) => `app:${app.id}` === activeKey) : undefined;
  const selectedRow = activeKey?.startsWith("draft:") ? rows.find((row) => `draft:${row.contact.id}` === activeKey) : undefined;

  const statusLine = pending
    ? `Writing drafts: ${pending.done} of ${pending.total} ready.`
    : waiting > 0
      ? `${waiting} ${waiting === 1 ? "draft is" : "drafts are"} waiting for you. Nothing has been sent.`
      : blockedCount > 0
        ? `${blockedCount} ${blockedCount === 1 ? "draft needs" : "drafts need"} one more answer first.`
        : "Nothing is waiting for your approval.";

  let detail: ReactNode = null;
  let detailTitle: string | undefined;
  if (selectedApp) {
    const ctx = applicationStepContext(plan, selectedApp);
    detailTitle = "Review application";
    detail = (
      <ApplicationCard
        key={selectedApp.id}
        caseId={caseId}
        application={selectedApp}
        stepContext={ctx ? stepContextText(ctx) : null}
        onChange={replaceApplication}
      />
    );
  } else if (selectedRow) {
    detailTitle = titleCase(contactLabel(selectedRow.contact));
    detail = (
      <DraftDetail
        key={selectedRow.contact.id}
        caseId={caseId}
        row={selectedRow}
        caseRecord={caseRecord}
        docTitles={docTitles}
        plan={plan}
        onHold={() => patch(selectedRow.contact.id, { held: !selectedRow.held })}
        onApprove={() => setConfirming(selectedRow.contact.id)}
      />
    );
  }

  const confirmRow = rows.find((row) => row.contact.id === confirming && row.draft);
  const confirmDraft = confirmRow?.draft ?? null;
  const confirmKeys = (confirmDraft?.sharedFields ?? []) as ShareableFieldKey[];
  const confirmEmail = (confirmDraft?.channel ?? confirmRow?.contact.channel) === "email";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <p role="status" aria-live="polite" className="m-0 text-body text-ink-2">
        {statusLine}
      </p>
      <TwoPane
        listLabel="Drafts"
        detailLabel="Selected draft"
        list={
          keys.length === 0 ? (
            <p className="m-0 text-small text-ink-2">Drafts show here as they are written.</p>
          ) : (
            <List>
              {applications.map((app) => (
                <ListRow
                  key={app.id}
                  data-channel="web_form"
                  title={isDemoFormUrl(app.url) ? "Wayfinder demo intake form" : hostOf(app.url)}
                  meta="Online form · review application"
                  leading={<FileText aria-hidden className="text-ch-apply" />}
                  badges={[
                    <Badge key="s" tone={STATUS_COPY[app.status].tone}>
                      {app.status === "submitted" ? <CircleCheck aria-hidden /> : null}
                      {STATUS_COPY[app.status].label}
                    </Badge>,
                    <DemoCoordinatorBadge key="d" address={app.url} />,
                  ]}
                  onSelect={() => select(`app:${app.id}`)}
                  selected={activeKey === `app:${app.id}`}
                />
              ))}
              {rows.map((row) => (
                <DraftRow
                  key={row.contact.id}
                  row={row}
                  selected={activeKey === `draft:${row.contact.id}`}
                  onSelect={() => select(`draft:${row.contact.id}`)}
                />
              ))}
            </List>
          )
        }
        detail={detail}
        emptyDetail={
          <EmptyState titleAs="h3" title="Drafts will show here" description="We are writing them now." className="border-0 bg-transparent px-0 py-0" />
        }
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        detailTitle={detailTitle}
      />

      {confirmRow && confirmDraft ? (
        <Dialog open onOpenChange={(open) => !open && setConfirming(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmEmail ? "Send this email?" : "Approve this call?"}</DialogTitle>
              <DialogDescription>
                {confirmEmail ? `To ${confirmDraft.address}` : `A call to ${confirmDraft.address}`}, as written.{" "}
                <DemoCoordinatorBadge address={confirmDraft.address} />
              </DialogDescription>
            </DialogHeader>
            <ul className="m-0 grid list-none gap-2 p-0 text-body text-ink-2">
              <li>
                Shares only:{" "}
                <span className="font-semibold text-ink">
                  {confirmKeys.length === 0 ? "no case details" : sharedLabels(confirmKeys).join(", ")}
                </span>
                .
              </li>
              <li>{confirmEmail ? "It says an AI helped prepare it." : "The call opens by saying an AI assistant is calling for you."}</li>
              <li>It goes through the safety check first, and may still be refused.</li>
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={approvingId === confirmRow.contact.id}>
                  Go back
                </Button>
              </DialogClose>
              <Button loading={approvingId === confirmRow.contact.id} loadingText="Approving" onClick={() => void approve(confirmRow)}>
                {confirmEmail ? "Send this email" : "Approve this call"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

const CONSENT_REQUIRED = REFUSAL_LABELS.consent_required;

/** A draft that could not be written because no consent is saved yet: a missing answer, not an error. */
function needsConsent(row: Row): boolean {
  return !row.draft && (row.error ?? []).some((reason) => reason === CONSENT_REQUIRED);
}

function rowStatus(row: Row): { label: string; tone: "ok" | "neutral" | "teal" | "danger" | "outline"; icon: ReactNode } {
  if (row.approvedAt) return { label: "Approved", tone: "ok", icon: <CircleCheck aria-hidden /> };
  if (row.held) return { label: "On hold", tone: "neutral", icon: null };
  if (row.draft && row.error) return { label: "Refused", tone: "danger", icon: <TriangleAlert aria-hidden /> };
  if (row.draft) return { label: "Waiting for you", tone: "teal", icon: null };
  return { label: needsConsent(row) ? "Needs an answer" : "No new draft", tone: "outline", icon: <CircleDashed aria-hidden /> };
}

function DraftRow({ row, selected, onSelect }: { row: Row; selected: boolean; onSelect: () => void }) {
  const channel = row.draft?.channel ?? row.contact.channel;
  const isEmail = channel === "email";
  const followUp = followUpLabel(row.draft?.classification);
  const status = rowStatus(row);
  const Icon = isEmail ? Mail : PhoneCall;
  return (
    <ListRow
      data-channel={channel}
      data-approved={row.approvedAt ? "true" : "false"}
      title={titleCase(contactLabel(row.contact))}
      meta={
        <>
          <span className="[overflow-wrap:anywhere]">
            {[followUp, isEmail ? "Email" : "Call", row.draft?.address ?? row.contact.address].filter(Boolean).join(" · ")}
          </span>
          {!row.draft && needsConsent(row) ? (
            <JudgeOnly>
              <span className="block">Draft blocked: no consented fields</span>
            </JudgeOnly>
          ) : null}
        </>
      }
      leading={<Icon aria-hidden className={isEmail ? "text-ch-email" : "text-ch-call"} />}
      badges={[
        <Badge key="s" tone={status.tone}>
          {status.icon}
          {status.label}
        </Badge>,
        <DemoCoordinatorBadge key="d" address={row.draft?.address ?? row.contact.address} />,
      ]}
      onSelect={onSelect}
      selected={selected}
    />
  );
}

interface DraftDetailProps {
  caseId: string;
  row: Row;
  caseRecord: CaseInput | null;
  docTitles: Record<string, string>;
  plan: ContactPlan | null;
  onHold: () => void;
  onApprove: () => void;
}

/** The selected draft: letter in a well, the gate checks as a quiet checklist, and the one approve button. */
function DraftDetail({ caseId, row, caseRecord, docTitles, plan, onHold, onApprove }: DraftDetailProps) {
  const draft = row.draft;
  const name = titleCase(contactLabel(row.contact));
  const text = draft?.body ?? "";
  const keys = (draft?.sharedFields ?? []) as ShareableFieldKey[];
  const values = caseRecord ? keys.map((key) => fieldValue(caseRecord, key)) : [];
  const disclosed = text.length > 0 && hasDisclosure(text);
  const isEmail = (draft?.channel ?? row.contact.channel) === "email";
  const approved = Boolean(row.approvedAt);
  const followUp = followUpLabel(draft?.classification);
  const docIds = draft?.contextDocIds ?? [];
  const blocked = !draft || !disclosed || approved || row.held;
  const stepCtx = draftStepContext(plan, { contactId: row.contact.id, channel: draft?.channel ?? row.contact.channel });
  const demoLabel = demoDestinationLabel(draft?.address ?? row.contact.address, useDemoDestinations());

  const header = (
    <div className="grid gap-1">
      <h3 id={`draft-${row.contact.id}`} className="m-0 break-words font-display text-h3 font-normal text-ink display-soft">
        {name}
      </h3>
      <p className="m-0 text-small text-ink-2">
        {followUp ? `${followUp}, ${isEmail ? "email" : "call"}` : isEmail ? "Email draft" : "Call script"}
        {stepCtx ? <span data-plan-step> · {stepContextText(stepCtx)}</span> : null}
      </p>
    </div>
  );

  if (!draft) {
    const consent = needsConsent(row);
    return (
      <div className="grid min-w-0 gap-6" aria-labelledby={`draft-${row.contact.id}`} role="group">
        {header}
        {consent ? (
          <EmptyState
            titleAs="h4"
            title="We need one more answer first"
            description={`Tell us what ${name} may see, then we'll write the ${isEmail ? "email" : "call script"}.`}
            action={
              <Button asChild>
                <Link href={`/cases/${caseId}/consent`}>Choose what to share</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            titleAs="h4"
            title="No new draft for this contact"
            description={(row.error ?? ["No draft."]).join(" ")}
          />
        )}
        {consent ? (
          <JudgeOnly>
            <p className="m-0 text-small text-ink-2">Draft blocked: no consented fields. {(row.error ?? []).join(" ")}</p>
          </JudgeOnly>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
      data-channel={draft.channel}
      data-approved={approved ? "true" : "false"}
      aria-labelledby={`draft-${row.contact.id}`}
      role="group"
    >
      {header}
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

      <section aria-label="Safety checks" className="grid gap-2">
        <h4 className="m-0 text-body font-semibold text-ink">Before it goes</h4>
        <ul className="m-0 grid list-none gap-2 p-0 text-small text-ink-2">
          <JudgeOnly
            fallback={
              <CheckItem ok>
                Shares only: {keys.length === 0 ? "no case details, just the request" : sharedLabels(keys).join(", ")}.
              </CheckItem>
            }
          >
            <CheckItem ok>
              {demoLabel ? "Test inbox: delivery goes to our own test destination." : "Allowlist checked again when you approve."}
            </CheckItem>
            <CheckItem ok>
              Ticked fields only: {keys.length === 0 ? "no case details, just the request" : sharedLabels(keys).join(", ")}.
            </CheckItem>
          </JudgeOnly>
          <CheckItem ok={disclosed}>
            {disclosed ? "Says an AI helped write it." : "Missing the line saying an AI helped. It cannot be approved yet."}
          </CheckItem>
          <CheckItem ok>
            Documents used:{" "}
            {docIds.length === 0 ? "none, written from your ticked details only" : docIds.map((id) => docTitles[id] ?? "Case document").join(", ")}.
          </CheckItem>
        </ul>
      </section>

      {row.error ? (
        <div role="alert" className="flex gap-3 rounded-md border border-danger/30 bg-danger-soft p-4 text-body text-ink">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="grid min-w-0 gap-1">
            <p className="m-0 font-semibold">The safety check refused this draft. Nothing was approved or sent.</p>
            <ul className="m-0 grid gap-1 pl-5">
              {row.error.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {approved ? (
        <p role="status" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ok">
          <CircleCheck aria-hidden className="size-5" />
          Approved {formatWhen(row.approvedAt)}.
          <Link href={`/cases/${caseId}/tracker`} className="font-semibold text-teal underline underline-offset-4 focus-ring">
            Follow it in the tracker
          </Link>
        </p>
      ) : (
        <div className="grid gap-3 border-t border-line pt-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button disabled={blocked} onClick={onApprove}>
              {isEmail ? "Approve this email" : "Approve this call"}
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/cases/${caseId}/consent`}>Change what it shares</Link>
            </Button>
            <Button variant="link" onClick={onHold}>
              {row.held ? "Resume this draft" : "Hold this draft"}
            </Button>
          </div>
          <p className="m-0 text-small text-ink-2">Nothing is sent without your OK.</p>
        </div>
      )}
    </div>
  );
}

function CheckItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <li className="flex items-start gap-2">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", ok ? "text-ok" : "text-warn-ink")} />
      <span className="min-w-0 break-words">
        <span className="sr-only">{ok ? "Passed: " : "Not passed: "}</span>
        {children}
      </span>
    </li>
  );
}
