import type { RequirementKind, RequirementStatus } from '../contract';
import { RECORD_TYPES, recordTypesIn } from './rules';

/** A document of the patient's (case-docs metadata or a history-lane item). */
export interface PatientDoc { id: string; title: string; kind: string }
/** Documents that came from the web, not the patient. */
const PUBLIC_KINDS = new Set(['resource_page', 'evidence']);
/** Kinds that count as a general record of the patient's history. */
const SUMMARY_KINDS = new Set(['case_summary', 'intake_report', 'history']);

export interface Match { status: RequirementStatus; matchedDocId: string | null }
const HAVE = (id: string): Match => ({ status: 'have', matchedDocId: id });
const MISSING: Match = { status: 'missing', matchedDocId: null };
const UNKNOWN: Match = { status: 'unknown', matchedDocId: null };

const TITLE_RULES: Partial<Record<RequirementKind, RegExp>> = {
  referral_letter: /\breferral\b/i,
  insurance_preauth: /\b(pre-?authori[sz]ation|prior authori[sz]ation|authori[sz]ation|insurance)\b/i,
  intake_form: /\b(intake|registration|new[- ]patient)\b/i,
};

/** Status of one requirement against the patient's own documents. Never reads document text. */
export function matchRequirement(req: { kind: RequirementKind; label: string; detail: string }, docs: readonly PatientDoc[]): Match {
  const own = docs.filter(d => !PUBLIC_KINDS.has(d.kind));
  if (req.kind === 'records') {
    const types = recordTypesIn(`${req.label} ${req.detail}`);
    const regs = RECORD_TYPES.filter(t => types.includes(t.name));
    const hit = regs.length
      ? own.find(d => regs.some(t => t.re.test(d.title)))
      : own.find(d => SUMMARY_KINDS.has(d.kind));
    return hit ? HAVE(hit.id) : MISSING;
  }
  const re = TITLE_RULES[req.kind];
  if (!re) return UNKNOWN;
  const hit = own.find(d => re.test(d.title));
  return hit ? HAVE(hit.id) : MISSING;
}
