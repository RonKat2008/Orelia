import { Suspense } from "react";
import { PatientShortlist } from "@/components/patient/views";
import { CASE_PAGE_HEADING } from "@/components/outreach/CasePage";
import { ShortlistSkeleton } from "@/components/shortlist/ShortlistSkeleton";
import { ShortlistView } from "@/components/shortlist/ShortlistView";
import { JudgeOnly } from "@/components/ui";

/** Content only. Patient view: lane C's PatientShortlist. Judge view: the two-pane console (its own CasePage). */
export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <JudgeOnly fallback={<PatientShortlist caseId={id} titleAs={CASE_PAGE_HEADING} />}>
      <Suspense fallback={<ShortlistSkeleton />}>
        <ShortlistView caseId={id} />
      </Suspense>
    </JudgeOnly>
  );
}
