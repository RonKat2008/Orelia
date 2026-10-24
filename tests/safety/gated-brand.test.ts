import { describe, expect, it } from 'vitest';
import { withDisclosure } from '../../lib/safety/disclosure';
import { checkOutbound, isGatedDraft, type GatedDraft } from '../../lib/safety/outbound-gate';

function gate() {
  return checkOutbound({
    draft: { channel: 'email', address: 'test@example.com', body: withDisclosure('Please coordinate.'), approvedAt: '2026-10-28T15:00:00Z' },
    consent: { sharedFields: [] }, caseRecord: {}, contacts: [], allowlist: ['test@example.com'],
    now: '2026-10-28T16:00:00Z', mode: 'demo',
  });
}

describe('GatedDraft brand', () => {
  it('recognises payloads produced by checkOutbound', () => {
    const result = gate();
    expect(result.ok && isGatedDraft(result.payload)).toBe(true);
  });

  it('rejects a hand-built frozen object with the same shape', () => {
    const result = gate();
    if (!result.ok) throw new Error('gate refused');
    const forged = Object.freeze({ ...result.payload, address: 'real@hospital.org' }) as unknown as GatedDraft;
    expect(Object.isFrozen(forged)).toBe(true);
    expect(typeof forged.approvedAt).toBe('string');
    expect(isGatedDraft(forged)).toBe(false);
  });

  it('rejects primitives and null', () => {
    for (const v of [null, undefined, 'x', 1, {}]) expect(isGatedDraft(v)).toBe(false);
  });
});
