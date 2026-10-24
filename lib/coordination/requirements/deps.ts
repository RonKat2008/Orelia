import { isOffline } from '@/lib/env';
import { getDocumentStore } from '@/lib/case-docs';
import { ExaClient, type ExaPage } from '@/lib/sources/exa';
import { FetchTransport } from '@/lib/sources/transport';
import type { PageField } from '@/lib/channels/browser-types';
import type { PatientDoc } from './match';

export interface ExaSearcher { search(query: string, options?: { numResults?: number }): Promise<{ records: ExaPage[] }> }
export type FormProbe = (url: string) => Promise<{ fields: readonly PageField[] }>;

export interface RequirementsDeps {
  /** Null when offline or no EXA key. */
  exa: ExaSearcher | null;
  /** Kernel probeForm adapter; null when not configured. Never fills or submits. */
  probe: FormProbe | null;
  offline: boolean;
  now: () => Date;
  /** The patient's own documents: case-docs metadata plus the history lane, when present. */
  listDocs: (caseId: string) => Promise<PatientDoc[]>;
}

/** History-lane adapter. lib/history is not on main yet: returns nothing until that lane lands and wires this in. */
export type HistoryLister = (caseId: string) => Promise<PatientDoc[]>;
export const noHistory: HistoryLister = async () => [];

export function docsLister(history: HistoryLister = noHistory): RequirementsDeps['listDocs'] {
  return async (caseId) => {
    const [docs, hist] = await Promise.all([getDocumentStore().list(caseId), history(caseId).catch(() => [])]);
    const seen = new Set<string>();
    return [...docs.map(d => ({ id: d.id, title: d.title, kind: d.kind as string })), ...hist]
      .filter(d => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  };
}

export function defaultDeps(): RequirementsDeps {
  const offline = isOffline(process.env.WAYFINDER_OFFLINE);
  const key = process.env.EXA_API_KEY?.trim();
  return {
    exa: !offline && key ? new ExaClient(new FetchTransport(), key) : null,
    probe: null,
    offline,
    now: () => new Date(),
    listDocs: docsLister(),
  };
}

const g = globalThis as typeof globalThis & { __wayfinderRequirementsDeps?: RequirementsDeps };
export function getRequirementsDeps(): RequirementsDeps { return g.__wayfinderRequirementsDeps ?? defaultDeps(); }
export function setRequirementsDepsForTests(deps: RequirementsDeps | undefined): void {
  if (deps) g.__wayfinderRequirementsDeps = deps; else delete g.__wayfinderRequirementsDeps;
}
