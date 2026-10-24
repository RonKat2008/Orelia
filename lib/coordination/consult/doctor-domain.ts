import { isFreeMailAddress } from '@/lib/safety/free-mail';
import { isAffiliationClaimType } from '@/lib/identity/affiliation-evidence';

/**
 * Doctor email domain check (stress-security #3). A real doctor's public name + NPI passes NPPES, so an NPI match
 * alone does not show the patient-entered email belongs to that doctor. A doctor is verified only when the email's
 * domain, or one of its parents (dept.clinic.org -> clinic.org), equals a domain we hold code-stamped evidence for:
 * the host of an institution / profile page in the case's evidence for that doctor's NPI or institution, or an email
 * domain printed in a PubMed affiliation for that NPI. Registry, literature and search hosts never count.
 */

/** Evidence fields this check reads (rows are code-stamped from tool output; never model text). */
export interface DomainEvidenceRow { claimType: string; claim: string; sourceUrl: string }

/** Hosts that list many unrelated people: an address there says nothing about who owns the inbox. */
const SHARED_HOSTS = [
  'nih.gov', 'cancer.gov', 'clinicaltrials.gov', 'hhs.gov', 'cms.gov', 'cdc.gov', 'fda.gov', 'europepmc.org', 'doi.org',
  'exa.ai', 'google.com', 'bing.com', 'wikipedia.org', 'linkedin.com', 'doximity.com', 'healthgrades.com', 'vitals.com',
  'webmd.com', 'zocdoc.com', 'researchgate.net', 'orcid.org', 'facebook.com', 'x.com', 'twitter.com', 'youtube.com',
  'github.io', 'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com', 'sites.google.com', 'agentmail.to',
];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

function cleanDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const labels = d.split('.');
  // At least two labels (never a bare TLD), each a valid DNS label, and not an IP literal.
  if (labels.length < 2 || !labels.every(l => LABEL.test(l)) || /^\d+$/.test(labels[labels.length - 1])) return null;
  return d;
}

const isShared = (d: string) => SHARED_HOSTS.some(s => d === s || d.endsWith(`.${s}`));

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? cleanDomain(u.hostname) : null;
  } catch { return null; }
}

/** Domains the evidence vouches for (deduplicated, lowercased, www stripped, shared hosts removed). */
export function trustedDoctorDomains(evidence: readonly DomainEvidenceRow[]): string[] {
  const out = new Set<string>();
  const add = (d: string | null) => { if (d && !isShared(d) && !isFreeMailAddress(`x@${d}`)) out.add(d); };
  for (const e of evidence) {
    add(hostOf(e.sourceUrl));
    if (isAffiliationClaimType(e.claimType)) for (const m of e.claim.matchAll(EMAIL_IN_TEXT)) add(cleanDomain(m[1]));
  }
  return [...out];
}

/** True when the email's domain or a parent of it (never a bare TLD) exactly equals a trusted domain. */
export function emailDomainTrusted(email: string, trusted: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = cleanDomain(email.slice(at + 1));
  if (!domain || isShared(domain)) return false;
  const allowed = new Set(trusted.map(cleanDomain).filter((d): d is string => d !== null));
  const labels = domain.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    if (allowed.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}
