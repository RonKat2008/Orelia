"use client";

import Link from "next/link";
import { Compass, Inbox } from "lucide-react";
import { Button, EmptyState, LoadingState, PageHeader, Skeleton } from "@/components/ui";
import { FormCard } from "../actions/FormCard";
import { MessageCard } from "../actions/MessageCard";
import { usePatientStatus } from "../usePatientStatus";
import { OUTBOX_COPY as copy } from "./outbox/copy";
import { consentName, outboxKey, outboxScreen } from "./outbox/model";
import type { PatientViewProps } from "./types";

/** Patient view of the outbox (docs/DESIGN-v2.md 7.9): one message per screen, read the exact letter, then OK it. */
export function PatientOutbox({ caseId, titleAs = "h1" }: PatientViewProps) {
  const { body, error, missing, refresh } = usePatientStatus(caseId);

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
  if (!body) {
    return (
      <LoadingState label={copy.loading} className="max-w-patient">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-64 w-full" />
      </LoadingState>
    );
  }

  const { status } = body;
  const screen = outboxScreen(status);
  const action = status.nextAction;
  const common = { caseId, onDone: refresh, headline: status.headline };

  return (
    <div data-testid="patient-outbox" data-screen={screen} className="grid max-w-patient gap-4 sm:gap-6">
      <PageHeader as={titleAs} className="mb-0" title={copy.title} lede={copy.lede} />
      {screen === "message" && action ? <MessageCard key={outboxKey(status)} {...common} action={action} /> : null}
      {screen === "form" && action ? <FormCard key={outboxKey(status)} {...common} action={action} /> : null}
      {screen === "consent" ? (
        <EmptyState
          icon={<Inbox />}
          title={copy.consentTitle}
          description={copy.consentBody(consentName(status))}
          action={<Button asChild size="lg"><Link href={`/cases/${caseId}/consent`}>{copy.consentPrimary}</Link></Button>}
        />
      ) : null}
      {screen === "empty" ? (
        <EmptyState
          icon={<Inbox />}
          title={copy.emptyTitle}
          description={copy.emptyBody}
          action={<Button asChild variant="link"><Link href={`/cases/${caseId}`}>{copy.backLink}</Link></Button>}
        />
      ) : null}
    </div>
  );
}
