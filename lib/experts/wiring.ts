import { getServices } from '@/app/api/cases/_lib/services';
import { MemoryPersist, type ShortlistEvidence } from '@/lib/agents/persist';
import { createLivePorts } from '@/lib/agents/research/live-ports';
import { isOffline } from '@/lib/env';
import { createFixtureExpertPorts } from './fixtures';
import type { TraceExpert, TraceInput, TraceInputEvidence, TracePorts } from './trace';

/** Fixture ports offline (WAYFINDER_OFFLINE=1), live NPPES + Exa otherwise. */
export function getTracePorts(now: Date = new Date()): TracePorts {
  if (isOffline()) return { ...createFixtureExpertPorts(), now };
  const live = createLivePorts();
  return { nppes: live.nppes, exa: live.exa, now };
}

/**
 * The case's experts (shortlisted, plus research-only authors below the shortlist threshold) and shortlisted
 * institutions with their verified evidence (read-only). Research-only authors are traced, never shortlisted.
 */
export async function loadTraceInput(caseId: string): Promise<TraceInput | null> {
  const { cases, persist } = getServices();
  const found = await cases.get(caseId);
  if (!found) return null;
  const [items, caseExperts] = await Promise.all([persist.getShortlist(caseId), persist.getCaseExperts(caseId)]);
  const resources = persist instanceof MemoryPersist ? persist.resources : undefined;
  const experts: TraceExpert[] = caseExperts.map((x) => {
    const r = resources?.get(x.id);
    const expert = r?.kind === 'expert' ? r : undefined;
    const profile = expert?.profile ?? x.profile;
    return {
      id: x.id, name: x.name, npi: x.npi ?? expert?.npi ?? null,
      ...(expert?.institutionId ? { institutionId: expert.institutionId } : {}),
      ...(profile ? { profile } : {}),
    };
  });
  const toInput = (targetKind: string, targetId: string) => (e: ShortlistEvidence): TraceInputEvidence =>
    ({ ...e, sourceKind: e.sourceKind as TraceInputEvidence['sourceKind'], targetKind, targetId });
  const evidence: TraceInputEvidence[] = [
    ...caseExperts.flatMap((x) => x.evidence.map(toInput('expert', x.id))),
    ...items.filter((i) => i.targetKind === 'institution').flatMap((i) => i.evidence.map(toInput(i.targetKind, i.targetId))),
  ];
  return { caseId, diseaseName: found.diseaseName, ...(found.homeState ? { homeState: found.homeState } : {}), experts, evidence };
}
