import { PatientSearch } from "@/components/patient/views";
import { SwarmView } from "@/components/swarm/SwarmView";
import { JudgeOnly } from "@/components/ui";
import { CASE_PAGE_HEADING } from "@/components/outreach/CasePage";

/**
 * Content only: the case layout supplies the shell and <main>. Patient view renders lane C's PatientSearch; judge view
 * renders SwarmView, which draws its own CasePage because its header action depends on the live run. Switching here
 * (not inside SwarmView) keeps one stream subscription per view.
 */
export default async function SwarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <JudgeOnly fallback={<PatientSearch caseId={id} titleAs={CASE_PAGE_HEADING} />}>
      <SwarmView caseId={id} />
    </JudgeOnly>
  );
}
