import { SwarmView } from "@/components/swarm/SwarmView";

/**
 * Content only: the case layout supplies the shell, stage bar and <main>. SwarmView renders the CasePage frame itself
 * because its header action ("Review the shortlist") depends on the live run state.
 * LANE C SWITCH POINT: pass patient={<PatientSwarm… />} to CasePage inside SwarmView.
 */
export default async function SwarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SwarmView caseId={id} />;
}
