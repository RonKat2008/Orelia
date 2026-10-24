import { eq } from 'drizzle-orm';
import { getServices } from '@/app/api/cases/_lib/services';
import { getDb } from '@/db/client';
import { cases } from '@/db/schema';
import { isOffline } from '@/lib/env';
import { selectChannels } from '@/lib/outreach/channel-wiring';
import { loadPlanInputs } from '@/lib/plan/inputs';
import type { CaseRecord } from '@/lib/safety/types';
import { ExaClient } from '@/lib/sources/exa';
import { NppesClient } from '@/lib/sources/nppes';
import { FetchTransport } from '@/lib/sources/transport';
import { getCoordinationStore } from '../store';
import { NppesDoctorVerifier } from './doctor-verify';
import { ConsultService, type ConsultDeps, type ConsultEmailChannel } from './service';
import { MemoryConsultTracker, PostgresConsultTracker, type ConsultTracker } from './tracker';

export { ConsultError, ConsultService, stripConsult } from './service';
export type { ConsultDeps, ConsultPatch, NewConsultInput } from './service';

/** Only patient fields go to the privacy scanner (same pick as the outreach store). */
async function caseRecord(caseId: string): Promise<CaseRecord | null> {
  const c = await getServices().cases.get(caseId);
  if (!c) return null;
  const r = c as unknown as Record<string, unknown>;
  const keys = ['diseaseName', 'diseaseCodes', 'subtype', 'stageSummary', 'homeCity', 'homeState', 'insurer', 'planId', 'travelLimitMiles', 'goals'];
  return Object.fromEntries(keys.filter(k => r[k] !== undefined).map(k => [k, r[k]]));
}

/** cases.patient_email (the patient's notification address); never accepted as a doctor email. */
async function patientEmail(caseId: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  const [row] = await getDb().select({ email: cases.patientEmail }).from(cases).where(eq(cases.id, caseId)).limit(1);
  return row?.email ?? null;
}

const g = globalThis as typeof globalThis & { __wayfinderConsultDeps?: ConsultDeps; __wayfinderConsultTracker?: ConsultTracker; __wayfinderConsultEmail?: ConsultEmailChannel };

function defaultDeps(): ConsultDeps {
  const env = process.env;
  const key = env.EXA_API_KEY?.trim();
  g.__wayfinderConsultTracker ??= env.DATABASE_URL ? new PostgresConsultTracker() : new MemoryConsultTracker();
  return {
    store: getCoordinationStore(),
    loadInputs: loadPlanInputs,
    caseRecord,
    tracker: g.__wayfinderConsultTracker,
    // Same email channel selection as outreach: mock offline / without AGENTMAIL_API_KEY; adapters re-check the allowlist.
    email: () => (g.__wayfinderConsultEmail ??= selectChannels(env).channels[0] as ConsultEmailChannel),
    exa: !isOffline(env.WAYFINDER_OFFLINE) && key ? new ExaClient(new FetchTransport(), key) : null,
    env,
    now: () => new Date(),
    // NPPES (public registry, no key). Offline: no verifier, so every doctor stays unverified (standard filter).
    verifier: isOffline(env.WAYFINDER_OFFLINE) ? null : new NppesDoctorVerifier(new NppesClient(new FetchTransport())),
    patientEmail,
  };
}

export function getConsultService(): ConsultService {
  return new ConsultService(g.__wayfinderConsultDeps ?? defaultDeps());
}

export function setConsultDepsForTests(deps: ConsultDeps | undefined): void {
  if (deps) g.__wayfinderConsultDeps = deps; else delete g.__wayfinderConsultDeps;
}
