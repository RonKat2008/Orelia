/**
 * DEMO ONLY: "Run full demo". Seeds the synthetic case + fictional shortlist (seed.ts), gives it to the caller's
 * session, then runs the same service code the normal routes use for selection, consent and plan building.
 * Nothing is approved or sent here: approval stays the patient's one "Approve all" (approve-all.ts), which calls the
 * normal approval routes, so checkOutbound runs on every send.
 *
 * When lane F's agent factory is present (lib/agents/factory), its agents are spawned after plan approval by the
 * factory itself; this module does not depend on it.
 */
import { getOwnerStore } from '../auth/ownership';
import { DEMO_CONSENT_FIELDS, seedLiveDemoCase, type SeededDemoCase } from './seed';
import { demoDestinationsEnabled } from '../outreach/demo-destinations';

type Env = Record<string, string | undefined>;

export class LiveDemoDisabledError extends Error {
  readonly status = 404;
  constructor() { super('Not found'); }
}

/** The live demo needs demo destinations (so nothing can reach a real resource) and a database. */
export function liveDemoEnabled(env: Env): boolean {
  return demoDestinationsEnabled(env) && Boolean(env.DATABASE_URL);
}

export interface LiveDemoStart extends SeededDemoCase {
  contacts: { contactId: string; channel: string; targetId: string }[];
  unavailable: { candidateId: string; reason: string }[];
  plan: { version: number; status: string; rules: string[] } | null;
}

export async function startLiveDemo(opts: { env: Env; sessionId: string; now?: Date }): Promise<LiveDemoStart> {
  if (!liveDemoEnabled(opts.env)) throw new LiveDemoDisabledError();
  const seeded = await seedLiveDemoCase({ env: opts.env, now: opts.now });
  await getOwnerStore().setOwner(seeded.caseId, opts.sessionId);

  const [{ getOutreachService }, { loadPlanInputs }, { buildContactPlan }, { getPlanStore }, { validatePlanAgainstInputs }] = await Promise.all([
    import('../outreach/server'),
    import('../plan/inputs'),
    import('../plan'),
    import('../plan/store'),
    import('../plan/validate'),
  ]);
  const service = getOutreachService();
  const selected = await service.select(seeded.caseId, seeded.candidates.map((c) => c.candidateId));
  for (const contact of selected.contacts) await service.consent(contact.id, [...DEMO_CONSENT_FIELDS]);

  const inputs = await loadPlanInputs(seeded.caseId);
  const built = await buildContactPlan(seeded.caseId, inputs, { now: opts.now ?? new Date(), llm: false });
  const problems = validatePlanAgainstInputs(built, inputs);
  const saved = problems.length ? null : await getPlanStore().save(built, 0);
  if (problems.length) console.error('[demo-live] plan failed validation', problems.length);
  return {
    ...seeded,
    contacts: selected.contacts.map((c) => ({ contactId: c.id, channel: c.channel, targetId: c.targetId })),
    unavailable: selected.unavailable.map((u) => ({ candidateId: u.candidateId, reason: u.reason })),
    plan: saved ? { version: saved.version, status: saved.status, rules: saved.resources.map((r) => r.rule) } : null,
  };
}
