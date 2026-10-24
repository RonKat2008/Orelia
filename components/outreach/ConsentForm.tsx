"use client";

import { DemoCoordinatorBadge, demoDestinationLabel, useDemoDestinations } from "@/components/outreach/DemoCoordinators";
import { DEMO_LABELS } from "@/lib/outreach/demo-destinations-shared";
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
  loadFollowUpPlan,
  readSelectedCandidateIds,
  readStoredOutreach,
  saveContactConsent,
  saveFollowUpChoice,
  selectOutreach,
  writeStoredOutreach,
  type ApiContact,
  type FollowUpMessage,
  type UnavailableContact,
} from "./client";
import { loadCaseContacts, loadShortlistNames, withDisplayNames } from "./case-activity";
import { properName } from "./format";
import { buildLetterPreview } from "./letter";
import { LetterSheet } from "./LetterSheet";
import { cn } from "@/lib/ui/cn";

type Phase =
  | { kind: "loading" }
  | { kind: "nothing" }
  | { kind: "failed"; reasons: string[] }
  | { kind: "ready" };

export function ConsentForm({ caseId }: { caseId: string }) {
  const [caseRecord, setCaseRecord] = useState<CaseInput | null>(null);
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableContact[]>([]);
  const [sharedByContact, setSharedByContact] = useState<Record<string, ShareableFieldKey[]>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [consentSavedAt, setConsentSavedAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [followUps, setFollowUps] = useState<FollowUpMessage[] | null>(null);
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const record = await loadCase(caseId);
      if (!active) return;
      setCaseRecord(record);
      const ids = readSelectedCandidateIds(caseId);
      const plan = await loadFollowUpPlan(caseId);
      if (active) setFollowUps(plan);
      if (ids.length === 0) {
        const stored = readStoredOutreach(caseId);
        const live = await loadCaseContacts(caseId);
        const people = live && live.length > 0 ? live : stored?.contacts ?? [];
        if (people.length === 0) {
          setPhase({ kind: "nothing" });
          return;
        }
        setContacts(people);
        setUnavailable(stored?.unavailable ?? []);
        setSharedByContact(Object.fromEntries(people.map((contact) => [contact.id, defaultSharedFields()])));
        setPhase({ kind: "ready" });
        return;
      }
      const selected = await selectOutreach(caseId, ids);
      if (!active) return;
      if (!selected.ok) {
        setPhase({ kind: "failed", reasons: selected.reasons });
        return;
      }
      // The select response has no names; fill them so every screen can say who is who.
      const [live, names] = await Promise.all([loadCaseContacts(caseId), loadShortlistNames(caseId)]);
      if (!active) return;
      const named = {
        contacts: withDisplayNames(selected.value.contacts, live),
        unavailable: selected.value.unavailable.map((item) =>
          names.has(item.candidateId) ? { ...item, name: names.get(item.candidateId) } : item,
        ),
      };
      writeStoredOutreach(caseId, named);
      setContacts(named.contacts);
      setUnavailable(named.unavailable);
      setSharedByContact(
        Object.fromEntries(named.contacts.map((contact) => [contact.id, defaultSharedFields()])),
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
      if (!result.ok) failures.push(`${properName(contactLabel(contact))}: ${result.reasons.join(" ")}`);
    }
    setSaving(false);
    if (failures.length > 0) {
      setSaveErrors(failures);
      toast.error("Your choices were not saved for everyone", { description: "Nothing was sent. You can try again." });
      return;
    }
    setSaved(true);
    setConsentSavedAt(new Date().toISOString());
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
        const name = properName(contactLabel(contact));
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
                      <ChannelIcon aria-hidden className={cn("size-5 shrink-0", contact.channel === "email" ? "text-ch-email" : "text-ch-call")} />
                      <span className="min-w-0 break-words text-body font-semibold text-ink">
                        {contact.channel === "email" ? "Email" : "Phone call"} · {contact.address}
                      </span>
                    </span>
                    <Badge tone="sage">Only route found</Badge>
                    <DemoCoordinatorBadge address={contact.address} />
                  </p>
                  <ReachedNote channel={contact.channel} address={contact.address} />
                </section>

                <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
                  <legend className="mb-1 p-0 font-display text-h4 font-normal text-ink display-soft">
                    What may {name} see?
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
        <Card key={item.candidateId} variant="inset" data-channel={item.route === "web_form" ? "web_form" : "none"}>
          <h3 className="m-0 mb-2 font-display text-h4 font-normal text-ink display-soft">
            {item.route === "web_form"
              ? item.name ? <>{item.name} has an online form</> : "This one has an online form"
              : item.name ? <>No way to reach {item.name}</> : "No way to reach this one"}
          </h3>
          <p className="m-0 max-w-prose text-body text-ink-2">
            {item.route === "web_form"
              ? "We found an online intake form for this resource, but no email or phone number. Nothing is sent from this step; the form is filled in for your review in the plan. "
              : "This resource has no email or phone number we could verify, so there is nothing to send and no option to send it. "}
            {item.route === "web_form" ? null : item.reason}
          </p>
        </Card>
      ))}

      <section
        data-slot="follow-up-plan"
        aria-labelledby="follow-up-heading"
        className="grid gap-4 rounded-lg border border-line bg-paper-2/60 p-6 sm:p-9"
      >
        <h3 id="follow-up-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Follow-ups while you&apos;re away
        </h3>
        <p className="m-0 max-w-prose text-body text-ink-2">
          Business day 3 and day 7 messages are saved here only after you approve the exact text. Nothing in this
          section is sent on its own.
        </p>
        {followUps === null ? (
          <p role="status" className="m-0 text-small text-ink-2">Follow-up messages could not be loaded.</p>
        ) : followUps.length === 0 ? (
          <p className="m-0 text-small text-ink-2">No follow-up text is approved yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {followUps.map((item) => (
              <li key={item.messageId} className="grid gap-1 rounded-md border border-line bg-card p-4">
                <span className="text-micro font-semibold uppercase text-ink-3">
                  {item.classification.replaceAll("_", " ")} · {item.approvedAt ? "Approved" : "Not approved"}
                </span>
                <p className="m-0 whitespace-pre-wrap text-small text-ink">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
        {contacts.length > 0 && caseRecord && !consentSavedAt ? (
          <p className="m-0 text-small text-ink-2">Save your choices above, then you can approve follow-up text for each contact.</p>
        ) : null}
        {contacts.length > 0 && caseRecord && consentSavedAt ? (
          <div className="flex flex-wrap gap-3">
            {contacts.map((contact) => (
              <Button
                key={contact.id}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const shared = sharedByContact[contact.id] ?? [];
                  void saveFollowUpChoice(caseId, {
                    action: "approve",
                    contactId: contact.id,
                    channel: contact.channel,
                    contactState: contact.state,
                    sharedFields: shared,
                    consentApprovedAt: consentSavedAt,
                    snapshot: {
                      diseaseName: caseRecord.diseaseName,
                      subtype: caseRecord.subtype ?? null,
                      stageSummary: caseRecord.stageSummary ?? null,
                      homeCity: caseRecord.homeCity ?? null,
                      homeState: caseRecord.homeState ?? null,
                      insurer: caseRecord.insurer ?? null,
                      travelLimitMiles: caseRecord.travelLimitMiles ?? null,
                      goals: caseRecord.goals ?? [],
                    },
                  }).then((result) => {
                    if (!result.ok) {
                      setFollowUpNote(result.reasons.join(" "));
                      return;
                    }
                    setFollowUps(result.followUps);
                    setFollowUpNote("Follow-up text saved for this contact. It still waits for the send window.");
                  });
                }}
              >
                Approve day 3 and day 7 for {contactLabel(contact)}
              </Button>
            ))}
          </div>
        ) : null}
        {followUpNote ? <p role="status" className="m-0 text-small text-ink-2">{followUpNote}</p> : null}
      </section>

      <section aria-labelledby="summary-heading" className="grid gap-5 rounded-lg border border-line bg-sage-soft/60 p-6 sm:p-9">
        <h3 id="summary-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Your choices at a glance
        </h3>
        <ul className="m-0 grid list-none gap-4 p-0">
          {summary.map(({ contact, shared, withheld }) => (
            <li key={contact.id} className="grid gap-1 border-t border-line-strong pt-4 first:border-t-0 first:pt-0">
              <span className="break-words font-semibold text-ink">{properName(contactLabel(contact))}</span>
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

/** Where the route came from. A demo coordinator is our own test inbox, never the resource's public contact. */
function ReachedNote({ channel, address }: { channel: "email" | "voice"; address: string }) {
  const demo = demoDestinationLabel(address, useDemoDestinations());
  const stand = channel === "email" ? "our own test inbox" : demo === DEMO_LABELS.voiceTestNumber ? "our own test phone" : "a simulated call (no number is dialed)";
  return (
    <p className="m-0 text-small text-ink-2">
      {demo
        ? `Demo mode: the plan uses this resource's real ${channel === "email" ? "email" : "phone"} contact point, but delivery goes to ${stand}. Their real contact is never used.`
        : `This is the intake ${channel === "email" ? "email" : "number"} listed on their public page.`}
      {channel === "email" ? " We will not phone them." : " The call opens by saying an AI assistant is calling for you."}
    </p>
  );
}
