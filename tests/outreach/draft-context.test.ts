import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutreachService } from '../../lib/outreach/service';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { ingestEvidence } from '../../lib/case-docs/hooks';
import type { Candidate, Consent, Contact, Draft, OutreachStore } from '../../lib/outreach/types';

const id = () => crypto.randomUUID();
beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); (globalThis as { __wayfinderDocuments?: unknown }).__wayfinderDocuments = undefined; });
afterEach(() => vi.unstubAllEnvs());

describe('draft context stays on the contact own target', () => {
  it('does not leak case-wide evidence about other resources into a trial voice script', async () => {
    const caseId = id();
    const trial: Candidate = { id: id(), caseId, targetId: id(), targetKind: 'trial', evidence: [
      { claim: '+16175550100', claimType: 'contact_point.voice.ctgov_central_contact', sourceUrl: 'https://clinicaltrials.gov/study/NCT05432466', sourceKind: 'ctgov' },
      { claim: 'Study NCT05432466 screens adults through its central contact.', claimType: 'trial_overview', sourceUrl: 'https://clinicaltrials.gov/study/NCT05432466', sourceKind: 'ctgov' },
    ] as unknown as Candidate['evidence'] };
    const aid: Candidate['evidence'] = [{ claim: 'UniteRare lists vascular EDS travel grants.', claimType: 'travel_aid_program', sourceUrl: 'https://uniterare.example/travel' }];
    const people: Contact[] = []; const consents = new Map<string, Consent>(); const drafts = new Map<string, Draft>();
    const store = {
      getCase: async () => ({ diseaseName: 'vascular EDS' }),
      candidates: async () => [trial], contacts: async () => people, contact: async (k: string) => people.find(c => c.id === k),
      select: async (_c: string, rows: Contact[]) => { people.push(...rows); return rows; },
      consent: async (k: string) => consents.get(k), saveConsent: async (c: Consent) => { consents.set(c.contactId, c); },
      saveDraft: async (d: Draft) => { drafts.set(d.id, d); },
    } as unknown as OutreachStore;
    // Case-wide evidence ingested at shortlist time (lib/agents/persist.ts), for every resource in the case.
    await ingestEvidence(caseId, [...trial.evidence, ...aid]);
    const service = new OutreachService(store, [new MockChannel('voice')], { NODE_ENV: 'test' });
    const { contacts } = await service.select(caseId, [trial.id]);
    await service.consent(contacts[0].id, ['diseaseName']);
    const draft = await service.draft(contacts[0].id);
    expect(draft.body).toContain('screens adults');
    expect(draft.body).not.toContain('UniteRare');
    expect(draft.contextDocIds?.length).toBeGreaterThan(0);
  });
});
