import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contacts, tasks } from '@/db/schema';
import { loadPlanInputs } from '@/lib/plan/inputs';
import { getCoordinationStore } from './store';
import type { BoardContact, BoardDeps, BoardTask } from './board';

const keyOf = (c: { targetKind: string; targetId: string }) => `${c.targetKind}:${c.targetId}`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function loadContacts(caseId: string): Promise<BoardContact[]> {
  if (!process.env.DATABASE_URL) return [];
  const rows = await getDb().select({
    id: contacts.id, targetKind: contacts.targetKind, targetId: contacts.targetId, state: contacts.state, nextFollowUpAt: contacts.nextFollowUpAt,
  }).from(contacts).where(eq(contacts.caseId, caseId));
  return rows.map(r => ({ id: r.id, resourceKey: keyOf(r), state: r.state, nextFollowUpAt: iso(r.nextFollowUpAt) }));
}

async function loadTasks(caseId: string): Promise<BoardTask[]> {
  if (!process.env.DATABASE_URL) return [];
  const [rows, cs] = await Promise.all([
    getDb().select().from(tasks).where(eq(tasks.caseId, caseId)),
    loadContacts(caseId),
  ]);
  const byContact = new Map(cs.map(c => [c.id, c.resourceKey]));
  return rows.map(t => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, dueAt: iso(t.dueAt), resourceKey: byContact.get(t.contactId) ?? null }));
}

export function defaultBoardDeps(): BoardDeps {
  return {
    store: getCoordinationStore(),
    now: () => new Date(),
    names: async caseId => {
      try { return Object.fromEntries((await loadPlanInputs(caseId)).map(i => [`${i.targetKind}:${i.targetId}`, i.name])); } catch { return {}; }
    },
    contacts: loadContacts,
    tasks: loadTasks,
  };
}

const holder = globalThis as unknown as { __wayfinderBoardDeps?: BoardDeps };
export function getBoardDeps(): BoardDeps { return holder.__wayfinderBoardDeps ?? defaultBoardDeps(); }
export function setBoardDepsForTests(deps: BoardDeps | undefined): void {
  if (deps) holder.__wayfinderBoardDeps = deps; else delete holder.__wayfinderBoardDeps;
}
