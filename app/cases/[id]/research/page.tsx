import { ConditionBriefView } from "@/components/condition-brief/ConditionBriefView";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConditionBriefView caseId={id} />;
}
