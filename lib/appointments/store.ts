import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';
import type { FeedRow } from './feed';
import { candidateSlotSchema, prepNotesSchema, type Appointment, type AppointmentKind, type AppointmentSource, type AppointmentStatus } from './schema';
import { accountIdFromKey } from '../auth/viewer';

export type NewAppointment = Omit<Appointment, 'id' | 'createdAt' | 'updatedAt' | 'remindedAt' | 'googleEventId' | 'requestMessageId' | 'sequence'> & { id?: string };
export type AppointmentPatch = Partial<Pick<Appointment,
  'kind' | 'title' | 'startsAt' | 'endsAt' | 'timezone' | 'location' | 'telehealthUrl' | 'phone' | 'withWhom' | 'status' |
  'prepNotes' | 'remindedAt' | 'googleEventId' | 'requestMessageId' | 'candidates'>>;

export interface AppointmentStore {
  get(id: string): Promise<Appointment | undefined>;
  listForCase(caseId: string): Promise<Appointment[]>;
  /** Appointments on every case the owner key owns. */
  listForOwner(ownerKey: string): Promise<Appointment[]>;
  /** Inserts unless (caseId, sourceMessageId) already exists; returns the stored row either way. */
  insert(row: NewAppointment): Promise<{ appointment: Appointment; created: boolean }>;
  /** Compare-and-set on status when `expect` is given; bumps sequence. Undefined when the row or status did not match. */
  update(id: string, patch: AppointmentPatch, expect?: AppointmentStatus[]): Promise<Appointment | undefined>;
  /** Confirmed appointments starting in (now, now + withinMs] that have not been reminded. */
  dueReminders(now: Date, withinMs: number): Promise<Appointment[]>;
  /** Owner key of a case (null when unowned, undefined when missing). */
  caseOwner(caseId: string): Promise<string | null | undefined>;
  createFeed(ownerKey: string): Promise<FeedRow>;
  feed(id: string): Promise<FeedRow | undefined>;
  feeds(ownerKey: string): Promise<FeedRow[]>;
  revokeFeed(id: string, ownerKey: string, at: Date): Promise<boolean>;
  touchFeed(id: string, at: Date): Promise<void>;
}

const nowIso = () => new Date().toISOString();

export class MemoryAppointmentStore implements AppointmentStore {
  rows = new Map<string, Appointment>();
  owners = new Map<string, string | null>();
  feedRows = new Map<string, FeedRow>();
  async get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : undefined; }
  async listForCase(caseId: string) { return this.sorted([...this.rows.values()].filter(r => r.caseId === caseId)); }
  async listForOwner(ownerKey: string) {
    return this.sorted([...this.rows.values()].filter(r => this.owners.get(r.caseId) === ownerKey));
  }
  private sorted(rows: Appointment[]) {
    return rows.map(r => structuredClone(r)).sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
  }
  async insert(row: NewAppointment) {
    const existing = row.sourceMessageId ? [...this.rows.values()].find(r => r.caseId === row.caseId && r.sourceMessageId === row.sourceMessageId) : undefined;
    if (existing) return { appointment: structuredClone(existing), created: false };
    const at = nowIso();
    const appointment: Appointment = { ...structuredClone(row), id: row.id ?? crypto.randomUUID(), createdAt: at, updatedAt: at, remindedAt: null, googleEventId: null, requestMessageId: null, sequence: 0 };
    this.rows.set(appointment.id, appointment);
    return { appointment: structuredClone(appointment), created: true };
  }
  async update(id: string, patch: AppointmentPatch, expect?: AppointmentStatus[]) {
    const r = this.rows.get(id);
    if (!r || (expect && !expect.includes(r.status))) return undefined;
    const next: Appointment = { ...r, ...structuredClone(patch), sequence: r.sequence + 1, updatedAt: nowIso() };
    this.rows.set(id, next);
    return structuredClone(next);
  }
  async dueReminders(now: Date, withinMs: number) {
    const t = now.getTime();
    return [...this.rows.values()].filter(r => r.status === 'confirmed' && !r.remindedAt && r.startsAt && new Date(r.startsAt).getTime() > t && new Date(r.startsAt).getTime() <= t + withinMs).map(r => structuredClone(r));
  }
  async caseOwner(caseId: string) { return this.owners.get(caseId); }
  async createFeed(ownerKey: string) {
    const row: FeedRow = { id: crypto.randomUUID(), ownerKey, revokedAt: null, createdAt: nowIso() };
    this.feedRows.set(row.id, row);
    return { ...row };
  }
  async feed(id: string) { const r = this.feedRows.get(id); return r ? { ...r } : undefined; }
  async feeds(ownerKey: string) { return [...this.feedRows.values()].filter(f => f.ownerKey === ownerKey).map(f => ({ ...f })); }
  async revokeFeed(id: string, ownerKey: string, at: Date) {
    const r = this.feedRows.get(id);
    if (!r || r.ownerKey !== ownerKey || r.revokedAt) return false;
    r.revokedAt = at.toISOString();
    return true;
  }
  async touchFeed() { /* no-op in memory */ }
}

