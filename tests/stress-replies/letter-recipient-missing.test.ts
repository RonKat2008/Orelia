import { describe, expect, it, vi } from 'vitest';
import * as s from '../../db/schema';
import { OWNER } from './_shared';

const rows = new Map<unknown, unknown[]>([
  [s.contacts, [{ id: OWNER.contactId, caseId: OWNER.caseId, targetKind: 'institution', targetId: 'inst-1', address: 'intake@site.test' }]],
  [s.consents, [{ contactId: OWNER.contactId, sharedFields: ['diseaseName'] }]],
  [s.cases, [{ id: OWNER.caseId, diseaseName: 'epithelioid sarcoma' }]],
  [s.institutions, [{ id: 'inst-1', name: 'Example Sarcoma Center', city: 'Boston', state: 'MA' }]],
]);
vi.mock('../../db/client', () => ({
  getDb: () => ({ select: () => ({ from: (t: unknown) => ({ where: async () => rows.get(t) ?? [] }) }) }),
}));

const { loadDraftContext } = await import('../../app/api/webhooks/_lib/postgres');

const { processInbound } = await import('../../lib/agents/inbox');
const { stubClassifier } = await import('./_shared');

const run = async (cls: 'send_slides' | 'send_records' | 'needs_referral', from: string | undefined) => {
  const event = { channel: 'email' as const, providerThreadId: 'thread-1', messageId: 'msg-1', ...(from ? { from } : {}), body: 'Please send what you have.', receivedAt: '2026-10-29T15:04:00Z' };
  const c = { class: cls, confidence: 0.9, rationale: 'Asked for materials.' } as const;
  const r = await processInbound(event, { classifier: stubClassifier(c), lookupThread: () => OWNER.contactId, loadContext: loadDraftContext, skipDocumentIngest: true });
  return r.tasks[0]!;
};

describe('production draft context for slides / records / referral replies', () => {
  for (const cls of ['send_slides', 'send_records'] as const) {
    it(`${cls}: the letter goes back to the address that replied, so approval is not recipient_missing`, async () => {
      const task = await run(cls, 'Pat Coordinator <Coord@Site.test>');
      expect(task.letter?.to).toBe('Coord@Site.test');
      expect(task.letter?.toName).toBe('Pat Coordinator');
      expect(task.details).toMatchObject({ replyTo: 'Coord@Site.test' });
      expect(task.details?.delivery).toBeUndefined();
    });
    it(`${cls}: with no usable sender it is a prepared letter, never a guessed address`, async () => {
      for (const from of [undefined, 'not an address', 'a@b.test, c@d.test']) {
        const task = await run(cls, from);
        expect(task.letter?.to).toBeUndefined();
        expect(task.details).toMatchObject({ delivery: 'prepared' });
      }
    });
  }
  it('needs_referral: a letter for the patient to forward, with instructions and no recipient even when the reply has a sender', async () => {
    const task = await run('needs_referral', 'coord@site.test');
    expect(task.kind).toBe('referral');
    expect(task.letter?.to).toBeUndefined();
    expect(task.details).toMatchObject({ delivery: 'prepared' });
    expect(String(task.details?.instructions)).toMatch(/will not guess/);
  });
});
