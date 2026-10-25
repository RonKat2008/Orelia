"use client";

import { demoDestinationLabel, useDemoDestinations } from "@/components/outreach/DemoCoordinators";
import { DEMO_LABELS } from "@/lib/outreach/demo-destinations-shared";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, FileText, Mail, PhoneCall } from "lucide-react";
import {
  Button,
  Checkbox,
  Details,
  EmptyState,
  List,
  ListRow,
  LoadingState,
  Skeleton,
  Surface,
  toast,
  controlClasses,
} from "@/components/ui";
import { ErrorState } from "@/components/threads/states";
import type { CaseInput } from "@/lib/contracts";
import {
  SHAREABLE_FIELDS,
  minimumNecessaryFields,
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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const router = useRouter();
  const [followUps, setFollowUps] = useState<FollowUpMessage[] | null>(null);
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // Independent reads: one parallel round.
      const [record, plan] = await Promise.all([loadCase(caseId), loadFollowUpPlan(caseId)]);
      if (!active) return;
      setCaseRecord(record);
      const ids = readSelectedCandidateIds(caseId);
      setFollowUps(plan);
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
        setSharedByContact(Object.fromEntries(people.map((contact) => [contact.id, minimumNecessaryFields(contact.targetKind)])));
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
        Object.fromEntries(named.contacts.map((contact) => [contact.id, minimumNecessaryFields(contact.targetKind)])),
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

  async function save(advance = true) {
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
    toast.success("Your choices are saved", { description: "Next, the contact plan. Nothing is sent until you approve." });
    if (advance) router.push(`/cases/${caseId}/plan`);
  }

  async function approveFollowUps(contact: ApiContact) {
    if (!caseRecord || !consentSavedAt) return;
    const shared = sharedByContact[contact.id] ?? [];
    const result = await saveFollowUpChoice(caseId, {
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
    });
    if (!result.ok) {
      setFollowUpNote(result.reasons.join(" "));
      return;
    }
    setFollowUps(result.followUps);
    setFollowUpNote("Follow-up text saved for this contact. It still waits for the send window.");
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
  const onFile = SHAREABLE_FIELDS.filter((field) => !caseRecord || hasValue(caseRecord, field.key));
  const notOnFile = caseRecord ? SHAREABLE_FIELDS.filter((field) => !hasValue(caseRecord, field.key)) : [];
  const previewItem = summary.find((item) => item.contact.id === previewId) ?? summary[0];
  const previewChannel = previewItem?.contact.channel === "web" ? "email" : (previewItem?.contact.channel ?? "email");

  function setRow(key: ShareableFieldKey, on: boolean) {
    setSaved(false);
    setSharedByContact((current) =>
      Object.fromEntries(
        contacts.map((contact) => {
          const list = current[contact.id] ?? [];
          const without = list.filter((item) => item !== key);
          return [contact.id, on ? [...without, key] : without];
        }),
      ),
    );
  }

  function resetDefaults() {
    setSaved(false);
    setSharedByContact(Object.fromEntries(contacts.map((contact) => [contact.id, minimumNecessaryFields(contact.targetKind)])));
  }

  const columns = `minmax(15rem,1.8fr) repeat(${Math.max(contacts.length, 1)}, minmax(5.5rem,1fr))`;
  const renderRows = (fields: readonly (typeof SHAREABLE_FIELDS)[number][]) =>
    fields.map((field) => {
      const everyone = summary.every((item) => item.shared.includes(field.key));
      return (
        <div
          key={field.key}
          role="row"
          className="grid items-center border-b border-line"
          style={{ gridTemplateColumns: columns }}
        >
          <div role="rowheader" className="min-w-0 py-1.5 pr-3">
            <span className="flex items-baseline gap-2">
              <span className="whitespace-nowrap text-body font-semibold text-ink">{field.label}</span>
              {field.personal ? <span className="text-micro text-ink-2">personal</span> : null}
              <button
                type="button"
                onClick={() => setRow(field.key, !everyone)}
                className="ml-auto min-h-6 rounded-sm px-1 text-micro font-semibold text-teal-ink underline-offset-2 hover:underline focus-ring dark:text-teal"
              >
                {everyone ? "None" : "All"}
                <span className="sr-only"> for {field.label}</span>
              </button>
            </span>
            {caseRecord ? (
              <span className="block max-w-prose truncate text-small text-ink-2" title={fieldValue(caseRecord, field.key)}>
                {fieldValue(caseRecord, field.key)}
              </span>
            ) : null}
          </div>
          {summary.map(({ contact, shared }) => (
            <div key={contact.id} role="cell" className="flex min-h-11 items-center justify-center">
              <Checkbox
                checked={shared.includes(field.key)}
                onCheckedChange={() => toggle(contact.id, field.key)}
                aria-label={`Share ${field.label.toLowerCase()} with ${properName(contactLabel(contact))}`}
              />
            </div>
          ))}
        </div>
      );
    });

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)] gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section aria-labelledby="consent-heading" className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-6">
        <div className="grid min-w-0 content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <SectionH id="consent-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
              What each contact may see
            </SectionH>
            <p className="m-0 flex flex-wrap items-center gap-x-3 text-small text-ink-2">
              Pre-filled with the minimum each kind of contact needs.
              <Button type="button" variant="link" size="sm" onClick={resetDefaults}>
                Reset to minimum
              </Button>
            </p>
          </div>

          {/* Tablet and up: one grid, details down the side, contacts across. */}
          <div role="table" aria-label="Details each contact may see" className="hidden min-w-0 overflow-x-auto md:block">
            <div role="row" className="grid items-end border-b border-line-strong pb-1.5" style={{ gridTemplateColumns: columns }}>
              <span role="columnheader" className="text-small font-semibold text-ink-2">
                Detail
              </span>
              {summary.map(({ contact }) => {
                const { Icon: ChannelIcon, tone } = channelIcon(contact.channel);
                const name = properName(contactLabel(contact));
                return (
                  <span key={contact.id} role="columnheader" className="grid min-w-0 justify-items-center gap-0.5 px-1 text-center" data-contact-state={contact.state}>
                    <ChannelIcon aria-hidden className={cn("size-4", tone)} />
                    <span className="line-clamp-2 text-small font-semibold leading-tight text-ink" title={name}>
                      {name.replace(/\s*\(fictional\)/i, "")}
                    </span>
                  </span>
                );
              })}
            </div>
            {renderRows(onFile)}
          </div>
          {notOnFile.length > 0 ? (
            <p className="m-0 text-small text-ink-2">Not on file, so nothing to share: {notOnFile.map((field) => field.label.toLowerCase()).join(", ")}.</p>
          ) : null}

          {/* Phones: one compact block per contact, each detail a toggle chip. */}
          <div className="grid gap-2 md:hidden">
            {summary.map(({ contact, shared }) => {
              const { Icon: ChannelIcon, tone } = channelIcon(contact.channel);
              const name = properName(contactLabel(contact));
              return (
                <Surface key={contact.id} role="group" variant="pane" padding="sm" aria-labelledby={`contact-${contact.id}`} className="grid gap-2" data-contact-state={contact.state}>
                  <SubH id={`contact-${contact.id}`} className="m-0 flex items-center gap-2 break-words text-body font-semibold text-ink">
                    <ChannelIcon aria-hidden className={cn("size-4 shrink-0", tone)} />
                    {name}
                  </SubH>
                  <div className="flex flex-wrap gap-1.5">
                    {onFile.map((field) => {
                      const on = shared.includes(field.key);
                      return (
                        <button
                          key={field.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(contact.id, field.key)}
                          className={cn(
                            "inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3.5 text-small font-semibold focus-ring",
                            on ? "border-teal bg-teal-soft text-teal-ink dark:text-teal" : "border-line-strong bg-card text-ink-2",
                          )}
                        >
                          {on ? <Check aria-hidden className="size-4" /> : null}
                          {field.label}
                          <span className="sr-only"> with {name}</span>
                        </button>
                      );
                    })}
                  </div>
                </Surface>
              );
            })}
          </div>

          {unavailable.length > 0 ? (
            <div aria-labelledby="unavailable-heading" role="group" className="grid gap-1">
              <SubH id="unavailable-heading" className="m-0 text-small font-semibold text-ink-2">
                Not reached from here
              </SubH>
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
            </div>
          ) : null}
        </div>

        {/* Preview of one contact's message: stays in view beside the grid on wide screens. */}
        {previewItem ? (
          <aside aria-label="Message preview" className="grid min-w-0 content-start gap-2 lg:sticky lg:top-24 lg:self-start">
            <div className="flex items-center gap-2">
              <label htmlFor="consent-preview" className="shrink-0 text-small font-semibold text-ink-2">
                Preview for
              </label>
              <select
                id="consent-preview"
                value={previewItem.contact.id}
                onChange={(event) => setPreviewId(event.target.value)}
                className={cn(controlClasses, "h-11 min-w-0 flex-1 truncate")}
              >
                {summary.map(({ contact }) => (
                  <option key={contact.id} value={contact.id}>
                    {properName(contactLabel(contact))}
                  </option>
                ))}
              </select>
            </div>
            {!caseRecord ? (
              <p className="m-0 rounded-md bg-paper-2 p-3 text-small text-ink-2">
                Your case details did not load, so the preview is hidden. Your choices still save.
              </p>
            ) : (
              <LetterSheet
                channel={previewChannel}
                recipient={previewItem.contact.address}
                label={previewItem.contact.channel === "web" ? "What their online form will include" : previewChannel === "email" ? "Preview of the email" : "Preview of the call"}
                subject={previewChannel === "email" ? "Patient intake inquiry" : null}
              >
                {(() => {
                  const letter = buildLetterPreview(previewChannel, previewItem.preview);
                  return (
                    <>
                      {letter.opening ? <p className="m-0">{letter.opening}</p> : null}
                      {letter.lines.map((line) => (
                        <p key={line} className="m-0 break-words">
                          {line}
                        </p>
                      ))}
                      {letter.closing ? <p className="m-0">{letter.closing}</p> : null}
                    </>
                  );
                })()}
              </LetterSheet>
            )}
            <p className="m-0 text-small text-ink-2" data-testid="withheld">
              {previewItem.withheld.length === 0 ? (
                "Every detail is included."
              ) : (
                <>
                  <span className="font-semibold text-ink">Stays private:</span> {previewItem.withheld.join(", ")}.
                </>
              )}{" "}
              {previewItem.contact.channel === "web" ? null : <ReachedNote channel={previewChannel} address={previewItem.contact.address} />}
            </p>
          </aside>
        ) : null}
      </section>

      <Details label={null} summary="Follow-ups while you're away (day 3 and day 7)">
        <section data-slot="follow-up-plan" aria-label="Follow-ups while you're away" className="grid gap-3">
          <p className="m-0 max-w-prose text-small text-ink-2">
            Day 3 and day 7 messages are kept only after you approve the exact text. None is sent on its own.
          </p>
          {followUps === null ? (
            <p role="status" className="m-0 text-small text-ink-2">Follow-up messages could not be loaded.</p>
          ) : followUps.length === 0 ? (
            <p className="m-0 text-small text-ink-2">No follow-up text is approved yet.</p>
          ) : (
            <ul className="m-0 grid list-none border-t border-line p-0">
              {followUps.map((item) => (
                <li key={item.messageId} className="grid gap-1 border-b border-line py-2">
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
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {contacts.map((contact) => (
                <Button
                  key={contact.id}
                  type="button"
                  variant="link"
                  onClick={() => void approveFollowUps(contact)}
                >
                  Approve day 3 and day 7 for {contactLabel(contact)}
                </Button>
              ))}
            </div>
          ) : null}
          {followUpNote ? <p role="status" className="m-0 text-small text-ink-2">{followUpNote}</p> : null}
        </section>
      </Details>

      {saveErrors.length > 0 ? (
        <ErrorState title="Your choices were not saved for everyone" detail={saveErrors.join(" ")} />
      ) : null}

      <div
        data-slot="action-bar"
        className="sticky bottom-0 z-30 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-paper/95 px-1 py-2.5 backdrop-blur-md"
      >
        <p role="status" className="m-0 min-w-0 text-small text-ink-2">
          {saved
            ? "Saved for each contact."
            : `Sharing ${totalShared} detail${totalShared === 1 ? "" : "s"} across ${contacts.length} contact${contacts.length === 1 ? "" : "s"}. Only ticked details are shared; every message says an AI helped. Nothing is sent from here.`}
        </p>
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" disabled={saving || contacts.length === 0} onClick={() => void save(false)}>
            {saved ? "Save again" : "Save only"}
          </Button>
          <Button type="submit" loading={saving} loadingText="Saving" disabled={contacts.length === 0}>
            {saved ? (
              <>Continue to the plan <ArrowRight aria-hidden /></>
            ) : (
              <>Save and continue <ArrowRight aria-hidden /></>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** True when the case has a value for this field (rows without one sit behind "N more fields (not on file)"). */
function hasValue(record: CaseInput, key: ShareableFieldKey): boolean {
  const value = fieldValue(record, key);
  return value.length > 0 && value !== "Not on file";
}

/** Icon and tone for a contact's channel (a web-form contact shares the same ticked fields, typed into their form). */
function channelIcon(channel: ApiContact["channel"]) {
  if (channel === "web") return { Icon: FileText, tone: "text-ch-apply" };
  return channel === "email" ? { Icon: Mail, tone: "text-ch-email" } : { Icon: PhoneCall, tone: "text-ch-call" };
}

function titleWords(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
