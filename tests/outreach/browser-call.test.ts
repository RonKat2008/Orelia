import { describe, expect, it } from 'vitest';
import { OutreachService } from '../../lib/outreach/service';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { browserCallAvailability, startBrowserCall, webCallChannel } from '../../lib/outreach/browser-call';
import { memoryCallLiveStore } from '../../lib/outreach/call-live';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';
import { activeContactCount } from '../../lib/safety/caps';
import { OutreachError, type Candidate, type Channel, type Consent, type Contact, type Draft, type OutreachStore, type ProviderRef } from '../../lib/outreach/types';
import type { GatedDraft } from '../../lib/safety/outbound-gate';

const id = () => crypto.randomUUID();
const PHONE = '+14155550123';
const ROOM = 'https://vapi.daily.co/room1';

class MemoryStore implements OutreachStore {
  caseId = id();
  record = { diseaseName: 'epithelioid sarcoma', insurer: 'Fictional Plan', homeState: 'CA' };
  choices: Candidate[] = [];
  people: Contact[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  deliveries: ProviderRef[] = [];
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(caseId: string, ids: string[]) { return this.choices.filter(c => c.caseId === caseId && ids.includes(c.id)); }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(_caseId: string, contacts: Contact[], cap: number) { if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']); this.people.push(...contacts); return contacts; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string) { const d = this.drafts.get(key); return d ? structuredClone(d) : undefined; }
  async reserve(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id)!;
    if (row.approvedAt || JSON.stringify(this.consents.get(draft.contactId)?.sharedFields) !== JSON.stringify(draft.sharedFields)) return false;
    row.approvedAt = approvedAt;
    return true;
  }
  async delivered(d: Draft, ref: ProviderRef, sentAt: string) { this.drafts.get(d.id)!.sentAt = sentAt; this.people = this.people.map(c => c.id === d.contactId ? { ...c, state: 'sent' } : c); this.deliveries.push(ref); }
  candidate(address: string) {
    const evidence = address.includes('@')
      ? [{ claim: address, claimType: 'contact_point.email.new_patient_line', sourceUrl: 'https://example.com/intake', sourceKind: 'exa' }]
      : [{ claim: address, claimType: 'contact_point.voice.nppes_location_phone', sourceUrl: 'https://npiregistry.cms.hhs.gov/provider-view/1234567890', sourceKind: 'nppes' }];
    const c: Candidate = { id: id(), caseId: this.caseId, targetId: id(), targetKind: 'expert', evidence: evidence as Candidate['evidence'] };
    this.choices.push(c); return c;
  }
}

/** Stands in for VapiWebCallChannel (its request shape and parity are covered in tests/channels/vapi-web.test.ts). */
class FakeWebChannel implements Channel {
  readonly kind = 'voice' as const;
  sent: GatedDraft[] = [];
  async send(g: GatedDraft) { this.sent.push(g); return { callId: `wcall_${this.sent.length}`, webCallUrl: ROOM }; }
}

const DEMO_ENV = { NODE_ENV: 'test', WAYFINDER_MODE: 'demo', VAPI_PUBLIC_KEY: 'pub_key', OUTBOUND_ALLOWLIST: `intake@example.com,${PHONE}` };

async function setup(opts: { env?: Record<string, string>; address?: string; consent?: string[] | null } = {}) {
  const store = new MemoryStore();
  const phone = new MockChannel('voice');
  const env = opts.env ?? DEMO_ENV;
  const service = new OutreachService(store, [new MockChannel('email'), phone], env, () => new Date('2026-10-23T12:00:00Z'));
  const cand = store.candidate(opts.address ?? PHONE);
  const { contacts } = await service.select(store.caseId, [cand.id]);
  const contact = contacts[0]!;
  if (opts.consent !== null) await service.consent(contact.id, opts.consent ?? ['diseaseName']);
  const draft = opts.consent === null ? undefined : await service.draft(contact.id);
  const web = new FakeWebChannel();
  const live = memoryCallLiveStore();
  return { store, service, contact, draft, web, phone, live, env, deps: { service, channel: web, live, env } };
}
const refusal = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected refusal'); }, e => e as OutreachError);

describe('browser call availability (demo only)', () => {
  it('needs demo destinations, or the judge view in demo mode, plus the public key; never offline', () => {
    expect(browserCallAvailability({ VAPI_PUBLIC_KEY: 'k' })).toEqual({ ok: false, reason: 'not_demo' });
    expect(browserCallAvailability({ VAPI_PUBLIC_KEY: 'k', WAYFINDER_MODE: 'demo' })).toEqual({ ok: false, reason: 'not_demo' });
    expect(browserCallAvailability({ VAPI_PUBLIC_KEY: 'k', WAYFINDER_MODE: 'demo' }, { judge: true })).toEqual({ ok: true });
    expect(browserCallAvailability({ VAPI_PUBLIC_KEY: 'k', VERCEL_ENV: 'production' }, { judge: true })).toEqual({ ok: false, reason: 'not_demo' });
    const coordinators = { VAPI_PUBLIC_KEY: 'k', VERCEL_ENV: 'production', WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'coord@example.com' };
    expect(browserCallAvailability(coordinators)).toEqual({ ok: true });
    expect(browserCallAvailability({ ...coordinators, VAPI_PUBLIC_KEY: '' })).toEqual({ ok: false, reason: 'web_call_unconfigured' });
    expect(browserCallAvailability({ ...coordinators, WAYFINDER_OFFLINE: '1' })).toEqual({ ok: false, reason: 'offline' });
  });

  it('the web channel is built from the public key only', () => {
    expect(() => webCallChannel({ VAPI_API_KEY: 'private' })).toThrow(OutreachError);
    expect(webCallChannel({ VAPI_PUBLIC_KEY: 'pub' })).toBeDefined();
  });
});

describe('startBrowserCall runs the normal approval and outbound gate', () => {
  it('approves (approved_at), records the call with the Vapi id, marks it vapi-web, returns only join info', async () => {
    const ctx = await setup();
    const res = await startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true });
    expect(res).toEqual({ callId: 'wcall_1', webCallUrl: ROOM, publicKey: 'pub_key', approvedAt: '2026-10-23T12:00:00.000Z' });
    expect(ctx.web.sent).toHaveLength(1);
    expect(ctx.web.sent[0]!.body.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
    expect(ctx.web.sent[0]!.approvedAt).toBeTruthy();
    expect(ctx.phone.sent).toHaveLength(0);
    expect(ctx.store.drafts.get(ctx.draft!.id)?.approvedAt).toBeTruthy();
    expect(ctx.store.deliveries).toEqual([{ callId: 'wcall_1', webCallUrl: ROOM }]);
    expect(ctx.live.state({ providerCallId: 'wcall_1', contactId: ctx.contact.id })).toMatchObject({ provider: 'vapi-web', status: 'queued' });
    // Once contacted, never a second call.
    expect((await refusal(startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true }))).reasons).toEqual(['already_contacted']);
  });

  it('refuses outside demo mode before anything is approved', async () => {
    const ctx = await setup();
    const err = await refusal(startBrowserCall({ ...ctx.deps, env: { ...DEMO_ENV, WAYFINDER_MODE: 'prod' } }, ctx.contact.id, ctx.draft!.id, { judge: true }));
    expect(err.status).toBe(403);
    expect(ctx.web.sent).toHaveLength(0);
    expect(ctx.store.drafts.get(ctx.draft!.id)?.approvedAt).toBeFalsy();
  });

  it('refuses email contacts', async () => {
    const ctx = await setup({ address: 'intake@example.com' });
    expect((await refusal(startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true }))).reasons).toEqual(['not_a_call']);
    expect(ctx.web.sent).toHaveLength(0);
  });

  it('refuses without consent', async () => {
    const ctx = await setup();
    ctx.store.consents.delete(ctx.contact.id);
    expect((await refusal(startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true }))).reasons).toEqual(['consent_required']);
    expect(ctx.web.sent).toHaveLength(0);
  });

  it('refuses a script without the spoken disclosure', async () => {
    const ctx = await setup();
    const row = ctx.store.drafts.get(ctx.draft!.id)!;
    ctx.store.drafts.set(row.id, { ...row, body: 'Hello, I am calling about a patient.' });
    const err = await refusal(startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true }));
    expect(err.status).toBe(422);
    expect(ctx.web.sent).toHaveLength(0);
  });

  it('refuses fields the patient did not tick', async () => {
    const ctx = await setup();
    const row = ctx.store.drafts.get(ctx.draft!.id)!;
    ctx.store.drafts.set(row.id, { ...row, sharedFields: ['diseaseName', 'insurer'], body: `${row.body} Their insurer is Fictional Plan.` });
    expect((await refusal(startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true }))).status).toBe(422);
    expect(ctx.web.sent).toHaveLength(0);
  });

  it('refuses a destination that is not allowlisted', async () => {
    const ctx = await setup({ env: { ...DEMO_ENV, OUTBOUND_ALLOWLIST: 'intake@example.com' } });
    const err = await refusal(startBrowserCall({ ...ctx.deps, env: { ...DEMO_ENV, OUTBOUND_ALLOWLIST: 'intake@example.com' } }, ctx.contact.id, ctx.draft!.id, { judge: true }));
    expect(err.status).toBe(422);
    expect(ctx.web.sent).toHaveLength(0);
  });

  it('refuses over the 5-contact cap', async () => {
    const ctx = await setup();
    for (let i = 0; i < 5; i++) ctx.store.people.push({ id: id(), caseId: ctx.store.caseId, targetId: id(), targetKind: 'expert', purpose: 'x', channel: 'email', address: `x${i}@example.com`, state: 'sent' } as unknown as Contact);
    const err = await refusal(startBrowserCall(ctx.deps, ctx.contact.id, ctx.draft!.id, { judge: true }));
    expect(err.reasons).toContain('contact_cap');
    expect(ctx.web.sent).toHaveLength(0);
  });
});
