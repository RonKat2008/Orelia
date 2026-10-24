import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client';
import * as s from '../../../db/schema';
import { open, seal } from '../../crypto/token-box';
import type { Appointment } from '../../appointments/schema';
import { eventDescription } from '../../appointments/prep';
import { deleteEvent, eventPayload, freeBusy, insertEvent, patchEvent, suggestFreeSlots } from './calendar';
import { googleConfig, refreshAccess, revokeToken, SCOPE_EVENTS, SCOPE_FREEBUSY, type GoogleConfig, type TokenResponse } from './oauth';

/** One Google connection per viewer. Tokens are sealed with AAD = "google:<ownerKey>" so rows cannot be swapped. */
export interface Connection {
  ownerKey: string;
  scopes: string[];
  refreshTokenSealed: string | null;
  accessTokenSealed: string | null;
  accessExpiresAt: string | null;
  calendarId: string;
  freeBusyOptIn: boolean;
}

export interface ConnectionStore {
  get(ownerKey: string): Promise<Connection | undefined>;
  save(c: Connection): Promise<void>;
  remove(ownerKey: string): Promise<void>;
}

type Env = Record<string, string | undefined>;
const aad = (ownerKey: string) => `google:${ownerKey}`;

export class MemoryConnectionStore implements ConnectionStore {
  rows = new Map<string, Connection>();
  async get(k: string) { const r = this.rows.get(k); return r ? { ...r, scopes: [...r.scopes] } : undefined; }
  async save(c: Connection) { this.rows.set(c.ownerKey, { ...c, scopes: [...c.scopes] }); }
  async remove(k: string) { this.rows.delete(k); }
}

export class PostgresConnectionStore implements ConnectionStore {
  async get(ownerKey: string) {
    const [r] = await getDb().select().from(s.calendarConnections).where(and(eq(s.calendarConnections.ownerKey, ownerKey), eq(s.calendarConnections.provider, 'google'))).limit(1);
    return r ? { ownerKey: r.ownerKey, scopes: r.scopes, refreshTokenSealed: r.refreshTokenSealed, accessTokenSealed: r.accessTokenSealed, accessExpiresAt: r.accessExpiresAt?.toISOString() ?? null, calendarId: r.calendarId, freeBusyOptIn: r.freeBusyOptIn } : undefined;
  }
  async save(c: Connection) {
    const values = { ownerKey: c.ownerKey, provider: 'google', scopes: c.scopes, refreshTokenSealed: c.refreshTokenSealed, accessTokenSealed: c.accessTokenSealed, accessExpiresAt: c.accessExpiresAt ? new Date(c.accessExpiresAt) : null, calendarId: c.calendarId, freeBusyOptIn: c.freeBusyOptIn, updatedAt: new Date() };
    await getDb().insert(s.calendarConnections).values(values).onConflictDoUpdate({ target: [s.calendarConnections.ownerKey, s.calendarConnections.provider], set: values });
  }
  async remove(ownerKey: string) {
    await getDb().delete(s.calendarConnections).where(and(eq(s.calendarConnections.ownerKey, ownerKey), eq(s.calendarConnections.provider, 'google')));
  }
}

const g = globalThis as { __wayfinderConnectionStore?: ConnectionStore };
export function getConnectionStore(): ConnectionStore {
  g.__wayfinderConnectionStore ??= process.env.DATABASE_URL ? new PostgresConnectionStore() : new MemoryConnectionStore();
  return g.__wayfinderConnectionStore;
}

/** Merge a token response into the stored connection (incremental consent keeps the old refresh token if none is returned). */
export function connectionFromTokens(ownerKey: string, tokens: TokenResponse, previous: Connection | undefined, env: Env = process.env): Connection {
  const refresh = tokens.refreshToken ? seal(tokens.refreshToken, aad(ownerKey), env) : previous?.refreshTokenSealed ?? null;
  const scopes = [...new Set([...(previous?.scopes ?? []), ...tokens.scopes])];
  return {
    ownerKey, scopes, refreshTokenSealed: refresh,
    accessTokenSealed: seal(tokens.accessToken, aad(ownerKey), env),
    accessExpiresAt: tokens.expiresAt.toISOString(),
    calendarId: previous?.calendarId ?? 'primary',
    freeBusyOptIn: scopes.includes(SCOPE_FREEBUSY),
  };
}

export interface GoogleDeps { store: ConnectionStore; fetcher?: typeof fetch; env?: Env; now?: () => Date; config?: GoogleConfig | null }

export interface CalendarSync {
  /** Creates or updates the event; returns the event id, or null when the viewer has no connection. */
  upsert(ownerKey: string, appt: Appointment, appUrl?: string): Promise<string | null>;
  remove(ownerKey: string, appt: Appointment): Promise<void>;
  freeTimes(ownerKey: string, timeZone: string): Promise<string[]>;
  disconnect(ownerKey: string): Promise<void>;
}

export function googleSync(deps: GoogleDeps): CalendarSync {
  const env = deps.env ?? process.env;
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? (() => new Date());
  const cfg = deps.config === undefined ? googleConfig(env) : deps.config;

  async function accessToken(c: Connection): Promise<string | null> {
    if (c.accessTokenSealed && c.accessExpiresAt && new Date(c.accessExpiresAt).getTime() - now().getTime() > 60_000) {
      return open(c.accessTokenSealed, aad(c.ownerKey), env);
    }
    if (!cfg || !c.refreshTokenSealed) return null;
    const tokens = await refreshAccess(cfg, open(c.refreshTokenSealed, aad(c.ownerKey), env), fetcher, now());
    await deps.store.save(connectionFromTokens(c.ownerKey, tokens, c, env));
    return tokens.accessToken;
  }
  async function ready(ownerKey: string) {
    const c = await deps.store.get(ownerKey);
    if (!c || !c.scopes.includes(SCOPE_EVENTS)) return null;
    const token = await accessToken(c);
    return token ? { c, token } : null;
  }
  return {
    async upsert(ownerKey, appt, appUrl) {
      const r = await ready(ownerKey);
      if (!r) return null;
      const payload = eventPayload(appt, eventDescription(appt, appUrl ? { appUrl } : {}));
      if (appt.googleEventId) { await patchEvent(fetcher, r.token, r.c.calendarId, appt.googleEventId, payload); return appt.googleEventId; }
      return insertEvent(fetcher, r.token, r.c.calendarId, payload);
    },
    async remove(ownerKey, appt) {
      if (!appt.googleEventId) return;
      const r = await ready(ownerKey);
      if (r) await deleteEvent(fetcher, r.token, r.c.calendarId, appt.googleEventId);
    },
    async freeTimes(ownerKey, timeZone) {
      const c = await deps.store.get(ownerKey);
      if (!c?.freeBusyOptIn || !c.scopes.includes(SCOPE_FREEBUSY)) return [];
      const token = await accessToken(c);
      if (!token) return [];
      const from = now();
      const busy = await freeBusy(fetcher, token, c.calendarId, from, new Date(from.getTime() + 15 * 86400000));
      return suggestFreeSlots(busy, from, timeZone);
    },
    async disconnect(ownerKey) {
      const c = await deps.store.get(ownerKey);
      if (!c) return;
      const sealed = c.refreshTokenSealed ?? c.accessTokenSealed;
      // Revoke at Google best-effort; the local row is deleted regardless.
      if (sealed) { try { await revokeToken(open(sealed, aad(ownerKey), env), fetcher); } catch { /* already revoked or unreachable */ } }
      await deps.store.remove(ownerKey);
    },
  };
}
