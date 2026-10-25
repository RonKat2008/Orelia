import { CasePage } from "@/components/outreach/CasePage";
import { LiveConsole } from "@/components/live/LiveConsole";
import { JudgeOnly } from "@/components/ui";
import { LiveDemoControls } from "@/components/demo/LiveDemoControls";
import { PendingFormQuestions } from "@/components/outreach/FormQuestionsCard";
import { liveDemoEnabled } from "@/lib/demo-live/start";
import { emailDestinationAvailability } from "@/lib/outreach/demo-email-destination";
import type { UiChoice } from "@/lib/demo-live/email-destination-ui";
import { browserCallAvailability } from "@/lib/outreach/browser-call";

export const dynamic = "force-dynamic";

/** Demo controls appear only in demo mode and only on a case seeded by "Run full demo". */
async function showDemoControls(caseId: string): Promise<boolean> {
  if (!liveDemoEnabled(process.env) || !/^[0-9a-f-]{36}$/i.test(caseId)) return false;
  try {
    const { isLiveDemoCase } = await import("@/lib/demo-live/skip-ahead");
    return await isLiveDemoCase(caseId);
  } catch {
    return false;
  }
}

/** The case's email-destination choice (default scripted) and which options are configured. Not addresses. */
async function emailDestinationState(caseId: string) {
  const available = emailDestinationAvailability(process.env);
  let stored: UiChoice | undefined;
  try {
    const { getEmailDestinationChoice } = await import("@/lib/demo-live/email-destination");
    stored = await getEmailDestinationChoice(caseId);
  } catch {
    stored = undefined;
  }
  // A stored choice whose group is no longer configured falls back to whichever option exists.
  const choice: UiChoice = stored && available[stored] ? stored : available.scripted || !available.personal ? "scripted" : "personal";
  return { choice, available };
}

export const metadata = { title: "Live activity" };

/** Judge console: what the outreach agents are doing right now. Content only; the case layout owns <main>. */
export default async function LiveActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const demo = await showDemoControls(id);
  const emailDestination = demo ? await emailDestinationState(id) : undefined;
  // DEMO ONLY: this page is the judge view, so the judge-in-demo-mode rule applies (the route re-checks it).
  const browserCall = browserCallAvailability(process.env, { judge: true }).ok;
  return (
    <JudgeOnly
      fallback={
        <p className="m-0 max-w-prose text-body text-ink-2">
          Live activity is part of the judge view. Add <code>?view=judge</code> to the address to see it.
        </p>
      }
    >
      <CasePage title="Live activity" lede="Agents, emails, calls and follow-ups as they happen." eyebrow="Live">
        {demo ? <div className="mb-3"><LiveDemoControls caseId={id} browserCall={browserCall} emailDestination={emailDestination} /></div> : null}
        <PendingFormQuestions caseId={id} className="mb-3" />
        <LiveConsole caseId={id} browserCall={browserCall} />
      </CasePage>
    </JudgeOnly>
  );
}
