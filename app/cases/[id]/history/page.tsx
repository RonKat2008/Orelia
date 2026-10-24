import { Suspense } from "react";
import { HistoryWorkspace } from "@/components/history/HistoryWorkspace";
import { PageIntro } from "@/components/shortlist/PageIntro";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <PageIntro
        eyebrow="Medical history"
        title={
          <>
            Your records, <em className="emph">in order</em>
          </>
        }
        lede="Add the records you already have. Wayfinder arranges them on a timeline, cites the record behind every line, and points out where two records disagree. It does not interpret them or tell you which is right."
      />
      <Suspense fallback={null}>
        <HistoryWorkspace caseId={id} />
      </Suspense>
    </div>
  );
}
