import { OutreachNav } from "@/components/outreach/OutreachNav";
import { PlanView } from "@/components/plan/PlanView";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav caseId={id} current="plan">
      <div className="ds-root flex flex-col gap-stack">
        <h1 className="display-soft font-display text-h2 text-balance">
          How we will <em className="emph">reach</em> each resource
        </h1>
        <PlanView caseId={id} />
      </div>
    </OutreachNav>
  );
}
