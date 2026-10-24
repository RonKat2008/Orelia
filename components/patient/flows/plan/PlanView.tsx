"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Mail, MousePointerClick, PhoneCall } from "lucide-react";
import { BackLink, Button, EmptyState, List, ListRow, LoadingState, PageHeader, Skeleton } from "@/components/ui";
import { planLine } from "@/lib/patient-status/plain";
import { ActionError, ActionFrame } from "../../actions/ActionFrame";
import { PLAN_COPY as COPY } from "./copy";
import { usePlanApproval } from "./usePlanApproval";

const ICONS = { email: Mail, voice: PhoneCall, web_form: MousePointerClick } as const;

export interface PlanViewProps {
  caseId: string;
  layout: "card" | "page";
  titleAs?: "h1" | "h2";
  detailsHref?: string;
  onDone: () => Promise<void> | void;
}

/**
 * Patient plan: one plain row per contact with its channel icon, and "OK this plan". No reorder controls and no
 * test-inbox notes (judge view only). OK-ing the plan sends nothing; every message is read first.
 */
export function PlanView({ caseId, layout, titleAs = "h1", detailsHref, onDone }: PlanViewProps) {
  const { plan, errors, busy, approve } = usePlanApproval(caseId);

  async function ok() {
    if (await approve()) await onDone();
  }

  let content: ReactNode;
  if (!plan && errors.length === 0) {
    content = (
      <LoadingState label={COPY.loading}>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </LoadingState>
    );
  } else if (plan && layout === "page" && (plan.resources.length === 0 || plan.approvedAt)) {
    const done = plan.resources.length > 0;
    content = (
      <EmptyState
        title={done ? COPY.doneTitle : COPY.emptyTitle}
        description={done ? COPY.doneText : COPY.emptyText}
        action={
          <Link href={`/cases/${caseId}`} className="rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring">
            {COPY.backToCase}
          </Link>
        }
      />
    );
  } else {
    content = (
      <>
        <ActionError messages={errors} />
        {plan ? (
          <List label={COPY.listLabel}>
            {plan.resources.map((resource) => {
              const firstStep = [...resource.steps].filter((s) => s.enabled).sort((a, b) => a.order - b.order)[0];
              const Icon = firstStep ? ICONS[firstStep.channel] : Mail;
              return (
                <ListRow
                  key={resource.resourceKey}
                  title={resource.name}
                  meta={planLine(resource.steps)}
                  leading={<Icon aria-hidden className="text-teal" />}
                />
              );
            })}
          </List>
        ) : null}
      </>
    );
  }

  const action =
    plan && plan.resources.length > 0 && !(layout === "page" && plan.approvedAt) ? (
      <Button size="lg" loading={busy} loadingText={COPY.busy} onClick={() => void ok()}>
        {COPY.action}
      </Button>
    ) : undefined;

  if (layout === "card") {
    return (
      <ActionFrame kind="approve_plan" title={COPY.title} lede={COPY.lede} detailsHref={detailsHref} action={action}>
        {content}
      </ActionFrame>
    );
  }

  return (
    <div className="grid max-w-patient gap-6">
      <BackLink href={`/cases/${caseId}`}>{COPY.backToCase}</BackLink>
      <PageHeader as={titleAs} title={COPY.title} lede={COPY.lede} className="mb-0" />
      {content}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
