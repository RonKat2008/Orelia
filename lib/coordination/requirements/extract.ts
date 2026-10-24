import { neutralizeUntrusted } from '@/lib/agents/research/untrusted';
import type { PageField } from '@/lib/channels/browser-types';
import type { RequirementKind } from '../contract';
import { recordTypesIn } from './rules';

/** A page that was actually fetched (or an evidence row's text). The only source of requirement sourceUrls. */
export interface FetchedPage { url: string; text: string; origin: 'exa' | 'kernel' | 'evidence' | 'fixture' }
export interface RequirementCandidate {
  kind: RequirementKind; label: string; detail: string; sourceUrl: string; origin: FetchedPage['origin'];
}

const MAX_DETAIL = 300;
const REMOVED_MARK = /\[removed/i;
const DEMAND = /\b(requires?|required|requiring|needs?|needed|must|necessary|mandatory|obtain|bring|provide|send|submit)\b/i;
const NO_REFERRAL = /\b(no|without( a)?)\s+(physician\s+)?referral\b|\breferrals?\s+(is|are)?\s*(not|never)\s+(required|needed|necessary)|self-?referr\w*\s+(is|are)?\s*(accepted|welcome|allowed)/i;

const sentencesOf = (text: string): string[] =>
  neutralizeUntrusted(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 8 && !REMOVED_MARK.test(s));

interface Rule { kind: RequirementKind; label: (s: string) => string; test: (s: string) => boolean }

const RULES: Rule[] = [
  { kind: 'referral_letter', label: () => 'Physician referral letter',
    test: s => /\breferral\b/i.test(s) && DEMAND.test(s) && !NO_REFERRAL.test(s) },
  { kind: 'records', label: s => { const t = recordTypesIn(s); return t.length ? `Records: ${t.join(', ')}` : 'Medical records'; },
    test: s => /\b(records?|reports?|imaging|slides?|results?|notes|scans?)\b/i.test(s) && DEMAND.test(s) && /\b(medical|imaging|patholog\w*|slides?|records?|genetic|lab)/i.test(s) },
  { kind: 'insurance_preauth', label: () => 'Insurance pre-authorization',
    test: s => /\b(pre-?authori[sz]ation|prior authori[sz]ation|insurance\s+(verification|approval|referral)|verify\s+(your\s+)?insurance)/i.test(s) },
  { kind: 'intake_form', label: () => 'New-patient intake form',
    test: s => /\b(new[- ]patient|intake|registration|patient information|referral)\s+(form|packet|questionnaire|paperwork)\b/i.test(s)
      || /\b(complete|fill out|submit)\b[^.]{0,40}\bforms?\b/i.test(s) },
  { kind: 'econsult', label: () => 'Physician e-consult available',
    test: s => /\be-?consults?\b|physician-to-physician|provider-to-provider|peer-to-peer|clinician[- ]to[- ]clinician/i.test(s) },
];

const clip = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s);

/** Deterministic keyword extraction over sanitized page text: first matching sentence per kind per page. */
export function extractRequirements(pages: readonly FetchedPage[]): RequirementCandidate[] {
  const out: RequirementCandidate[] = [];
  for (const page of pages) {
    const sentences = sentencesOf(page.text);
    for (const rule of RULES) {
      const hit = sentences.find(rule.test);
      if (hit) out.push({ kind: rule.kind, label: rule.label(hit), detail: clip(hit), sourceUrl: page.url, origin: page.origin });
    }
  }
  return out;
}

const MAX_LISTED = 8;

/** Requirements read from a probed intake form: required fields and file-upload controls. Labels are pre-sanitized. */
export function formRequirements(url: string, fields: readonly PageField[]): RequirementCandidate[] {
  if (fields.length === 0) return [];
  const out: RequirementCandidate[] = [];
  const plain = fields.filter(f => f.type !== 'file');
  const required = plain.filter(f => f.required);
  const listed = (required.length ? required : plain).slice(0, MAX_LISTED).map(f => neutralizeUntrusted(f.label)).filter(Boolean);
  if (listed.length) {
    out.push({ kind: 'intake_form', label: 'Online intake form', origin: 'kernel', sourceUrl: url,
      detail: clip(`${required.length ? 'Required fields' : 'Fields'}: ${listed.join(', ')}`) });
  }
  const uploads = fields.filter(f => f.type === 'file').map(f => neutralizeUntrusted(f.label)).filter(Boolean);
  if (uploads.length) {
    out.push({ kind: 'records', label: 'Records upload', origin: 'kernel', sourceUrl: url, detail: clip(`Upload field: ${uploads.slice(0, MAX_LISTED).join(', ')}`) });
  }
  return out;
}
