import { OutreachNav } from "@/components/outreach/OutreachNav";
import { PlanView } from "@/components/plan/PlanView";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <OutreachNav
      caseId={id}
      current="plan"
      eyebrow="Before any draft is written"
      title={
        <>
          How we will <em className="emph">reach</em> each resource
        </>
      }
      lede="For each contact you chose, this is the order we would try: email, a call, or their online form. Turn steps off or reorder them. Approving the plan writes drafts for you to read; nothing is sent until you approve each one."
    >
      <PlanView caseId={id} />
    </OutreachNav>
  );
}
