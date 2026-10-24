import { describe, expect, it } from 'vitest';
import { createDefaultDeps } from '../../lib/workflows/default-deps';
import { createWorkflowFunctions, inngest } from '../../lib/workflows/inngest';

describe('inngest wiring', () => {
  it('registers both workflows on the wayfinder client', () => {
    const fns = createWorkflowFunctions(createDefaultDeps({}));
    expect(inngest.id).toBe('wayfinder');
    const ids = fns.map((f) => f.id());
    expect(ids).toEqual(expect.arrayContaining([
      expect.stringContaining('contact-connection'),
      expect.stringContaining('contact-follow-up-send'),
    ]));
  });

  it('default deps refuse to send anything', async () => {
    const deps = createDefaultDeps({});
    await expect(
      deps.send({ contactId: 'c1', caseId: 'k1', messageId: 'm1', kind: 'initial' }),
    ).rejects.toThrow(/checkOutbound/);
  });

  it('default deps start contacts in drafted and persist saved contexts', async () => {
    const deps = createDefaultDeps({});
    const ctx = await deps.loadContext('c1');
    expect(ctx.state).toBe('drafted');
    await deps.saveContext('c1', { ...ctx, state: 'sent' });
    expect((await deps.loadContext('c1')).state).toBe('sent');
  });
});
