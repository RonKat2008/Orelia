import { CasePage } from "@/components/outreach/CasePage";
import { LiveConsole } from "@/components/live/LiveConsole";
import { JudgeOnly } from "@/components/ui";
import { LiveDemoControls } from "@/components/demo/LiveDemoControls";
import { PendingFormQuestions } from "@/components/outreach/FormQuestionsCard";
import { liveDemoEnabled } from "@/lib/demo-live/start";

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

export const metadata = { title: "Live activity" };

/** Judge console: what the outreach agents are doing right now. Content only; the case layout owns <main>. */
export default async function LiveActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const demo = await showDemoControls(id);
  return (
    <JudgeOnly
      fallback={
        <p className="m-0 max-w-prose text-body text-ink-2">
          Live activity is part of the judge view. Add <code>?view=judge</code> to the address to see it.
        </p>
      }
    >
      <CasePage title="Live activity" lede="Agents, emails, calls and follow-ups as they happen." eyebrow="Live">
        {demo ? <div className="mb-3"><LiveDemoControls caseId={id} /></div> : null}
        <PendingFormQuestions caseId={id} className="mb-3" />
        <LiveConsole caseId={id} />
      </CasePage>
    </JudgeOnly>
  );
}
