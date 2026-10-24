import { describe, expect, it, vi } from 'vitest';
import { MockCaller } from '../../lib/channels/mock-caller';
import { MockMailer } from '../../lib/channels/mock-mailer';
import { guardFromEnv, selectChannels, WiredOutreachService, type FollowUpDraftReader } from '../../lib/outreach/channel-wiring';
import { DemoCallSimulator, demoCallTranscript, isSimulatedCallId } from '../../lib/outreach/demo-call';
import {
  DEMO_CALL_SINK, DEMO_CALL_SIMULATED_NOTE, demoCallDestination, demoDestinationFor, demoFormToken, demoFormUrl,
  outboundAllowlist, sharedDemoAddresses, verifyDemoFormToken, webAllowlist,
} from '../../lib/outreach/demo-destinations';
import { isDemoFormFor, isDemoFormUrl, parseDemoFormSegment } from '../../lib/outreach/demo-destinations-shared';
import type { Candidate, Consent, Contact, Draft, OutreachStore, ProviderRef } from '../../lib/outreach/types';
import { recordingSendEvents } from '../../lib/workflows/events';

const DEMO = { WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'coord@agentmail.to,sender@agentmail.to', AGENTMAIL_SENDER_INBOX_ID: 'sender@agentmail.to', WAYFINDER_APP_BASE_URL: 'https://wayfinder.example.app', WAYFINDER_SESSION_SECRET: 'test-secret', NODE_ENV: 'test' };
const OFF = { OUTBOUND_ALLOWLIST: 'coord@agentmail.to', WAYFINDER_APP_BASE_URL: 'https://wayfinder.example.app', NODE_ENV: 'test' };

describe('demo destinations config', () => {
  it('puts the never-dialed call sink on the gate allowlist only in demo mode', () => {
    expect(outboundAllowlist(DEMO)).toContain(DEMO_CALL_SINK);
    expect(outboundAllowlist(OFF)).not.toContain(DEMO_CALL_SINK);
    // The mode is inert without an allowlisted coordinator inbox.
    expect(outboundAllowlist({ WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: '' })).toEqual([]);
  });

  it('adds only this deployment host to the web allowlist, only in demo mode', () => {
    expect(webAllowlist(DEMO)).toEqual(['wayfinder.example.app']);
    expect(webAllowlist(OFF)).toEqual([]);
    expect(webAllowlist({ ...DEMO, OUTBOUND_WEB_ALLOWLIST: 'apply.example.org' })).toEqual(['apply.example.org', 'wayfinder.example.app']);
  });

  it('remaps each channel to its demo destination and never returns a real one', () => {
    expect(demoDestinationFor(DEMO, 'email', 'trial:NCT1')).toBe('coord@agentmail.to');
    expect(demoDestinationFor(DEMO, 'voice', 'trial:NCT1')).toBe(DEMO_CALL_SINK);
    expect(demoDestinationFor(OFF, 'voice', 'trial:NCT1')).toBeUndefined();
    const withPhone = { ...DEMO, OUTBOUND_ALLOWLIST: `${DEMO.OUTBOUND_ALLOWLIST},+14155550123` };
    expect(demoCallDestination(withPhone, 'trial:NCT1')).toBe('+14155550123');
    expect(sharedDemoAddresses(withPhone)).toEqual(expect.arrayContaining(['coord@agentmail.to', '+14155550123', DEMO_CALL_SINK]));
  });

  it('builds a tokened demo form URL that names the resource and matches the real form it stands in for', () => {
    const url = demoFormUrl(DEMO, { caseId: 'case-1', applicationId: 'app-1', resourceKey: 'institution:abc-123', realUrl: 'https://clinic.example.org/request' });
    expect(url.startsWith('https://wayfinder.example.app/demo/intake-form/institution-abc-123-')).toBe(true);
    expect(isDemoFormUrl(url)).toBe(true);
    expect(isDemoFormFor(url, 'institution:abc-123', 'https://clinic.example.org/request')).toBe(true);
    expect(isDemoFormFor(url, 'institution:abc-123', 'https://clinic.example.org/other')).toBe(false);
    const u = new URL(url);
    const resource = u.pathname.split('/').pop()!;
    expect(parseDemoFormSegment(resource)).toMatchObject({ targetKind: 'institution', targetId: 'abc-123' });
    expect(verifyDemoFormToken(DEMO, { caseId: 'case-1', applicationId: 'app-1', resource, token: u.searchParams.get('t') })).toBe(true);
    expect(verifyDemoFormToken(DEMO, { caseId: 'case-2', applicationId: 'app-1', resource, token: u.searchParams.get('t') })).toBe(false);
    expect(demoFormToken(DEMO, { caseId: 'a', applicationId: 'b', resource })).not.toBe(demoFormToken({ ...DEMO, WAYFINDER_SESSION_SECRET: 'other' }, { caseId: 'a', applicationId: 'b', resource }));
  });
});

