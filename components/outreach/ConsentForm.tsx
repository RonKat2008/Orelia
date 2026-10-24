"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lock, Mail, PhoneCall } from "lucide-react";
import {
  AvatarInitials,
  Badge,
  Button,
  Card,
  CardEyebrow,
  CardTitle,
  Checkbox,
  ChoiceRow,
  toast,
} from "@/components/ui";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/threads/states";
import type { CaseInput } from "@/lib/contracts";
import {
  SHAREABLE_FIELDS,
  defaultSharedFields,
  sharedPreview,
  withheldLabels,
  type ShareableFieldKey,
} from "./fields";
import {
  contactLabel,
  loadCase,
  readSelectedCandidateIds,
  readStoredOutreach,
  saveContactConsent,
  selectOutreach,
  writeStoredOutreach,
  type ApiContact,
  type UnavailableContact,
} from "./client";
import { buildLetterPreview } from "./letter";
import { LetterSheet } from "./LetterSheet";

type Phase =
  | { kind: "loading" }
  | { kind: "nothing" }
  | { kind: "failed"; reasons: string[] }
  | { kind: "ready" };

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ConsentForm({ caseId }: { caseId: string }) {
  const [caseRecord, setCaseRecord] = useState<CaseInput | null>(null);
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableContact[]>([]);
  const [sharedByContact, setSharedByContact] = useState<Record<string, ShareableFieldKey[]>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const record = await loadCase(caseId);
      if (!active) return;
      setCaseRecord(record);
      const ids = readSelectedCandidateIds(caseId);
      if (ids.length === 0) {
        const stored = readStoredOutreach(caseId);
        if (!stored || stored.contacts.length === 0) {
          setPhase({ kind: "nothing" });
          return;
        }
        setContacts(stored.contacts);
        setUnavailable(stored.unavailable);
        setSharedByContact(Object.fromEntries(stored.contacts.map((contact) => [contact.id, defaultSharedFields()])));
        setPhase({ kind: "ready" });
        return;
      }
      const selected = await selectOutreach(caseId, ids);
      if (!active) return;
      if (!selected.ok) {
        setPhase({ kind: "failed", reasons: selected.reasons });
        return;
      }
      writeStoredOutreach(caseId, selected.value);
      setContacts(selected.value.contacts);
      setUnavailable(selected.value.unavailable);
      setSharedByContact(
        Object.fromEntries(selected.value.contacts.map((contact) => [contact.id, defaultSharedFields()])),
      );
      setPhase({ kind: "ready" });
    })();
    return () => {
      active = false;
    };
  }, [caseId, attempt]);

  const summary = useMemo(
    () =>
      contacts.map((contact) => {
        const shared = sharedByContact[contact.id] ?? [];
        return {
          contact,
          shared,
          preview: caseRecord ? sharedPreview(caseRecord, shared) : [],
          withheld: withheldLabels(shared),
        };
      }),
    [caseRecord, contacts, sharedByContact],
  );

  function toggle(contactId: string, key: ShareableFieldKey) {
    setSaved(false);
    setSharedByContact((current) => {
      const selected = current[contactId] ?? [];
      const next = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
      return { ...current, [contactId]: next };
    });
  }

  async function save() {
    setSaveErrors([]);
    setSaved(false);
    setSaving(true);
    const failures: string[] = [];
    for (const contact of contacts) {
      const result = await saveContactConsent(contact.id, sharedByContact[contact.id] ?? []);
      if (!result.ok) failures.push(`${titleCase(contactLabel(contact))}: ${result.reasons.join(" ")}`);
    }
    setSaving(false);
    if (failures.length > 0) {
      setSaveErrors(failures);
      toast.error("Your choices were not saved for everyone", { description: "Nothing was sent. You can try again." });
      return;
    }
    setSaved(true);
    toast.success("Your choices are saved", { description: "Next, read the drafts. Nothing is sent until you approve." });
  }

  if (phase.kind === "loading") return <LoadingSkeleton label="Loading your selected contacts" />;

  if (phase.kind === "nothing") {
    return (
      <EmptyState
        title="No one is selected yet"
        detail="Pick up to five resources on your shortlist. Then come back here to choose exactly what each one may see."
        actionHref={`/cases/${caseId}/shortlist`}
        actionLabel="Open the shortlist"
      />
    );
  }

  if (phase.kind === "failed") {
    return (
      <ErrorState
        title="Those resources could not be opened as contacts"
        detail={`${phase.reasons.join(" ")} Nothing was contacted.`}
        onRetry={() => {
          setPhase({ kind: "loading" });
          setAttempt((value) => value + 1);
        }}
        actionHref={`/cases/${caseId}/shortlist`}
        actionLabel="Back to the shortlist"
      />
    );
  }

  const totalShared = summary.reduce((count, item) => count + item.shared.length, 0);

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)] gap-10"
      aria-describedby="consent-note"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p id="consent-note" className="m-0 flex max-w-prose items-start gap-3 text-body text-ink-2 text-pretty">
        <Lock aria-hidden className="mt-1 size-5 shrink-0 text-teal" />
        Each contact gets its own choices. Changing one never changes another, and you can come back and change them
        before anything is approved.
      </p>

      {summary.map(({ contact, shared, preview, withheld }, index) => {
        const name = titleCase(contactLabel(contact));
        const ChannelIcon = contact.channel === "email" ? Mail : PhoneCall;
        const letter = buildLetterPreview(contact.channel, preview);
        return (
          <Card key={contact.id} variant="raised" padding="lg" data-contact-state={contact.state} aria-labelledby={`contact-${contact.id}`}>
            <div className="mb-8 flex flex-wrap items-center gap-4">
              <AvatarInitials name={name.replace(/[()]/g, "")} size="lg" />
              <div className="grid min-w-0 gap-1">
                <CardEyebrow>
                  Contact {index + 1} of {summary.length}
                </CardEyebrow>
                <CardTitle id={`contact-${contact.id}`} className="break-words">
                  {name}
                </CardTitle>
              </div>
            </div>

            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
              <div className="grid min-w-0 gap-8">
                <section aria-label="How they will be reached" className="grid gap-3">
                  <h4 className="m-0 text-micro font-semibold uppercase text-ink-3">How we will reach them</h4>
                  <p className="m-0 flex flex-wrap items-center gap-3 rounded-md bg-paper-2 px-4 py-3 shadow-inset">
                    <span className="flex min-w-0 items-center gap-3">
                      <ChannelIcon aria-hidden className="size-5 shrink-0 text-teal" />
                      <span className="min-w-0 break-words text-body font-semibold text-ink">
                        {contact.channel === "email" ? "Email" : "Phone call"} · {contact.address}
                      </span>
                    </span>
                    <Badge tone="sage">Only route found</Badge>
                  </p>
                  <p className="m-0 text-small text-ink-2">
                    This is the intake {contact.channel === "email" ? "email" : "number"} listed on their public page.
                    {contact.channel === "email"
                      ? " We will not phone them."
                      : " The call opens by saying an AI assistant is calling for you."}
                  </p>
                </section>

                <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
                  <legend className="mb-1 p-0 font-display text-h4 font-normal text-ink display-soft">
                    What may {name.toLowerCase()} see?
                  </legend>
                  <p className="m-0 text-small text-ink-2">Tick a detail to include it. Leave it blank to keep it private.</p>
                  <div className="grid gap-2">
                    {SHAREABLE_FIELDS.map((field) => {
                      const checked = shared.includes(field.key);
                      return (
                        <ChoiceRow
                          key={field.key}
                          title={field.label}
                          description={field.personal ? `More personal. ${field.hint}` : field.hint}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggle(contact.id, field.key)}
                            aria-label={`Share ${field.label} with ${name}`}
                          />
                        </ChoiceRow>
                      );
                    })}
                  </div>
                </fieldset>
              </div>

              <section aria-label={`Preview for ${name}`} className="grid min-w-0 content-start gap-4 lg:sticky lg:top-28 lg:self-start">
                <div className="grid gap-1">
                  <h4 className="m-0 text-micro font-semibold uppercase text-ink-3">What they would read</h4>
                  <p className="m-0 text-small text-ink-2">
                    Updates as you tick. The real draft is written after you save, and you approve it in the outbox.
                  </p>
                </div>
                {!caseRecord ? (
                  <p className="m-0 rounded-md bg-paper-2 p-4 text-small text-ink-2 shadow-inset">
                    Your case details did not load, so the preview is hidden. Your choices still save.
                  </p>
                ) : (
                  <LetterSheet
                    channel={contact.channel}
                    recipient={contact.address}
                    label={contact.channel === "email" ? "Preview of the email" : "Preview of the call"}
                    subject={contact.channel === "email" ? "Patient intake inquiry" : null}
                  >
                    {letter.opening ? <p className="m-0">{letter.opening}</p> : null}
                    {letter.lines.map((line) => (
                      <p key={line} className="m-0 break-words">
                        {line}
                      </p>
                    ))}
                    {letter.closing ? <p className="m-0">{letter.closing}</p> : null}
                  </LetterSheet>
                )}
                <p className="m-0 text-small text-ink-2" data-testid="withheld">
                  {withheld.length === 0 ? (
                    "Every detail is included."
                  ) : (
                    <>
                      <span className="font-semibold text-ink">Stays private:</span> {withheld.join(", ")}.
                    </>
                  )}
                </p>
              </section>
            </div>
          </Card>
        );
      })}

      {unavailable.map((item) => (
        <Card key={item.candidateId} variant="inset" data-channel="none">
          <h3 className="m-0 mb-2 font-display text-h4 font-normal text-ink display-soft">No way to reach this one</h3>
          <p className="m-0 max-w-prose text-body text-ink-2">
            This resource has no email or phone number we could verify, so there is nothing to send and no option to
            send it. {item.reason}
          </p>
        </Card>
      ))}

      {/*
        SLOT: "Follow-ups while you're away". The case-shell lane wires this to GET/PUT
        /api/cases/[id]/follow-up-plan (pre-approved day-3 and day-7 texts per contact).
        Intentionally inert until that API merges: do not call it from here yet.
      */}
      <section
        data-slot="follow-up-plan"
        aria-labelledby="follow-up-heading"
        className="grid gap-3 rounded-lg border border-dashed border-line-strong bg-paper-2/60 p-6 sm:p-9"
      >
        <h3 id="follow-up-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Follow-ups while you&apos;re away
        </h3>
        <p className="m-0 max-w-prose text-body text-ink-2">
          Soon you will be able to read and approve the exact follow-up messages for business days 3 and 7 here, so
          nothing is sent that you have not seen. Until then, every follow-up waits for your approval in the outbox.
        </p>
      </section>

      <section aria-labelledby="summary-heading" className="grid gap-5 rounded-lg border border-line bg-sage-soft/60 p-6 sm:p-9">
        <h3 id="summary-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Your choices at a glance
        </h3>
        <ul className="m-0 grid list-none gap-4 p-0">
          {summary.map(({ contact, shared, withheld }) => (
            <li key={contact.id} className="grid gap-1 border-t border-line-strong pt-4 first:border-t-0 first:pt-0">
              <span className="break-words font-semibold text-ink">{titleCase(contactLabel(contact))}</span>
              <span className="text-body text-ink-2">
                {shared.length === 0
                  ? "Sees no case details."
                  : `Sees ${SHAREABLE_FIELDS.filter((field) => shared.includes(field.key))
                      .map((field) => field.label.toLowerCase())
                      .join(", ")}.`}{" "}
                {withheld.length > 0 ? `${withheld.length} stay private.` : "Nothing is held back."}
              </span>
            </li>
          ))}
        </ul>
        {saveErrors.length > 0 ? (
          <ErrorState title="Your choices were not saved for everyone" detail={saveErrors.join(" ")} />
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant={saved ? "secondary" : "primary"}
            loading={saving}
            loadingText="Saving"
            disabled={contacts.length === 0}
          >
            {saved ? "Saved. Save again" : "Save my choices"}
          </Button>
          {saved ? (
            <Button asChild>
              <Link href={`/cases/${caseId}/outbox`}>
                Review the drafts <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
          <span role="status" className="text-small text-ink-2">
            {saved
              ? "Saved on the server for each contact."
              : `Sharing ${totalShared} detail${totalShared === 1 ? "" : "s"} across ${contacts.length} contact${contacts.length === 1 ? "" : "s"}. Nothing is sent.`}
          </span>
        </div>
      </section>
    </form>
  );
}
