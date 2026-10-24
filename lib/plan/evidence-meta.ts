/**
 * Display metadata for the evidence rows a plan cites: the source site's hostname and what kind of source it is,
 * so the plan can say "mayoclinic.org" or "NPI registry" instead of an opaque id. Pure; built from the plan inputs.
 */
import type { ContactPlan, PlanResourceInput } from './contract';

export interface EvidenceMeta {
  /** Hostname without "www.", or null when the source URL is not a URL. */
  host: string | null;
  sourceKind: string;
  /** Short human label: the registry name for registries, otherwise the hostname. */
  label: string;
}

export type PlanEvidenceMeta = Record<string, EvidenceMeta>;

const REGISTRY_LABELS: Record<string, string> = {
  nppes: 'NPI registry',
  ctgov: 'ClinicalTrials.gov',
  pubmed: 'PubMed',
  nci: 'NCI',
  phone_call: 'Phone call',
};

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function evidenceMetaFor(sourceUrl: string, sourceKind: string): EvidenceMeta {
  const host = hostOf(sourceUrl);
  const registry = REGISTRY_LABELS[sourceKind];
  return { host, sourceKind, label: registry ?? host ?? 'Source page' };
}

/** Metadata for every evidence id a plan step cites, looked up in that resource's own inputs. */
export function planEvidenceMeta(plan: ContactPlan, inputs: readonly PlanResourceInput[]): PlanEvidenceMeta {
  const out: PlanEvidenceMeta = {};
  for (const resource of plan.resources) {
    const input = inputs.find(i => `${i.targetKind}:${i.targetId}` === resource.resourceKey);
    if (!input) continue;
    for (const step of resource.steps) {
      for (const id of step.evidenceIds) {
        const row = input.evidence.find(e => e.id === id);
        if (row && !out[id]) out[id] = evidenceMetaFor(row.sourceUrl, row.sourceKind);
      }
    }
  }
  return out;
}
