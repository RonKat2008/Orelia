import type { ExaPage } from '../sources/exa';
export type IntakeDoorKind = 'new_patient_line' | 'referral_coordinator' | 'second_opinion_program' | 'pathology_consult' | 'nurse_navigator' | 'trial_contact' | 'org_contact';
export interface IntakeDoor { kind: IntakeDoorKind; evidenceUrl: string; excerpt: string; emails: string[] }
const rules: [IntakeDoorKind, RegExp][] = [
  ['new_patient_line', /\b(?:new[- ]patient (?:line|appointments?|intake|office)|patient intake|request an appointment)\b/i],
  ['referral_coordinator', /\b(?:referral coordinator|referral office|physician referrals?|refer a patient)\b/i],
  ['second_opinion_program', /\bsecond[- ]opinion(?:s)?\b/i],
  ['pathology_consult', /\b(?:pathology consult(?:ation)?s?|pathology (?:review|second opinion)|slide review)\b/i],
  ['nurse_navigator', /\b(?:nurse navigator|patient navigator|nurse navigation)\b/i],
  ['trial_contact', /\b(?:trial (?:contact|coordinator)|study (?:contact|coordinator))\b/i],
  ['org_contact', /\b(?:contact us|general inquiries|organization contact)\b/i],
];
/** Fail closed: only explicitly role-based mailbox names are candidates, never named people. */
export function isRoleEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(parts[1])) return false;
  return /^(?:intake|referrals?|appointments?|newpatients?|secondopinions?|pathology|navigation|navigator|trials?|clinicaltrials|studycoordinator|info|contact|office|support)(?:[._-](?:intake|referrals?|appointments?|office|team|coordinator|center))?$/.test(parts[0]);
}
/** Input must be fetched text from the Exa wrapper. Titles and URL keywords alone are insufficient. */
export function classifyIntakeDoors(page: ExaPage): IntakeDoor[] {
  try { if (!['https:', 'http:'].includes(new URL(page.url).protocol)) return []; } catch { return []; }
  if (!page.text?.trim()) return [];
  // Work on local text blocks so an unrelated staff email elsewhere on a page is never attached.
  const blocks = page.text.split(/\n\s*\n|\r?\n/).map(s => s.trim()).filter(Boolean);
  const found: IntakeDoor[] = [];
  for (const [kind, pattern] of rules) {
    const block = blocks.find(text => pattern.test(text));
    if (!block) continue;
    const emails = [...new Set((block.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).filter(isRoleEmail).map(s => s.toLowerCase()))];
    // Evidence excerpt is the matching phrase only, avoiding incidental personal addresses/medical prose.
    found.push({ kind, evidenceUrl: page.url, excerpt: block.match(pattern)?.[0] ?? "", emails });
  }
  return found;
}
