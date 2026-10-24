import { normalizeAddress } from './allowlist';
import type { SafetyDraft } from './types';

/**
 * Narrow exemption from ONE check of checkOutbound: the medical-advice phrase filter.
 *
 * Why: that filter protects patients from AI-written medical advice. A doctor-to-expert consultation request is a
 * clinician-to-clinician message whose final text the patient's own licensed physician reviewed and approved
 * (lib/safety/consult-gate.ts verifies the approval, its timing and the exact-text hash before minting this).
 * Ordinary clinical questions ("would you recommend surgery or radiation?") trip the phrase filter, so without this
 * no physician could ever send a real consult question.
 *
 * Scope: email only, bound to the exact normalized address, subject and body; every other gate check (approval,
 * allowlist, contact cap, unshared fields, disclosure, cadence) still applies. Only consult-gate.ts may mint one
 * (tests/safety/consult-gate.test.ts scans the source tree for other callers). Objects not minted here are ignored.
 */
export interface PhysicianAuthoredExemption {
  readonly kind: 'physician_authored_clinician_message';
  readonly address: string;
  readonly subject: string;
  readonly body: string;
}

const minted = new WeakSet<object>();

/** ONLY lib/safety/consult-gate.ts calls this, after verifying the physician's approval of this exact text. */
export function mintPhysicianExemption(input: { address: string; subject: string; body: string }): PhysicianAuthoredExemption | null {
  const address = normalizeAddress(input.address);
  if (!address) return null;
  const exemption = Object.freeze({ kind: 'physician_authored_clinician_message' as const, address, subject: input.subject, body: input.body });
  minted.add(exemption);
  return exemption;
}

/** True only for a minted exemption that matches this email draft exactly. */
export function exemptsAdviceFilter(exemption: unknown, draft: SafetyDraft): boolean {
  if (typeof exemption !== 'object' || exemption === null || !minted.has(exemption)) return false;
  const e = exemption as PhysicianAuthoredExemption;
  return draft.channel === 'email'
    && normalizeAddress(draft.address) === e.address
    && (draft.subject ?? '') === e.subject
    && draft.body === e.body;
}
