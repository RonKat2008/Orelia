/**
 * Default wiring for VerificationService: shortlist/plan evidence as the resource source, the case store for the
 * full case record, outreach contacts for the cap, and the selected voice channel (AgentCall with keys, otherwise
 * the mock caller, which completes with a synthetic transcript so offline/demo flows finish).
 * Lazy: nothing touches the database or credentials until a request arrives.
 */
import { chat } from '../ai/chat';
import { hasClaudeCredentials } from '../ai/gateway';
import { MockCaller } from '../channels/mock-caller';
import { resolveMode } from '../env';
import { transcriptToText } from '../channels/agentcall';
import type { CaseRecord, SafetyContact } from '../safety/types';
import type { PlanEvidence, PlanTargetKind } from '../plan/contract';
import { syntheticVerificationTranscript } from './mock-transcript';
import { VerificationService, type VerificationResource } from './service';
import { getVerificationStore } from './store';
import type { VerificationExtractor } from './transcript';

type Env = Record<string, string | undefined>;
const offline = (env: Env) => ['1', 'true'].includes((env.WAYFINDER_OFFLINE ?? '').trim().toLowerCase());

export async function loadVerificationResource(caseId: string, resourceKey: string): Promise<VerificationResource | null> {
  const { getServices } = await import('@/app/api/cases/_lib/services');
  const items = await getServices().persist.getShortlist(caseId);
  const item = items.find(i => `${i.targetKind}:${i.targetId}` === resourceKey);
  if (item) {
    const meta = (await getServices().persist.getShortlistMeta(caseId)).find(m => `${m.targetKind}:${m.targetId}` === resourceKey);
    return {
      name: item.name, targetKind: item.targetKind as PlanTargetKind, targetId: item.targetId, subKind: meta?.organizationKind ?? null,
      evidence: item.evidence.map(e => ({ id: e.id, claimType: e.claimType, claim: e.claim, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind as PlanEvidence['sourceKind'] })),
    };
  }
  const { loadPlanInputs } = await import('../plan/inputs');
  const input = (await loadPlanInputs(caseId)).find(i => `${i.targetKind}:${i.targetId}` === resourceKey);
  return input ? { name: input.name, targetKind: input.targetKind, targetId: input.targetId, subKind: input.subKind ?? null, evidence: input.evidence } : null;
}

export async function loadCaseRecord(caseId: string): Promise<CaseRecord | null> {
  const { getServices } = await import('@/app/api/cases/_lib/services');
  const c = await getServices().cases.get(caseId);
  if (!c) return null;
  const { diseaseName, diseaseCodes, subtype, stageSummary, homeCity, homeState, insurer, planId, travelLimitMiles, goals } = c;
  return { diseaseName, diseaseCodes, subtype, stageSummary, homeCity, homeState, insurer, planId, travelLimitMiles, goals };
}

async function loadContacts(caseId: string, env: Env): Promise<SafetyContact[]> {
  if (!env.DATABASE_URL) return [];
  const { PostgresOutreachStore } = await import('../outreach/postgres-store');
  return new PostgresOutreachStore().contacts(caseId);
}

const defaultExtractor: VerificationExtractor = (messages, signal) => chat({ role: 'verification', messages, ...(signal ? { signal } : {}) });

export async function createVerificationService(env: Env = process.env): Promise<VerificationService> {
  const { selectChannels } = await import('../outreach/channel-wiring');
  const voice = selectChannels(env).channels[1];
  // Synthetic answers only in offline/demo mode: elsewhere a mock call must never produce "verified" badges.
  const simulated = ['offline', 'demo'].includes(resolveMode(env));
  const mock = voice instanceof MockCaller && simulated ? voice : null;
  return new VerificationService({
    store: getVerificationStore(),
    loadResource: loadVerificationResource,
    caseRecord: loadCaseRecord,
    contacts: caseId => loadContacts(caseId, env),
    voice,
    env,
    ...(hasClaudeCredentials() && !offline(env) ? { extractor: defaultExtractor } : {}),
    ...(mock ? {
      simulate: request => {
        const turns = syntheticVerificationTranscript(request);
        if (request.callId) mock.complete(request.callId, transcriptToText(turns));
        return turns;
      },
    } : {}),
  });
}

let cached: Promise<VerificationService> | undefined;
export function getVerificationService(): Promise<VerificationService> {
  cached ??= createVerificationService().catch(err => { cached = undefined; throw err; });
  return cached;
}