type Row = Contact & { firstSentAt?: string | null };
class Store implements OutreachStore, FollowUpDraftReader {
  caseId = 'case-1';
  record = { diseaseName: 'vascular Ehlers-Danlos syndrome', insurer: 'Fictional Plan' };
  people: Row[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(): Promise<Candidate[]> { return []; }
  async contacts() { return this.people; }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(): Promise<Contact[]> { return []; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string) { const d = this.drafts.get(key); return d ? structuredClone(d) : undefined; }
  async reserve(draft: Draft, approvedAt: string) { const row = this.drafts.get(draft.id)!; if (row.approvedAt) return false; row.approvedAt = approvedAt; return true; }
  async delivered(d: Draft, _ref: ProviderRef, sentAt: string) { this.drafts.get(d.id)!.sentAt = sentAt; this.people = this.people.map(c => (c.id === d.contactId ? { ...c, state: 'sent' } : c)); }
  async get() { return undefined; }
  async markFirstSent() {}
}

function setup(env: Record<string, string>) {
  const store = new Store();
  const guard = guardFromEnv(env);
  const caller = new MockCaller(guard);
  const ingest = vi.fn(async () => undefined);
  const ev = recordingSendEvents();
  const service = new WiredOutreachService(store, [new MockMailer(guard), new DemoCallSimulator(caller)], ev.send, env, () => new Date('2026-10-23T12:00:00Z'), store, ingest);
  const contact = (address: string, sharedFields = ['diseaseName']): Row => {
    const c: Row = { id: crypto.randomUUID(), caseId: store.caseId, targetId: crypto.randomUUID(), targetKind: 'trial', channel: 'voice', address, state: 'drafted' };
    store.people.push(c);
    store.consents.set(c.id, { contactId: c.id, sharedFields, approvedAt: '2026-10-23T11:00:00Z' });
    return c;
  };
  return { store, caller, ingest, service, contact };
}

describe('demo call remap through the unchanged gate', () => {
  it('simulates an approved call to the demo sink: nothing is dialed, the scripted transcript is ingested', async () => {
    const { caller, ingest, service, contact } = setup(DEMO);
    const c = contact(DEMO_CALL_SINK);
    const draft = await service.draft(c.id);
    const result = await service.approve(c.id, draft.id);
    expect('provider' in result && isSimulatedCallId(result.provider?.callId)).toBe(true);
    expect(caller.calls).toHaveLength(0);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ contactId: c.id, status: DEMO_CALL_SIMULATED_NOTE, transcript: demoCallTranscript() }));
  });

  it('still refuses an unapproved-consent or off-allowlist call in demo mode', async () => {
    const { service, contact, store } = setup(DEMO);
    const real = contact('+15075550111');
    const draft = await service.draft(real.id);
    await expect(service.approve(real.id, draft.id)).rejects.toMatchObject({ status: 422, reasons: expect.arrayContaining(['not_allowlisted']) });
    const sink = contact(DEMO_CALL_SINK);
    const d2 = await service.draft(sink.id);
    store.consents.delete(sink.id);
    await expect(service.approve(sink.id, d2.id)).rejects.toMatchObject({ status: 422, reasons: ['consent_required'] });
  });

  it('refuses the sink entirely when demo mode is off (the gate does not allow it)', async () => {
    const { service, contact, ingest } = setup(OFF);
    const c = contact(DEMO_CALL_SINK);
    const draft = await service.draft(c.id);
    await expect(service.approve(c.id, draft.id)).rejects.toMatchObject({ status: 422, reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('real callers refuse the sink as a second lock, and selectChannels wraps voice only in demo mode', async () => {
    expect(selectChannels({ ...DEMO, WAYFINDER_OFFLINE: '1' }).channels[1]).toBeInstanceOf(DemoCallSimulator);
    expect(selectChannels({ ...OFF, WAYFINDER_OFFLINE: '1' }).channels[1]).toBeInstanceOf(MockCaller);
    expect(guardFromEnv(DEMO).allowlist).not.toContain(DEMO_CALL_SINK);
  });
});
