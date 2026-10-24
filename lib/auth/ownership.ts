import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cases, contacts, tasks } from "@/db/schema";
import { demoEnabled } from "@/app/api/demo/lib/guard";
import { rejectCrossOrigin } from "./origin";
import { readSession } from "./session";
import { currentAccount } from "@/lib/accounts/current";

export interface OwnerStore {
  /** undefined = no such case; null = case exists without an owner. */
  ownerOf(caseId: string): Promise<string | null | undefined>;
  setOwner(caseId: string, sessionId: string): Promise<void>;
  caseIdForContact(contactId: string): Promise<string | undefined>;
  caseIdForTask(taskId: string): Promise<string | undefined>;
  /** Accounts lane. undefined = no such case; null = anonymous case. Optional so older ports keep working. */
  accountOf?(caseId: string): Promise<string | null | undefined>;
  setAccount?(caseId: string, accountId: string): Promise<void>;
  /** Attaches this browser session's unclaimed cases to the account; returns how many. */
  claimSessionCases?(sessionId: string, accountId: string): Promise<number>;
  casesForAccount?(accountId: string): Promise<string[]>;
}

export class MemoryOwnerStore implements OwnerStore {
  private owners = new Map<string, string | null>();
  private accounts = new Map<string, string | null>();
  private contactCase = new Map<string, string>();
  private taskCase = new Map<string, string>();

  async ownerOf(caseId: string) {
    return this.owners.get(caseId);
  }
  async setOwner(caseId: string, sessionId: string) {
    this.owners.set(caseId, sessionId);
  }
  async caseIdForContact(contactId: string) {
    return this.contactCase.get(contactId);
  }
  async caseIdForTask(taskId: string) {
    return this.taskCase.get(taskId);
  }
  async accountOf(caseId: string) {
    return this.owners.has(caseId) ? (this.accounts.get(caseId) ?? null) : undefined;
  }
  async setAccount(caseId: string, accountId: string) {
    this.accounts.set(caseId, accountId);
  }
  async claimSessionCases(sessionId: string, accountId: string) {
    let n = 0;
    for (const [caseId, owner] of this.owners) {
      if (owner === sessionId && !this.accounts.get(caseId)) { this.accounts.set(caseId, accountId); n++; }
    }
    return n;
  }
  async casesForAccount(accountId: string) {
    return [...this.accounts].filter(([, a]) => a === accountId).map(([caseId]) => caseId);
  }
  /** Test/dev helpers to register relationships. */
  registerCase(caseId: string, owner: string | null = null, accountId: string | null = null) {
    this.owners.set(caseId, owner);
    this.accounts.set(caseId, accountId);
  }
  registerContact(contactId: string, caseId: string) {
    this.contactCase.set(contactId, caseId);
  }
  registerTask(taskId: string, caseId: string) {
    this.taskCase.set(taskId, caseId);
  }
}

export class PostgresOwnerStore implements OwnerStore {
  async ownerOf(caseId: string) {
    const [row] = await getDb().select({ owner: cases.ownerSessionId }).from(cases).where(eq(cases.id, caseId)).limit(1);
    return row ? row.owner : undefined;
  }
  async setOwner(caseId: string, sessionId: string) {
    await getDb().update(cases).set({ ownerSessionId: sessionId }).where(eq(cases.id, caseId));
  }
  async accountOf(caseId: string) {
    const [row] = await getDb().select({ account: cases.accountId }).from(cases).where(eq(cases.id, caseId)).limit(1);
    return row ? row.account : undefined;
  }
  async setAccount(caseId: string, accountId: string) {
    await getDb().update(cases).set({ accountId }).where(eq(cases.id, caseId));
  }
  async claimSessionCases(sessionId: string, accountId: string) {
    const rows = await getDb().update(cases).set({ accountId })
      .where(and(eq(cases.ownerSessionId, sessionId), isNull(cases.accountId))).returning({ id: cases.id });
    return rows.length;
  }
  async casesForAccount(accountId: string) {
    return (await getDb().select({ id: cases.id }).from(cases).where(eq(cases.accountId, accountId))).map(r => r.id);
  }
  async caseIdForContact(contactId: string) {
    const [row] = await getDb().select({ caseId: contacts.caseId }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    return row?.caseId;
  }
  async caseIdForTask(taskId: string) {
    const [row] = await getDb()
      .select({ direct: tasks.caseId, viaContact: contacts.caseId })
      .from(tasks)
      .leftJoin(contacts, eq(tasks.contactId, contacts.id))
      .where(eq(tasks.id, taskId))
      .limit(1);
    return row ? (row.direct ?? row.viaContact ?? undefined) : undefined;
  }
}

const g = globalThis as { __wayfinderOwnerStore?: OwnerStore };

export function getOwnerStore(): OwnerStore {
  g.__wayfinderOwnerStore ??= process.env.DATABASE_URL ? new PostgresOwnerStore() : new MemoryOwnerStore();
  return g.__wayfinderOwnerStore;
}

/** Unowned (legacy/demo-seeded) cases are accessible only when the demo switch is on. */
export function canAccess(
  owner: string | null | undefined,
  sessionId: string | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (owner === undefined) return false;
  if (owner === null) return demoEnabled(env);
  return sessionId !== null && owner === sessionId;
}

/**
 * Case access with accounts. An account-owned case opens for that account (from any browser) or, while nobody is
 * signed in, for the legacy anonymous session that created it. Another signed-in account never gets in, even with
 * the old session cookie. Anonymous cases keep the session rule (and the demo rule for unowned seeded cases).
 */
export function canAccessCase(
  input: { owner: string | null | undefined; caseAccount: string | null | undefined; sessionId: string | null; accountId: string | null },
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (input.owner === undefined) return false;
  if (input.caseAccount) {
    if (input.accountId) return input.accountId === input.caseAccount;
    return input.sessionId !== null && input.owner === input.sessionId;
  }
  return canAccess(input.owner, input.sessionId, env);
}

export type OwnerResult = { ok: true; sessionId: string | null; accountId?: string | null } | { ok: false; response: Response };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (): OwnerResult => ({ ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) });

async function check(req: Request, caseId: string | undefined): Promise<OwnerResult> {
  if (!caseId || !UUID.test(caseId)) return notFound();
  const sessionId = readSession(req);
  const store = getOwnerStore();
  const [owner, caseAccount] = await Promise.all([store.ownerOf(caseId), store.accountOf?.(caseId) ?? Promise.resolve(null)]);
  if (owner === undefined) return notFound();
  const account = await currentAccount(req);
  const accountId = account?.id ?? null;
  if (!canAccessCase({ owner, caseAccount, sessionId, accountId })) return notFound();
  return { ok: true, sessionId, accountId };
}

export const requireCaseOwner = (req: Request, caseId: string) => check(req, caseId);
export async function requireContactOwner(req: Request, contactId: string) {
  return check(req, await getOwnerStore().caseIdForContact(contactId));
}
export async function requireTaskOwner(req: Request, taskId: string) {
  return check(req, await getOwnerStore().caseIdForTask(taskId));
}

/** Route guards: CSRF first (state-changing methods only), then ownership. Return a Response to short-circuit. */
export async function guardCase(req: Request, caseId: string): Promise<Response | null> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const r = await requireCaseOwner(req, caseId);
  return r.ok ? null : r.response;
}
export async function guardContact(req: Request, contactId: string): Promise<Response | null> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const r = await requireContactOwner(req, contactId);
  return r.ok ? null : r.response;
}
export async function guardTask(req: Request, taskId: string): Promise<Response | null> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const r = await requireTaskOwner(req, taskId);
  return r.ok ? null : r.response;
}
