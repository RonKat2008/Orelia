/**
 * DEMO ONLY: the one-click live demo case.
 *
 * A synthetic vascular EDS patient (fixtures/reports/expected/vascular-eds.json) with four FICTIONAL resources whose
 * contact points are chosen so the contact plan uses every channel:
 *   1. email only           -> the demo coordinator answers "please send records" (records card)
 *   2. call only            -> the allowlisted test phone, or the simulated call sink
 *   3. online form only     -> Kernel fills Wayfinder's own demo intake form
 *   4. email, then call     -> the email is left unanswered, so the follow-up fires after simulated time
 * The resources are fictional on purpose: even if demo routing were off, their addresses (.example domains, 555-01xx
 * numbers) cannot reach anyone. With demo mode on, delivery is swapped for our own test destinations
 * (lib/outreach/demo-destinations.ts) and every send still needs the patient's approval and checkOutbound.
 *
 * This only writes the case and its shortlist. Selection, consent, plan and approval go through the normal routes.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/client';
import { caseCandidates, cases, evidence, institutions, organizations } from '../../db/schema';
import { buildDemoCase } from '../../scripts/demo/seed-case';
import { appBaseUrl } from '../outreach/demo-destinations';

type Env = Record<string, string | undefined>;

export const DEMO_LIVE_FIXTURE = 'vascular-eds';
/** Fields the demo pre-ticks for consent (the patient can still change them on the consent page). */
export const DEMO_CONSENT_FIELDS = ['diseaseName', 'subtype', 'homeState', 'goals'] as const;

export type DemoResourceRole = 'email' | 'call' | 'web_form' | 'email_then_call';

export interface DemoResourceSpec {
  role: DemoResourceRole;
  targetKind: 'institution' | 'organization';
  name: string;
  kind: string;
  city: string;
  state: string;
  email?: string;
  phone?: string;
  formPath?: string;
  /** What the demo shows this resource for (patient-safe, no medical advice). */
  summary: string;
}

/** Fictional only. `.example` domains and 555-01xx numbers are reserved and route nowhere. */
export const DEMO_RESOURCES: readonly DemoResourceSpec[] = [
  {
    role: 'email', targetKind: 'institution', kind: 'rare_disease_center', name: 'Demo Connective Tissue Center (fictional)',
    city: 'Columbus', state: 'OH', email: 'intake@connective-demo-center.example',
    summary: 'Fictional demo clinic that sees adults with connective tissue disorders. Its intake desk answers by email.',
  },
  {
    role: 'call', targetKind: 'institution', kind: 'hospital', name: 'Demo Vascular Genetics Clinic (fictional)',
    city: 'Cleveland', state: 'OH', phone: '+12025550142',
    summary: 'Fictional demo clinic reachable only by phone. A short AI call (with disclosure first) asks how to get seen.',
  },
  {
    role: 'web_form', targetKind: 'organization', kind: 'travel_aid', name: 'Demo Rare Travel Fund (fictional)',
    city: 'Cincinnati', state: 'OH', formPath: '/demo/apply',
    summary: 'Fictional travel-aid fund that only takes applications through an online form.',
  },
  {
    role: 'email_then_call', targetKind: 'institution', kind: 'rare_disease_center', name: 'Demo Aortic Care Program (fictional)',
    city: 'Pittsburgh', state: 'PA', email: 'newpatients@aortic-demo-program.example', phone: '+12025550143',
    summary: 'Fictional program with an email and a phone line: email first, then a call if no reply.',
  },
];

export interface SeededDemoCase {
  caseId: string;
  candidates: { candidateId: string; role: DemoResourceRole; targetKind: string; targetId: string; name: string }[];
}

function contactPointRows(caseId: string, spec: DemoResourceSpec, targetId: string, env: Env, now: Date) {
  const sourceUrl = `${appBaseUrl(env)}/demo`;
  const base = { caseId, targetKind: spec.targetKind, targetId, sourceKind: 'exa' as const, fetchedAt: now };
  const rows = [
    { ...base, id: randomUUID(), claimType: 'fictional_demo_resource', claim: spec.summary, sourceUrl },
  ];
  if (spec.email) rows.push({ ...base, id: randomUUID(), claimType: 'contact_point.email.new_patient_line', claim: spec.email, sourceUrl });
  if (spec.phone) rows.push({ ...base, id: randomUUID(), claimType: 'contact_point.voice.new_patient_line', claim: spec.phone, sourceUrl });
  if (spec.formPath) {
    rows.push({ ...base, id: randomUUID(), claimType: 'contact_point.web_form.application_form', claim: `${appBaseUrl(env)}${spec.formPath}`, sourceUrl });
  }
  return rows;
}

/** Creates the synthetic case (status ready) and its four fictional shortlist entries. Sends nothing. */
export async function seedLiveDemoCase(opts: { env: Env; now?: Date }): Promise<SeededDemoCase> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const input = buildDemoCase(DEMO_LIVE_FIXTURE);
  const [row] = await db.insert(cases).values({ ...input, status: 'ready' }).returning({ id: cases.id });
  const caseId = row!.id;
  const out: SeededDemoCase['candidates'] = [];
  for (const [i, spec] of DEMO_RESOURCES.entries()) {
    const targetId = randomUUID();
    if (spec.targetKind === 'institution') {
      await db.insert(institutions).values({
        id: targetId, name: spec.name, kind: spec.kind as 'hospital', city: spec.city, state: spec.state,
        intakeContact: spec.email ?? spec.phone ?? null,
      });
    } else {
      await db.insert(organizations).values({ id: targetId, name: spec.name, kind: spec.kind as 'travel_aid', url: `${appBaseUrl(opts.env)}/demo` });
    }
    await db.insert(evidence).values(contactPointRows(caseId, spec, targetId, opts.env, now));
    const [cand] = await db.insert(caseCandidates).values({
      caseId, targetKind: spec.targetKind, targetId, rank: i + 1, score: 90 - i * 5, tier: 'best',
      scoreBreakdown: [{ factor: 'demo', points: 90 - i * 5, text: 'Fictional demo resource chosen to exercise this channel.', evidenceIds: [] }],
    }).returning({ id: caseCandidates.id });
    out.push({ candidateId: cand!.id, role: spec.role, targetKind: spec.targetKind, targetId, name: spec.name });
  }
  return { caseId, candidates: out };
}
