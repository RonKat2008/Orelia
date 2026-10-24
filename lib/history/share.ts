/**
 * Share links for the medical-history summary. A link is a signed, expiring token naming a share id; only the
 * share id (never the token) is stored. Revoking sets revokedAt on the row. Organisation only, no interpretation.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { historyShares } from '@/db/schema';
import {
  shareSectionSchema, type HistoryShare, type HistorySummary, type HistoryTimeline, type ShareStore,
} from './contract';
import { buildSummary } from './summary';

type Env = Record<string, string | undefined>;

let devSecret: string | undefined;
let warned = false;

function secret(env: Env): string {
  if (env.WAYFINDER_SHARE_SECRET) return env.WAYFINDER_SHARE_SECRET;
  if (env.WAYFINDER_SESSION_SECRET) {
    return createHmac('sha256', env.WAYFINDER_SESSION_SECRET).update('history-share').digest('base64url');
  }
  if (env.NODE_ENV === 'production') throw new Error('WAYFINDER_SHARE_SECRET (or WAYFINDER_SESSION_SECRET) is required in production');
  if (!warned) {
    warned = true;
    console.warn('[history] No share secret set; using a per-process random secret (share links reset on restart).');
  }
  devSecret ??= randomBytes(32).toString('base64url');
  return devSecret;
}

const sign = (payload: string, key: string) => createHmac('sha256', key).update(payload).digest('base64url');
const payloadSchema = z.object({ sid: z.string().min(1).max(100), exp: z.number().int() }).strict();

export function signShareToken(shareId: string, expiresAt: Date, env: Env = process.env): string {
  const payload = Buffer.from(JSON.stringify({ sid: shareId, exp: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
  return `${payload}.${sign(payload, secret(env))}`;
}

export function verifyShareToken(token: string, now: Date, env: Env = process.env): { shareId: string } | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret(env)));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: z.infer<typeof payloadSchema>;
  try {
    const r = payloadSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!r.success) return null;
    parsed = r.data;
  } catch { return null; }
  if (parsed.exp * 1000 <= now.getTime()) return null;
  return { shareId: parsed.sid };
}

export type ShareStatus = 'active' | 'expired' | 'revoked';
export function shareStatus(share: HistoryShare, now: Date): ShareStatus {
  if (share.revokedAt) return 'revoked';
  return new Date(share.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
}

// ---- Stores ------------------------------------------------------------------------------------------------
export class MemoryShareStore implements ShareStore {
  private readonly rows = new Map<string, HistoryShare>();
  async create(share: HistoryShare) { this.rows.set(share.id, structuredClone(share)); }
  async get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : undefined; }
  async list(caseId: string) {
    return [...this.rows.values()].filter(r => r.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => structuredClone(r));
  }
  async revoke(caseId: string, id: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || r.caseId !== caseId) return undefined;
    if (!r.revokedAt) r.revokedAt = at.toISOString();
    return structuredClone(r);
  }
}

function toShare(row: typeof historyShares.$inferSelect): HistoryShare {
  return {
    id: row.id, caseId: row.caseId, label: row.label,
    sections: row.sections.filter((s): s is HistoryShare['sections'][number] => shareSectionSchema.safeParse(s).success),
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

export class PostgresShareStore implements ShareStore {
  private get db() { return getDb(); }
  async create(share: HistoryShare) {
    await this.db.insert(historyShares).values({
      id: share.id, caseId: share.caseId, sections: share.sections, label: share.label,
      expiresAt: new Date(share.expiresAt), createdAt: new Date(share.createdAt),
    });
  }
  async get(id: string) {
    const [row] = await this.db.select().from(historyShares).where(eq(historyShares.id, id)).limit(1);
    return row ? toShare(row) : undefined;
  }
  async list(caseId: string) {
    const rows = await this.db.select().from(historyShares).where(eq(historyShares.caseId, caseId));
    return rows.map(toShare).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async revoke(caseId: string, id: string, at: Date) {
    const current = await this.db.select().from(historyShares)
      .where(and(eq(historyShares.id, id), eq(historyShares.caseId, caseId))).limit(1);
    if (!current[0]) return undefined;
    if (current[0].revokedAt) return toShare(current[0]);
    const [row] = await this.db.update(historyShares).set({ revokedAt: at })
      .where(and(eq(historyShares.id, id), eq(historyShares.caseId, caseId))).returning();
    return row ? toShare(row) : undefined;
  }
}

const holder = globalThis as { __wayfinderShareStore?: ShareStore };
export function getShareStore(): ShareStore {
  return holder.__wayfinderShareStore ??= process.env.DATABASE_URL && process.env.WAYFINDER_OFFLINE !== '1'
    ? new PostgresShareStore() : new MemoryShareStore();
}
export function setShareStoreForTests(store: ShareStore | undefined) { holder.__wayfinderShareStore = store; }

// ---- Resolve -----------------------------------------------------------------------------------------------
export interface ResolveDeps {
  store?: ShareStore;
  env?: Env;
  loadTimeline?: (caseId: string) => Promise<HistoryTimeline>;
}

async function defaultLoadTimeline(caseId: string): Promise<HistoryTimeline> {
  const [{ getHistoryStore }, { buildTimeline }] = await Promise.all([import('./store'), import('./timeline')]);
  const store = getHistoryStore();
  const [documents, events] = await Promise.all([store.listDocuments(caseId), store.listEvents(caseId)]);
  return buildTimeline(documents, events);
}

/** Returns null for any invalid, tampered, expired or revoked link. Never returns data outside share.sections. */
export async function resolveShare(
  token: string, now: Date, deps: ResolveDeps = {},
): Promise<{ share: HistoryShare; summary: HistorySummary } | null> {
  let verified: { shareId: string } | null;
  try { verified = verifyShareToken(token, now, deps.env ?? process.env); } catch { return null; }
  if (!verified) return null;
  const share = await (deps.store ?? getShareStore()).get(verified.shareId);
  if (!share || shareStatus(share, now) !== 'active') return null;
  const timeline = await (deps.loadTimeline ?? defaultLoadTimeline)(share.caseId);
  return { share, summary: buildSummary(timeline, share.sections, now) };
}
