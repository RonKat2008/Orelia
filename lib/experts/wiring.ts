import { getServices } from '@/app/api/cases/_lib/services';
import { MemoryPersist } from '@/lib/agents/persist';
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

/** The case's shortlisted experts and institutions with their verified evidence (read-only). */
export async function loadTraceInput(caseId: string): Promise<TraceInput | null> {
  const { cases, persist } = getServices();
  const found = await cases.get(caseId);
  if (!found) return null;
  const items = await persist.getShortlist(caseId);
  const resources = persist instanceof MemoryPersist ? persist.resources : undefined;
  const experts: TraceExpert[] = items.filter((i) => i.targetKind === 'expert').map((i) => {
    const r = resources?.get(i.targetId);
    const expert = r?.kind === 'expert' ? r : undefined;
    return {
      id: i.targetId, name: i.name, npi: expert?.npi ?? null,
      ...(expert?.institutionId ? { institutionId: expert.institutionId } : {}),
      ...(expert?.profile ? { profile: expert.profile } : {}),
    };
  });
  const evidence: TraceInputEvidence[] = items
    .filter((i) => i.targetKind === 'expert' || i.targetKind === 'institution')
    .flatMap((i) => i.evidence.map((e) => ({ ...e, sourceKind: e.sourceKind as TraceInputEvidence['sourceKind'], targetKind: i.targetKind, targetId: i.targetId })));
  return { caseId, diseaseName: found.diseaseName, ...(found.homeState ? { homeState: found.homeState } : {}), experts, evidence };
}
