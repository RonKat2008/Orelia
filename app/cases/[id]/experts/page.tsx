import { PageIntro } from "@/components/shortlist/PageIntro";
import { ExpertsView } from "@/components/experts/ExpertsView";

export default async function ExpertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <PageIntro
        eyebrow="Research to care"
        title={
          <>
            From research to <em className="emph">care</em>
          </>
        }
        lede="Start from papers about your condition and follow each author to where they work and how to reach them. Every line links to its source. Wayfinder reads public pages only and contacts nobody here."
      />
      <ExpertsView caseId={id} />
    </div>
  );
}
