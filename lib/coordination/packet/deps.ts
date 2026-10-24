import { loadPlanInputs } from '@/lib/plan/inputs';
import type { PlanResourceInput } from '@/lib/plan/contract';
import { PostgresOutreachStore } from '@/lib/outreach/postgres-store';
import type { OutreachStore } from '@/lib/outreach/types';
import { getCoordinationStore } from '../store';
import type { CoordinationStore } from '../contract';
import { getHistorySource, type HistorySource } from './history';

export interface PacketDeps {
  store: CoordinationStore;
  history: HistorySource;
  /** Selected resources (lib/plan/inputs loadPlanInputs). */
  inputs(caseId: string): Promise<PlanResourceInput[]>;
  outreach: Pick<OutreachStore, 'contact' | 'consent' | 'pendingDraft' | 'updateDraftBody'>;
  now(): Date;
}

const holder = globalThis as unknown as { __wayfinderPacketDeps?: PacketDeps };

export function getPacketDeps(): PacketDeps {
  return holder.__wayfinderPacketDeps ?? {
    store: getCoordinationStore(),
    history: getHistorySource(),
    inputs: loadPlanInputs,
    outreach: new PostgresOutreachStore(),
    now: () => new Date(),
  };
}

export function setPacketDepsForTests(deps: PacketDeps | undefined): void {
  if (deps) holder.__wayfinderPacketDeps = deps;
  else delete holder.__wayfinderPacketDeps;
}
