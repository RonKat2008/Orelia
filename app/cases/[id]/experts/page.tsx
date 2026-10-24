import { ExpertsView } from "@/components/experts/ExpertsView";

export default async function ExpertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <ExpertsView caseId={id} />
    </div>
  );
}