type Row = typeof s.appointments.$inferSelect;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function rowToAppointment(r: Row): Appointment {
  const candidates = Array.isArray(r.candidates) ? r.candidates.flatMap(c => { const p = candidateSlotSchema.safeParse(c); return p.success ? [p.data] : []; }) : [];
  const prep = prepNotesSchema.safeParse(r.prepNotes ?? {});
  return {
    id: r.id, caseId: r.caseId, ownerKey: r.ownerKey, contactId: r.contactId, kind: r.kind as AppointmentKind, title: r.title,
    startsAt: iso(r.startsAt), endsAt: iso(r.endsAt), timezone: r.timezone, location: r.location, telehealthUrl: r.telehealthUrl,
    phone: r.phone, withWhom: r.withWhom, status: r.status as AppointmentStatus, source: r.source as AppointmentSource,
    sourceMessageId: r.sourceMessageId, candidates, quote: r.quote,
    prepNotes: prep.success ? prep.data : { checked: {}, questions: [], note: '' },
    reminders: Array.isArray(r.reminders) ? r.reminders.filter(n => Number.isInteger(n) && n > 0) : [1440, 120],
    remindedAt: iso(r.remindedAt), googleEventId: r.googleEventId, requestMessageId: r.requestMessageId, sequence: r.sequence,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

function toColumns(patch: AppointmentPatch): Partial<typeof s.appointments.$inferInsert> {
  const out: Partial<typeof s.appointments.$inferInsert> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'startsAt' || key === 'endsAt' || key === 'remindedAt') (out as Record<string, unknown>)[key] = value === null ? null : new Date(value as string);
    else (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

const feedRow = (r: typeof s.calendarFeeds.$inferSelect): FeedRow => ({ id: r.id, ownerKey: r.ownerKey, revokedAt: iso(r.revokedAt), createdAt: r.createdAt.toISOString() });

export class PostgresAppointmentStore implements AppointmentStore {
  private get db() { return getDb(); }
  async get(id: string) {
    const [r] = await this.db.select().from(s.appointments).where(eq(s.appointments.id, id)).limit(1);
    return r ? rowToAppointment(r) : undefined;
  }
  async listForCase(caseId: string) {
    const rows = await this.db.select().from(s.appointments).where(eq(s.appointments.caseId, caseId)).orderBy(asc(sql`${s.appointments.startsAt} NULLS LAST`), asc(s.appointments.createdAt));
    return rows.map(rowToAppointment);
  }
  async listForOwner(ownerKey: string) {
    const accountId = accountIdFromKey(ownerKey);
    const owned = this.db.select({ id: s.cases.id }).from(s.cases).where(accountId ? eq(s.cases.accountId, accountId) : eq(s.cases.ownerSessionId, ownerKey));
    const rows = await this.db.select().from(s.appointments).where(inArray(s.appointments.caseId, owned)).orderBy(asc(sql`${s.appointments.startsAt} NULLS LAST`)).limit(500);
    return rows.map(rowToAppointment);
  }
  async insert(row: NewAppointment) {
    const values = { ...toColumns(row as AppointmentPatch), caseId: row.caseId, ownerKey: row.ownerKey, contactId: row.contactId, source: row.source, sourceMessageId: row.sourceMessageId, quote: row.quote, reminders: row.reminders, kind: row.kind, title: row.title, timezone: row.timezone, status: row.status, ...(row.id ? { id: row.id } : {}) } as typeof s.appointments.$inferInsert;
    const inserted = await this.db.insert(s.appointments).values(values).onConflictDoNothing().returning();
    if (inserted[0]) return { appointment: rowToAppointment(inserted[0]), created: true };
    const [existing] = await this.db.select().from(s.appointments).where(and(eq(s.appointments.caseId, row.caseId), eq(s.appointments.sourceMessageId, row.sourceMessageId ?? ''))).limit(1);
    if (!existing) throw new Error('Appointment insert conflicted without a matching row');
    return { appointment: rowToAppointment(existing), created: false };
  }
  async update(id: string, patch: AppointmentPatch, expect?: AppointmentStatus[]) {
    const where = expect?.length ? and(eq(s.appointments.id, id), inArray(s.appointments.status, expect)) : eq(s.appointments.id, id);
    const [r] = await this.db.update(s.appointments).set({ ...toColumns(patch), sequence: sql`${s.appointments.sequence} + 1`, updatedAt: new Date() }).where(where).returning();
    return r ? rowToAppointment(r) : undefined;
  }
  async dueReminders(now: Date, withinMs: number) {
    const rows = await this.db.select().from(s.appointments).where(and(
      eq(s.appointments.status, 'confirmed'), isNull(s.appointments.remindedAt),
      gt(s.appointments.startsAt, now), lte(s.appointments.startsAt, new Date(now.getTime() + withinMs)),
    )).limit(200);
    return rows.map(rowToAppointment);
  }
  async caseOwner(caseId: string) {
    const [r] = await this.db.select({ owner: s.cases.ownerSessionId }).from(s.cases).where(eq(s.cases.id, caseId)).limit(1);
    return r ? r.owner : undefined;
  }
  async createFeed(ownerKey: string) {
    const [r] = await this.db.insert(s.calendarFeeds).values({ ownerKey }).returning();
    return feedRow(r);
  }
  async feed(id: string) {
    const [r] = await this.db.select().from(s.calendarFeeds).where(eq(s.calendarFeeds.id, id)).limit(1);
    return r ? feedRow(r) : undefined;
  }
  async feeds(ownerKey: string) {
    const rows = await this.db.select().from(s.calendarFeeds).where(eq(s.calendarFeeds.ownerKey, ownerKey)).orderBy(asc(s.calendarFeeds.createdAt));
    return rows.map(feedRow);
  }
  async revokeFeed(id: string, ownerKey: string, at: Date) {
    const rows = await this.db.update(s.calendarFeeds).set({ revokedAt: at }).where(and(eq(s.calendarFeeds.id, id), eq(s.calendarFeeds.ownerKey, ownerKey), isNull(s.calendarFeeds.revokedAt))).returning({ id: s.calendarFeeds.id });
    return rows.length === 1;
  }
  async touchFeed(id: string, at: Date) {
    await this.db.update(s.calendarFeeds).set({ lastFetchedAt: at }).where(eq(s.calendarFeeds.id, id));
  }
}

const g = globalThis as { __wayfinderAppointmentStore?: AppointmentStore };
export function getAppointmentStore(): AppointmentStore {
  g.__wayfinderAppointmentStore ??= process.env.DATABASE_URL ? new PostgresAppointmentStore() : new MemoryAppointmentStore();
  return g.__wayfinderAppointmentStore;
}
