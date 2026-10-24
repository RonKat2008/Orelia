"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActionCard, Button, EmptyState, List, ListRow, LoadingState, Skeleton, SummaryList } from "@/components/ui";
import { CASE_PAGE_HEADING, CASE_SECTION_HEADING } from "@/components/outreach/CasePage";
import { useJourney } from "./JourneyShell";
import { GOAL_LABELS, buildActivity, buildNeeds, type JourneyPlan } from "./model";

/**
 * What the next step is about, worded so it never repeats the button label (docs/DESIGN-v2.md 7.4 judge home).
 * The button keeps the journey model's label and href.
 */
const NEXT_HEADING: Record<JourneyPlan["current"], string> = {
  intake: "Next: the case details are not complete",
  research: "Next: the search is running",
  shortlist: "Next: pick up to 5 contacts",
  consent: "Next: decide what each contact may see",
  plan: "Next: check how each contact is reached",
  outreach: "Next: drafts are waiting for approval",
  tracker: "Next: watch for replies",
};

/**
 * Judge case home: one ActionCard (next step), the case details as a summary list, and recent activity. No stats
 * (they duplicated the stage bar and went stale: "Contacts chosen 0" while the shortlist showed 2 chosen), no READY
 * pill and no uppercase eyebrow.
 */
export function CaseHome({ caseId }: { caseId: string }) {
  const { plan, data } = useJourney();
  const Section = CASE_SECTION_HEADING;

  if (!data) {
    return (
      <LoadingState label="Loading your case">
        <div className="grid max-w-wide gap-6">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-32 w-full" />
        </div>
      </LoadingState>
    );
  }

  if (data.missingCase) {
    return (
      <EmptyState
        title="We could not find this case"
        description="It may have been removed, or the link may be incomplete. You can start a new case in a few minutes."
        action={
          <Button asChild>
            <Link href="/start">Start a case</Link>
          </Button>
        }
      />
    );
  }

  const summary = data.summary;
  const waiting = buildNeeds(plan, data.tasks, caseId).slice(1);
  const activity = buildActivity(data.contacts, data.tasks);

  return (
    <div className="ds-root grid max-w-wide gap-10">
      <ActionCard
        titleAs={CASE_PAGE_HEADING}
        title={NEXT_HEADING[plan.current]}
        lede={summary ? undefined : "Case details could not be loaded. You can still move through the steps."}
        action={
          <Button asChild>
            <Link href={plan.nextHref}>
              {plan.nextLabel}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      >
        {waiting.length > 0 ? (
          <div className="grid gap-2">
            <p className="m-0 text-small font-semibold text-ink-2">
              Also waiting ({waiting.length})
            </p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {waiting.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="rounded-sm text-body text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring"
                  >
                    {item.text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ActionCard>

      <section aria-labelledby="case-details-heading" className="grid gap-4">
        <Section id="case-details-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Case details
        </Section>
        {summary ? (
          <SummaryList
            rows={[
              { label: "Condition", value: summary.diseaseName },
              ...(summary.subtype ? [{ label: "Subtype", value: summary.subtype }] : []),
              ...(summary.stageSummary ? [{ label: "Stage, as you wrote it", value: summary.stageSummary }] : []),
              ...(summary.location ? [{ label: "Home", value: summary.location }] : []),
              ...(summary.insurer ? [{ label: "Insurer", value: summary.insurer }] : []),
              {
                label: "Goals",
                value: summary.goals.length > 0 ? summary.goals.map((goal) => GOAL_LABELS[goal] ?? goal).join(", ") : undefined,
              },
            ]}
          />
        ) : (
          <p className="m-0 text-body text-ink-2">No confirmed details yet.</p>
        )}
      </section>

      <section aria-labelledby="activity-heading" className="grid gap-4">
        <Section id="activity-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Recent activity
        </Section>
        {activity.length > 0 ? (
          <List>
            {activity.map((item) => (
              <ListRow key={item.id} title={<span className="font-normal break-words [overflow-wrap:anywhere]">{item.text}</span>} />
            ))}
          </List>
        ) : (
          <p className="m-0 text-body text-ink-2">Nothing has happened yet. Each step is written down here as it happens.</p>
        )}
      </section>
    </div>
  );
}
