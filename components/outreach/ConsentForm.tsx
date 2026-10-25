"use client";

import { DemoCoordinatorBadge, demoDestinationLabel, useDemoDestinations } from "@/components/outreach/DemoCoordinators";
import { DEMO_LABELS } from "@/lib/outreach/demo-destinations-shared";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Mail, PhoneCall } from "lucide-react";
import {
  Button,
  Details,
  EmptyState,
  List,
  ListRow,
  LoadingState,
  Skeleton,
  Surface,
  Switch,
  toast,
} from "@/components/ui";
import { ErrorState } from "@/components/threads/states";
import type { CaseInput } from "@/lib/contracts";
import {
  SHAREABLE_FIELDS,
  defaultSharedFields,
  fieldValue,
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
import { CASE_SECTION_HEADING, CASE_SUB_HEADING } from "./CasePage";

const SectionH = CASE_SECTION_HEADING;
const SubH = CASE_SUB_HEADING;

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

  if (phase.kind === "loading") {
    return (
      <LoadingState label="Loading your selected contacts">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </LoadingState>
    );
  }

  if (phase.kind === "nothing") {
    return (
      <EmptyState
        titleAs={CASE_SECTION_HEADING}
        title="No one is selected yet"
        description="Pick up to five on your shortlist. Then come back to choose what each one may see."
        action={
          <Button asChild>
            <Link href={`/cases/${caseId}/shortlist`}>Open the shortlist</Link>
          </Button>
        }
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
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section aria-labelledby="consent-heading" className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <div className="grid gap-2">
          <SectionH id="consent-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
            What may we share?
          </SectionH>
          <p className="m-0 max-w-prose text-body text-ink-2">
            Each contact has its own switches. Changing one never changes another.
          </p>
        </div>

        {summary.map(({ contact, shared, preview, withheld }) => {
          const name = properName(contactLabel(contact));
          const web = contact.channel === "web";
          // A web-form contact shares the same ticked fields, typed into their online form instead of a letter.
          const channel = contact.channel === "web" ? "email" : contact.channel;
          const ChannelIcon = web ? FileText : contact.channel === "email" ? Mail : PhoneCall;
          const letter = buildLetterPreview(channel, preview);
          const onFile = SHAREABLE_FIELDS.filter((field) => !caseRecord || hasValue(caseRecord, field.key));
          const notOnFile = caseRecord ? SHAREABLE_FIELDS.filter((field) => !hasValue(caseRecord, field.key)) : [];
          const row = (field: (typeof SHAREABLE_FIELDS)[number]) => (
            <FieldSwitchRow
              key={field.key}
              id={`share-${contact.id}-${field.key}`}
              label={field.label}
              personal={field.personal}
              contactName={name}
              value={caseRecord ? fieldValue(caseRecord, field.key) : null}
              checked={shared.includes(field.key)}
              onToggle={() => toggle(contact.id, field.key)}
            />
          );
          return (
            <Surface
              key={contact.id}
              role="group"
              variant="pane"
              padding="md"
              data-contact-state={contact.state}
              aria-labelledby={`contact-${contact.id}`}
              className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-8"
            >
              <div className="grid min-w-0 content-start gap-4">
                <div className="grid gap-1">
                  <SubH id={`contact-${contact.id}`} className="m-0 break-words text-body font-semibold text-ink">
                    {name}
                  </SubH>
                  <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-2">
                    <ChannelIcon
                      aria-hidden
                      className={cn("size-4 shrink-0", contact.channel === "email" ? "text-ch-email" : "text-ch-call")}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {web ? "Online form" : contact.channel === "email" ? "Email" : "Phone call"} · {contact.address}
                    </span>
                    <DemoCoordinatorBadge address={contact.address} />
                  </p>
                  {web ? null : <ReachedNote channel={channel} address={contact.address} />}
                </div>

                <dl aria-label={`What ${name} may see`} className="m-0 grid border-t border-line">
                  {onFile.map(row)}
                </dl>
                {notOnFile.length > 0 ? (
                  <Details
                    label={null}
                    summary={`${notOnFile.length} more ${notOnFile.length === 1 ? "field" : "fields"} (not on file)`}
                  >
                    <dl aria-label={`Fields not on file for ${name}`} className="m-0 grid border-t border-line">
                      {notOnFile.map(row)}
                    </dl>
                  </Details>
                ) : null}
              </div>

              <div className="grid min-w-0 content-start gap-3 lg:sticky lg:top-28 lg:self-start">
                {!caseRecord ? (
                  <p className="m-0 rounded-md bg-paper-2 p-4 text-small text-ink-2">
                    Your case details did not load, so the preview is hidden. Your choices still save.
                  </p>
                ) : (
                  <LetterSheet
                    channel={channel}
                    recipient={contact.address}
                    label={web ? "What their online form will include" : contact.channel === "email" ? "Preview of the email" : "Preview of the call"}
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
                <p className="m-0 text-small text-ink-2">The real draft is written after you save.</p>
              </div>
            </Surface>
          );
        })}
      </section>

      {unavailable.length > 0 ? (
        <section aria-labelledby="unavailable-heading" className="grid gap-3">
          <SectionH id="unavailable-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
            Not reached from here
          </SectionH>
          <List>
            {unavailable.map((item) => (
              <ListRow
                key={item.candidateId}
                data-channel={item.route === "web_form" ? "web_form" : "none"}
                title={item.name ?? "This one"}
                meta={
                  item.route === "web_form"
                    ? "Online form only. It is filled in for your review in the plan. Nothing is sent from here."
                    : `No email or phone we could check, so nothing can be sent. ${item.reason}`
                }
              />
            ))}
          </List>
        </section>
      ) : null}

      <section aria-labelledby="summary-heading" className="grid gap-4 border-t border-line pt-6">
        <SectionH id="summary-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Your choices at a glance
        </SectionH>
        <ul className="m-0 grid list-none gap-2 p-0">
          {summary.map(({ contact, shared, withheld }) => (
            <li key={contact.id} className="text-body text-ink-2">
              <span className="break-words font-semibold text-ink">{properName(contactLabel(contact))}:</span>{" "}
              {shared.length === 0
                ? "sees no case details."
                : `sees ${SHAREABLE_FIELDS.filter((field) => shared.includes(field.key))
                    .map((field) => field.label.toLowerCase())
                    .join(", ")}.`}{" "}
              {withheld.length > 0 ? `${withheld.length} stay private.` : "Nothing is held back."}
            </li>
          ))}
        </ul>
        {saveErrors.length > 0 ? (
          <ErrorState title="Your choices were not saved for everyone" detail={saveErrors.join(" ")} />
        ) : null}
        <p className="m-0 max-w-prose text-small text-ink-2">
          Only what you say yes to is shared. Every message says an AI helped write it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant={saved ? "secondary" : "primary"}
            loading={saving}
            loadingText="Saving"
            disabled={contacts.length === 0}
          >
            {saved ? "Save again" : "Save what they may see"}
          </Button>
          {saved ? (
            <Button asChild>
              <Link href={`/cases/${caseId}/outbox`}>
                Check the drafts <ArrowRight aria-hidden />
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

      <section data-slot="follow-up-plan" aria-labelledby="follow-up-heading" className="grid gap-3 border-t border-line pt-6">
        <SectionH id="follow-up-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Follow-ups while you&apos;re away
        </SectionH>
        <p className="m-0 max-w-prose text-body text-ink-2">
          Day 3 and day 7 messages are kept only after you approve the exact text. None is sent on its own.
        </p>
        {followUps === null ? (
          <p role="status" className="m-0 text-small text-ink-2">Follow-up messages could not be loaded.</p>
        ) : followUps.length === 0 ? (
          <p className="m-0 text-small text-ink-2">No follow-up text is approved yet.</p>
        ) : (
          <ul className="m-0 grid list-none border-t border-line p-0">
            {followUps.map((item) => (
              <li key={item.messageId} className="grid gap-1 border-b border-line py-3">
                <span className="text-small font-semibold text-ink-2">
                  {titleWords(item.classification.replaceAll("_", " "))} · {item.approvedAt ? "Approved" : "Not approved"}
                </span>
                <p className="m-0 whitespace-pre-wrap text-small text-ink">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
        {contacts.length > 0 && caseRecord && !consentSavedAt ? (
          <p className="m-0 text-small text-ink-2">Save your choices first. Then you can approve follow-up text for each contact.</p>
        ) : null}
        {contacts.length > 0 && caseRecord && consentSavedAt ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {contacts.map((contact) => (
              <Button
                key={contact.id}
                type="button"
                variant="link"
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
    </form>
  );
}

/** True when the case has a value for this field (rows without one sit behind "N more fields (not on file)"). */
function hasValue(record: CaseInput, key: ShareableFieldKey): boolean {
  const value = fieldValue(record, key);
  return value.length > 0 && value !== "Not on file";
}

function titleWords(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface FieldSwitchRowProps {
  id: string;
  label: string;
  personal: boolean;
  contactName: string;
  value: string | null;
  checked: boolean;
  onToggle: () => void;
}

/** One compact consent row: the field name (its visible label), the value on file, and a switch. */
function FieldSwitchRow({ id, label, personal, contactName, value, checked, onToggle }: FieldSwitchRowProps) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-2">
      <dt className="min-w-0 flex-1 basis-40">
        <label htmlFor={id} className="cursor-pointer text-body font-semibold text-ink">
          Share {label.toLowerCase()}
          <span className="sr-only"> with {contactName}</span>
        </label>
        {personal ? <span className="block text-small text-ink-2">More personal</span> : null}
      </dt>
      <dd className="m-0 flex min-w-0 items-center gap-4">
        {value !== null ? <span className="min-w-0 break-words text-small text-ink-2">{value || "None"}</span> : null}
        <Switch id={id} checked={checked} onCheckedChange={onToggle} />
      </dd>
    </div>
  );
}

/** Where the route came from. A demo coordinator is our own test inbox, never the resource's public contact. */
function ReachedNote({ channel, address }: { channel: "email" | "voice"; address: string }) {
  const demo = demoDestinationLabel(address, useDemoDestinations());
  const stand = channel === "email" ? "our own test inbox" : demo === DEMO_LABELS.voiceTestNumber ? "our own test phone" : "a simulated call (no number is dialed)";
  return (
    <p className="m-0 text-small text-ink-2">
      {demo
        ? `Demo mode: the plan uses their real ${channel === "email" ? "email" : "phone"} contact point, but delivery goes to ${stand}.`
        : `The intake ${channel === "email" ? "email" : "number"} on their public page.`}
      {channel === "email" ? " We will not phone them." : " The call opens by saying an AI assistant is calling for you."}
    </p>
  );
}
