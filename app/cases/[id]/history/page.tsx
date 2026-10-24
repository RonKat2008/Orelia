import { Suspense } from "react";
import { HistoryWorkspace } from "@/components/history/HistoryWorkspace";
import { UseMyDocuments } from "@/components/account/UseMyDocuments";
import { historySamplesEnabled } from "@/lib/history/samples-enabled";

/** Content only: the case layout supplies AppShell, the header, the Stepper and the single <main id="main">. */
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="ds-root">
      <Suspense fallback={null}>
        <HistoryWorkspace caseId={id} samplesEnabled={historySamplesEnabled(process.env)} libraryNote={<UseMyDocuments caseId={id} />} />
      </Suspense>
    </div>
  );
}
