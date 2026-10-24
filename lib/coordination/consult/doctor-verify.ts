import { normalizeAddress, parseAllowlist } from '@/lib/safety/allowlist';
import { isFreeMailAddress } from '@/lib/safety/free-mail';
import { emailDomainTrusted } from './doctor-domain';
import { demoCoordinatorInboxes } from '@/lib/outreach/demo-coordinators';
import type { NppesClient } from '@/lib/sources/nppes';

/**
 * Doctor identity checks (security review #1). A doctor approval can only unlock the physician exemption from the
 * medical-advice filter when the doctor is VERIFIED:
 *  - the patient gave a 10-digit NPI, and NPPES lists that NPI as an active individual with this first + last name;
 *  - the doctor's email is not on a free-mail domain;
 *  - the email's domain (or a parent) matches a domain we hold code-stamped evidence for (doctor-domain.ts), since a
 *    real doctor's public name + NPI alone does not show the patient-entered address is theirs.
 * Anything else (no NPI, mismatch, registry down) leaves the doctor unverified: the request can still be sent, but
 * through the standard filter. Separately, some addresses can never be a doctor at all (doctorEmailRefusal).
 */
type Env = Record<string, string | undefined>;

export type VerificationReason = 'verified' | 'npi_missing' | 'free_mail_domain' | 'email_domain_unverified' | 'name_unparseable' | 'npi_name_mismatch' | 'registry_unavailable';
export interface DoctorVerification { verified: boolean; reason: VerificationReason }

export interface DoctorVerifier {
  verify(input: { name: string; npi: string }): Promise<DoctorVerification>;
}

const PREFIX = /^(dr|doctor|prof|professor|mr|mrs|ms|mx)\.?$/i;
const CREDENTIAL = /^(md|do|mbbs|mbchb|phd|np|pa|pa-c|rn|aprn|dnp|facp|facs|frcp|frcpc|mph|ms|msc|jr|sr|ii|iii|iv)$/i;
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** "Dr. Jane Q. Synthetic-Lee, MD" -> { first: 'Jane', last: 'Synthetic-Lee' }. Null when there are not two names. */
export function splitDoctorName(name: string): { first: string; last: string } | null {
  const main = name.split(',')[0] ?? '';
  const tokens = main.split(/\s+/).map(t => t.trim()).filter(Boolean)
    .filter(t => !PREFIX.test(t))
    .filter(t => !CREDENTIAL.test(t.replace(/\./g, '')));
  const words = tokens.filter(t => letters(t).length > 1);
  if (words.length < 2) return null;
  return { first: words[0].replace(/[^A-Za-z'-]/g, ''), last: words[words.length - 1].replace(/[^A-Za-z'-]/g, '') };
}

/** NPPES-backed verifier: the NPI must be among the registry's active individuals with exactly this name. */
export class NppesDoctorVerifier implements DoctorVerifier {
  constructor(private readonly client: Pick<NppesClient, 'lookup'>) {}

  async verify(input: { name: string; npi: string }): Promise<DoctorVerification> {
    if (!/^\d{10}$/.test(input.npi)) return { verified: false, reason: 'npi_missing' };
    const parts = splitDoctorName(input.name);
    if (!parts) return { verified: false, reason: 'name_unparseable' };
    const result = await this.client.lookup({ firstName: parts.first, lastName: parts.last, limit: 200 });
    const match = result.records.some(r => r.number === input.npi && r.enumeration_type === 'NPI-1' && r.basic.status === 'A'
      && letters(r.basic.first_name ?? '') === letters(parts.first) && letters(r.basic.last_name ?? '') === letters(parts.last));
    return match ? { verified: true, reason: 'verified' } : { verified: false, reason: 'npi_name_mismatch' };
  }
}

/** Full check: free-mail first (no registry call needed), then the registry, then the evidenced email domain; errors never verify. */
export async function verifyDoctor(
  verifier: DoctorVerifier | null,
  input: { name: string; npi: string | null; email: string; trustedDomains?: readonly string[] },
): Promise<DoctorVerification> {
  if (!input.npi) return { verified: false, reason: 'npi_missing' };
  if (isFreeMailAddress(input.email)) return { verified: false, reason: 'free_mail_domain' };
  if (!verifier) return { verified: false, reason: 'registry_unavailable' };
  try {
    const registry = await verifier.verify({ name: input.name, npi: input.npi });
    if (!registry.verified) return registry;
    return emailDomainTrusted(input.email, input.trustedDomains ?? []) ? registry : { verified: false, reason: 'email_domain_unverified' };
  } catch (err) {
    console.error('[consult] NPPES verification failed', err instanceof Error ? err.name : 'error');
    return { verified: false, reason: 'registry_unavailable' };
  }
}

const AGENTMAIL_DOMAIN = /@([a-z0-9-]+\.)*agentmail\.to$/;

/**
 * Addresses that are never a doctor: the patient's own email, Wayfinder's AgentMail inboxes (sender and any
 * @agentmail.to inbox) and the demo coordinator inboxes. Returns true when the address must be refused.
 */
export function doctorEmailRefused(email: string, ctx: { patientEmail: string | null; env: Env }): boolean {
  const a = normalizeAddress(email);
  if (!a || !a.includes('@')) return true;
  const patient = ctx.patientEmail ? normalizeAddress(ctx.patientEmail) : null;
  if (patient && patient === a) return true;
  if (AGENTMAIL_DOMAIN.test(a)) return true;
  for (const system of [ctx.env.AGENTMAIL_SENDER_INBOX_ID, ctx.env.WAYFINDER_NOTIFY_INBOX_ID]) {
    const inbox = normalizeAddress(system ?? '');
    if (inbox && inbox === a) return true;
  }
  const demo = new Set([...parseAllowlist(ctx.env.DEMO_COORDINATOR_INBOXES ?? ''), ...demoCoordinatorInboxes(ctx.env)]);
  return demo.has(a);
}
