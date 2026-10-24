"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CircleAlert, CircleMinus, Clock, Compass, FileText, MessageCircle, Send, Users } from "lucide-react";
import { Button, Details, EmptyState, List, ListRow, LoadingState, PageHeader, Skeleton } from "@/components/ui";
import type { ApiContact } from "@/components/outreach/client";
import { loadCaseContacts, loadCaseTasks } from "@/components/outreach/case-activity";
import type { OutreachTask } from "@/components/outreach/types";
import { usePatientStatus } from "../usePatientStatus";
import { TRACKER_COPY as copy } from "./tracker/copy";
import { STATUS_ICON, detailLines, followUpLine, needsYouIds, orderContacts, statusWord, trackerPrimary, type StatusIcon } from "./tracker/model";
import type { PatientTrackerProps } from "./types";

const ICONS: Record<StatusIcon, typeof Send> = {
  send: Send,
  reply: MessageCircle,
  alert: CircleAlert,
  clock: Clock,
  minus: CircleMinus,
  calendar: CalendarCheck,
  draft: FileText,
};

function patientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Patient view of the tracker and threads (docs/DESIGN-v2.md 7.10): one row per contact, one status word each. */
export function PatientTracker({ caseId, titleAs = "h1", focusContactId = null }: PatientTrackerProps) {
  const { body, error, missing, refresh } = usePatientStatus(caseId);
  const [contacts, setContacts] = useState<ApiContact[] | null>(null);
  const [tasks, setTasks] = useState<OutreachTask[]>([]);
  const status = body?.status ?? null;
  const updatedAt = status?.updatedAt;
  const timeZone = useMemo(() => patientTimeZone(), []);

  // Contacts and tasks come from the same APIs as the judge tracker; re-read whenever the live status changes.
  useEffect(() => {
    let active = true;
    void loadCaseContacts(caseId).then(async (rows) => {
      if (!active || !rows) return;
      const names = new Map(rows.map((c) => [c.id, c.displayName ?? copy.unnamed] as const));
      const found = await loadCaseTasks(caseId, names);
      if (!active) return;
      setContacts(rows);
      setTasks(found ?? []);
    });
    return () => {
      active = false;
    };
  }, [caseId, updatedAt]);

  const needs = useMemo(() => needsYouIds(contacts ?? [], tasks, status), [contacts, tasks, status]);
  const ordered = useMemo(() => orderContacts(contacts ?? [], needs), [contacts, needs]);

  useEffect(() => {
    if (!focusContactId || !contacts) return;
    document.getElementById(`contact-${focusContactId}`)?.scrollIntoView({ block: "center" });
  }, [focusContactId, contacts]);

  if (missing) {
    return (
      <div className="max-w-patient">
        <EmptyState
          icon={<Compass />}
          title={copy.missingTitle}
          description={copy.missingBody}
          action={<Button asChild><Link href="/start">{copy.missingLink}</Link></Button>}
        />
      </div>
    );
  }
  if (!body && error) {
    return (
      <div className="max-w-patient">
        <EmptyState icon={<Compass />} title={copy.errorTitle} description={error} action={<Button onClick={() => void refresh()}>{copy.errorRetry}</Button>} />
      </div>
    );
  }
  if (!body || !contacts) {
    return (
      <LoadingState label={copy.loading} className="max-w-patient">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </LoadingState>
    );
  }

  const primary = trackerPrimary(status);
  const caseHref = `/cases/${caseId}`;

  return (
    <div data-testid="patient-tracker" className="grid max-w-patient gap-8">
      <PageHeader as={titleAs} className="mb-0" title={copy.title} lede={copy.lede} />
      {ordered.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={copy.emptyTitle}
          description={copy.emptyBody}
          action={<Button asChild variant="link"><Link href={caseHref}>{copy.backLink}</Link></Button>}
        />
      ) : (
        <List label={copy.listLabel}>
          {ordered.map((contact) => {
            const needsYou = needs.has(contact.id);
            const word = statusWord(contact, needsYou);
            const Icon = ICONS[STATUS_ICON[word]];
            const name = contact.displayName ?? copy.unnamed;
            return (
              <ListRow
                key={contact.id}
                id={`contact-${contact.id}`}
                title={name}
                meta={followUpLine(contact, timeZone)}
                badges={
                  <span className={`inline-flex items-center gap-1.5 text-small font-semibold ${needsYou ? "text-teal-ink" : "text-ink-2"}`}>
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {copy.words[word]}
                  </span>
                }
              >
                {needsYou && contact.id !== primary?.contactId ? (
                  <Button asChild variant="link">
                    <Link href={caseHref}>{copy.needsYouLink}</Link>
                  </Button>
                ) : null}
                <Details label={copy.detailsLabel} summary={copy.detailsSummary} defaultOpen={focusContactId === contact.id}>
                  <ul className="m-0 grid list-none gap-1 p-0 text-small">
                    {detailLines(contact, tasks, timeZone).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Details>
              </ListRow>
            );
          })}
        </List>
      )}
      {primary ? (
        <div>
          <Button asChild size="lg">
            <Link href={caseHref}>{primary.label}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
