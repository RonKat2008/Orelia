import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { caseCandidates, contacts, evidence, experts, institutions, organizations, trials } from '@/db/schema';
import { getServices } from '@/app/api/cases/_lib/services';
import { demoCoordinatorEvidence } from './contact-points';
import { isDemoCoordinatorAddress } from '../outreach/demo-coordinators';
import type { PlanEvidence, PlanResourceInput, PlanTargetKind } from './contract';

export interface PlanInputLoader {
  load(caseId: string): Promise<PlanResourceInput[]>;
}

interface Target { targetKind: PlanTargetKind; targetId: string; contactId: string | null; address?: string }
const keyOf = (t: { targetKind: string; targetId: string }) => `${t.targetKind}:${t.targetId}`;

/** Selected resources: contacts rows (created on selection) plus case_candidates.selected, deduped by target. */
export class PostgresPlanInputLoader implements PlanInputLoader {
  private get db() { return getDb(); }

  async load(caseId: string): Promise<PlanResourceInput[]> {
    const [contactRows, candidateRows] = await Promise.all([
      this.db.select({ id: contacts.id, targetKind: contacts.targetKind, targetId: contacts.targetId, address: contacts.address })
        .from(contacts).where(eq(contacts.caseId, caseId)),
      this.db.select({ targetKind: caseCandidates.targetKind, targetId: caseCandidates.targetId, rank: caseCandidates.rank })
        .from(caseCandidates).where(and(eq(caseCandidates.caseId, caseId), eq(caseCandidates.selected, true))),
    ]);
    const byKey = new Map<string, Target>();
    for (const c of contactRows) if (!byKey.has(keyOf(c))) byKey.set(keyOf(c), { targetKind: c.targetKind, targetId: c.targetId, contactId: c.id, address: c.address });
    for (const c of [...candidateRows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))) {
      if (!byKey.has(keyOf(c))) byKey.set(keyOf(c), { targetKind: c.targetKind, targetId: c.targetId, contactId: null });
    }
    const targets = [...byKey.values()];
    return Promise.all(targets.map(async (t) => {
      const [meta, rows] = await Promise.all([this.meta(t), this.db.select().from(evidence)
        .where(and(eq(evidence.caseId, caseId), eq(evidence.targetKind, t.targetKind), eq(evidence.targetId, t.targetId)))]);
      const ev: PlanEvidence[] = rows.map(r => ({ id: r.id, claimType: r.claimType, claim: r.claim, sourceUrl: r.sourceUrl, sourceKind: r.sourceKind }));
      // Demo coordinator mode: a contact mapped to a demo inbox gets a code-stamped email point for that inbox.
      if (t.contactId && isDemoCoordinatorAddress(t.address, process.env)) ev.push(demoCoordinatorEvidence(t.contactId, t.address!.trim().toLowerCase()));
      const { address: _address, ...target } = t;
      return { ...target, name: meta.name ?? t.targetId, subKind: meta.subKind, evidence: ev };
    }));
  }

  private async meta(t: Target): Promise<{ name: string | null; subKind: string | null }> {
    const db = this.db;
    if (t.targetKind === 'organization') {
      const [r] = await db.select({ name: organizations.name, kind: organizations.kind }).from(organizations).where(eq(organizations.id, t.targetId));
      return { name: r?.name ?? null, subKind: r?.kind ?? null };
    }
    if (t.targetKind === 'institution') {
      const [r] = await db.select({ name: institutions.name, kind: institutions.kind }).from(institutions).where(eq(institutions.id, t.targetId));
      return { name: r?.name ?? null, subKind: r?.kind ?? null };
    }
    if (t.targetKind === 'expert') {
      const [r] = await db.select({ name: experts.name }).from(experts).where(eq(experts.id, t.targetId));
      return { name: r?.name ?? null, subKind: null };
    }
    const [r] = await db.select({ name: trials.title }).from(trials).where(eq(trials.id, t.targetId));
    return { name: r?.name ?? null, subKind: null };
  }
}

/** Memory/demo mode: shortlist items flagged selected (outreach selection is Postgres-only, so this is usually empty). */
export class MemoryPlanInputLoader implements PlanInputLoader {
  async load(caseId: string): Promise<PlanResourceInput[]> {
    const items = await getServices().persist.getShortlist(caseId);
    return items.filter(i => i.selected).map(i => ({
      targetKind: i.targetKind,
      targetId: i.targetId,
      name: i.name,
      contactId: null,
      subKind: null,
      evidence: i.evidence.map(e => ({ id: e.id, claimType: e.claimType, claim: e.claim, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind as PlanEvidence['sourceKind'] })),
    }));
  }
}

const g = globalThis as unknown as { __wayfinderPlanInputLoader?: PlanInputLoader };

export function getPlanInputLoader(): PlanInputLoader {
  g.__wayfinderPlanInputLoader ??= process.env.DATABASE_URL ? new PostgresPlanInputLoader() : new MemoryPlanInputLoader();
  return g.__wayfinderPlanInputLoader;
}

export function setPlanInputLoaderForTests(loader: PlanInputLoader | undefined): void {
  if (loader) g.__wayfinderPlanInputLoader = loader;
  else delete g.__wayfinderPlanInputLoader;
}

export async function loadPlanInputs(caseId: string): Promise<PlanResourceInput[]> {
  return getPlanInputLoader().load(caseId);
}
